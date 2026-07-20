import type { HermesConfig } from './storage'

export type HermesSession = {
  id: string
  title?: string
  source?: string
  updated_at?: string
  created_at?: string
}

export type HermesRunStart = {
  run_id: string
  status: string
}

export type HermesRunStatus = {
  object?: string
  run_id: string
  status: 'queued' | 'running' | 'waiting_for_approval' | 'stopping' | 'completed' | 'failed' | 'cancelled' | string
  output?: string
  error?: string
  usage?: Record<string, unknown>
  last_event?: string
  session_id?: string
}

export type HermesRunEvent = {
  event: string
  run_id?: string
  timestamp?: number
  delta?: string
  output?: string
  error?: string
  tool?: string
  preview?: string
  choices?: string[]
  command?: string
  description?: string
  [key: string]: unknown
}

export type ApprovalChoice = 'once' | 'deny'

export class HermesApiError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
  }
}

export function parseSseEvents(chunk: string): HermesRunEvent[] {
  const events: HermesRunEvent[] = []
  for (const block of chunk.split(/\r?\n\r?\n+/)) {
    const dataLines = block
      .split(/\r?\n/)
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).trim())
    if (dataLines.length === 0) continue
    try {
      const parsed = JSON.parse(dataLines.join('\n'))
      if (parsed && typeof parsed.event === 'string') events.push(parsed)
    } catch {
      // Ignore malformed SSE data chunks; the stream can continue.
    }
  }
  return events
}

const BLINK_SESSION_TITLE_PREFIX = 'Hermes Blink /'
const DEFAULT_BLINK_SESSION_TITLE = 'Hermes Blink / G2'
const BLINK_MODEL_NAME = 'hermes-blink'

function browserFetch(input: URL | RequestInfo, init?: RequestInit): ReturnType<typeof fetch> {
  // WebKit's Window.fetch brand-checks `this`; calling a stored unbound method fails.
  return globalThis.fetch(input, init)
}

export class HermesClient {
  constructor(
    private readonly config: HermesConfig,
    private readonly fetchImpl: typeof fetch = browserFetch,
    private readonly timeouts = { healthMs: 8_000, listMs: 10_000, chatMs: 60_000, runMs: 120_000 },
  ) {}

  async health(): Promise<boolean> {
    const response = await this.fetchWithTimeout(`${this.config.baseUrl}/health`, {
      headers: this.headers(false),
    }, this.timeouts.healthMs)
    return response.ok
  }

  async listSessions(): Promise<HermesSession[]> {
    const response = await this.request('/api/sessions?limit=50&source=api-server', {}, this.timeouts.listMs)
    const body = await this.readJson(response, this.timeouts.listMs)
    const sessions = Array.isArray(body) ? body : body.sessions ?? body.data ?? []
    return sessions.map((item: any) => {
      const session: HermesSession = {
        id: String(item.id ?? item.session_id),
        title: item.title,
        source: item.source,
        updated_at: item.updated_at ?? item.last_active,
        created_at: item.created_at ?? item.started_at,
      }
      return session
    })
      .filter((session: HermesSession) => session.id && session.id !== 'undefined')
      .filter((session: HermesSession) => (session.title ?? '').startsWith(BLINK_SESSION_TITLE_PREFIX))
  }

  async createSession(title = DEFAULT_BLINK_SESSION_TITLE): Promise<HermesSession> {
    const response = await this.request('/api/sessions', {
      method: 'POST',
      body: JSON.stringify({ title, model: BLINK_MODEL_NAME }),
    }, this.timeouts.listMs)
    const body = await this.readJson(response, this.timeouts.listMs)
    const session = body.session ?? body
    const sessionId = session?.id ?? session?.session_id
    if (sessionId === undefined || sessionId === null || String(sessionId).trim() === '') {
      throw new HermesApiError('Hermes returned a session without a usable session id')
    }
    return {
      id: String(sessionId),
      title: session.title ?? title,
      source: session.source,
      created_at: session.created_at ?? session.started_at,
    }
  }

  async startRun(sessionId: string, input: string, instructions?: string): Promise<HermesRunStart> {
    const response = await this.request('/v1/runs', {
      method: 'POST',
      body: JSON.stringify({
        input,
        session_id: sessionId,
        ...(instructions?.trim() ? { instructions: instructions.trim() } : {}),
      }),
    }, this.timeouts.runMs)
    const body = await this.readJson(response, this.timeouts.runMs)
    if (body?.run_id === undefined || body?.run_id === null || String(body.run_id).trim() === '') {
      throw new HermesApiError('Hermes returned a run without a usable run id')
    }
    return { run_id: String(body.run_id), status: String(body.status ?? 'started') }
  }

  async *streamRunEvents(runId: string): AsyncGenerator<HermesRunEvent> {
    const response = await this.request(`/v1/runs/${encodeURIComponent(runId)}/events`, {}, this.timeouts.runMs)
    if (!response.body) return

    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    try {
      while (true) {
        const { done, value } = await this.readChunk(reader, this.timeouts.runMs, 'Hermes event stream')
        if (value) {
          buffer += decoder.decode(value, { stream: !done })
          const matches = [...buffer.matchAll(/\r?\n\r?\n/g)]
          const lastMatch = matches.at(-1)
          if (lastMatch?.index !== undefined) {
            const boundaryEnd = lastMatch.index + lastMatch[0].length
            const complete = buffer.slice(0, boundaryEnd)
            buffer = buffer.slice(boundaryEnd)
            for (const event of parseSseEvents(complete)) yield event
          }
        }
        if (done) break
      }
      buffer += decoder.decode()
      for (const event of parseSseEvents(buffer)) yield event
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }

  async getRun(runId: string): Promise<HermesRunStatus> {
    const response = await this.request(`/v1/runs/${encodeURIComponent(runId)}`, {}, this.timeouts.listMs)
    const body = await this.readJson(response, this.timeouts.listMs)
    if (!body || typeof body !== 'object' || String(body.run_id ?? '') !== runId || typeof body.status !== 'string') {
      throw new HermesApiError('Hermes returned an invalid run status response')
    }
    return body as HermesRunStatus
  }

  async waitForRunState(
    runId: string,
    options: { maxAttempts?: number; pollMs?: number } = {},
  ): Promise<HermesRunStatus> {
    const maxAttempts = Math.max(1, options.maxAttempts ?? 150)
    const pollMs = Math.max(0, options.pollMs ?? 2_000)
    let current = await this.getRun(runId)
    for (let attempt = 1; attempt < maxAttempts; attempt += 1) {
      if (['completed', 'failed', 'cancelled', 'waiting_for_approval'].includes(current.status)) return current
      if (pollMs > 0) await new Promise((resolve) => globalThis.setTimeout(resolve, pollMs))
      current = await this.getRun(runId)
    }
    return current
  }

  async transcribeAudio(wav: Blob): Promise<string> {
    const response = await this.request('/v1/audio/transcriptions', {
      method: 'POST',
      body: wav,
      headers: { 'Content-Type': 'audio/wav' },
    }, this.timeouts.chatMs)
    const body = await this.readJson(response, this.timeouts.chatMs)
    const text = String(body?.text ?? '').trim().slice(0, 4_000)
    if (!text) throw new HermesApiError('No speech was detected. Tap and try again.')
    return text
  }

  async stopRun(runId: string): Promise<void> {
    await this.request(`/v1/runs/${encodeURIComponent(runId)}/stop`, { method: 'POST' }, this.timeouts.listMs)
  }

  async respondToApproval(runId: string, choice: ApprovalChoice, _approvalId?: string): Promise<void> {
    await this.request(`/v1/runs/${encodeURIComponent(runId)}/approval`, {
      method: 'POST',
      body: JSON.stringify({ choice }),
    }, this.timeouts.listMs)
  }

  private async request(path: string, init: RequestInit = {}, timeoutMs: number): Promise<Response> {
    const response = await this.fetchWithTimeout(`${this.config.baseUrl}${path}`, {
      ...init,
      headers: {
        ...this.headers(init.body !== undefined),
        ...(init.headers ?? {}),
      },
    }, timeoutMs)
    if (!response.ok) {
      throw new HermesApiError(`Hermes request failed (${response.status})`, response.status)
    }
    return response
  }

  private async fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
    const controller = new AbortController()
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs)
    try {
      return await this.fetchImpl(url, { ...init, redirect: 'error', signal: controller.signal })
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new HermesApiError(`Hermes request timed out after ${Math.round(timeoutMs / 1000)}s`)
      }
      throw error
    } finally {
      globalThis.clearTimeout(timeout)
    }
  }

  private async readJson(response: Response, timeoutMs: number): Promise<any> {
    if (!response.body) throw new HermesApiError('Hermes returned an empty response body')
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let text = ''
    try {
      while (true) {
        const { done, value } = await this.readChunk(reader, timeoutMs, 'Hermes response body')
        if (value) {
          text += decoder.decode(value, { stream: !done })
          if (text.length > 1_000_000) throw new HermesApiError('Hermes response body exceeded 1 MB')
        }
        if (done) break
      }
      text += decoder.decode()
      return JSON.parse(text)
    } catch (error) {
      if (error instanceof HermesApiError) throw error
      throw new HermesApiError('Hermes returned invalid JSON')
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
    }
  }

  private async readChunk(
    reader: ReadableStreamDefaultReader<Uint8Array>,
    timeoutMs: number,
    label: string,
  ): Promise<ReadableStreamReadResult<Uint8Array>> {
    let timeout: ReturnType<typeof globalThis.setTimeout> | undefined
    try {
      return await Promise.race([
        reader.read(),
        new Promise<never>((_, reject) => {
          timeout = globalThis.setTimeout(
            () => reject(new HermesApiError(`${label} timed out after ${Math.round(timeoutMs / 1000)}s`)),
            timeoutMs,
          )
        }),
      ])
    } finally {
      if (timeout !== undefined) globalThis.clearTimeout(timeout)
    }
  }

  private headers(json: boolean): HeadersInit {
    return {
      Authorization: `Bearer ${this.config.apiKey}`,
      ...(this.config.deviceBindingId ? { 'X-Hermes-Blink-Device': this.config.deviceBindingId } : {}),
      ...(json ? { 'Content-Type': 'application/json' } : {}),
    }
  }
}
