import { describe, expect, it, vi } from 'vitest'
import { HermesApiError, HermesClient, parseSseEvents } from '../src/hermesClient'

function mockFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>): typeof fetch {
  return ((url: URL | RequestInfo, init?: RequestInit) => handler(String(url), init)) as typeof fetch
}

function sseResponse(text: string): Response {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text))
      controller.close()
    },
  }), { headers: { 'Content-Type': 'text/event-stream' } })
}

describe('HermesClient', () => {
  it('uploads a WAV recording to the narrow transcription endpoint', async () => {
    const seen: { url?: string; type?: string } = {}
    const client = new HermesClient({ baseUrl: 'https://h.example', apiKey: ['test', 'token'].join('-') }, mockFetch((url, init) => {
      seen.url = url
      seen.type = (init?.headers as Record<string, string>)['Content-Type']
      return Response.json({ text: 'spoken prompt' })
    }))
    await expect(client.transcribeAudio(new Blob(['wav'], { type: 'audio/wav' }))).resolves.toBe('spoken prompt')
    expect(seen).toEqual({ url: 'https://h.example/v1/audio/transcriptions', type: 'audio/wav' })
  })

  it('calls the browser fetch implementation with the Window/global context', async () => {
    const originalFetch = globalThis.fetch
    let receivedContext: unknown
    globalThis.fetch = function (this: typeof globalThis) {
      receivedContext = this
      return Promise.resolve(Response.json({ status: 'ok' }))
    } as typeof fetch

    try {
      const client = new HermesClient({
        baseUrl: 'https://h.example',
        apiKey: ['test', 'token'].join('-'),
      })
      await expect(client.health()).resolves.toBe(true)
      expect(receivedContext).toBe(globalThis)
    } finally {
      globalThis.fetch = originalFetch
    }
  })

  it('sends bearer auth and starts a run against a selected session', async () => {
    const seen: { url?: string; auth?: string; device?: string; body?: string; redirect?: RequestRedirect } = {}
    const client = new HermesClient({ baseUrl: 'https://h.example', apiKey: 'secret', deviceBindingId: 'g2_abc' }, mockFetch((url, init) => {
      seen.url = url
      seen.auth = (init?.headers as Record<string, string>).Authorization
      seen.device = (init?.headers as Record<string, string>)['X-Hermes-Blink-Device']
      seen.body = String(init?.body)
      seen.redirect = init?.redirect
      return Response.json({ run_id: 'run_1', status: 'started' }, { status: 202 })
    }))

    const result = await client.startRun('s1', 'hello', 'glasses instructions')
    expect(seen.url).toBe('https://h.example/v1/runs')
    expect(seen.auth).toBe('Bearer secret')
    expect(seen.device).toBe('g2_abc')
    expect(seen.redirect).toBe('error')
    expect(JSON.parse(seen.body ?? '{}')).toEqual({ input: 'hello', session_id: 's1', instructions: 'glasses instructions' })
    expect(result).toEqual({ run_id: 'run_1', status: 'started' })
  })

  it('streams SSE run events from the Runs API', async () => {
    const client = new HermesClient({ baseUrl: 'https://h.example', apiKey: 'secret' }, mockFetch((url) => {
      expect(url).toBe('https://h.example/v1/runs/run_1/events')
      return sseResponse('data: {"event":"message.delta","delta":"hi"}\n\ndata: {"event":"run.completed","output":"hi"}\n\n')
    }))

    const events: string[] = []
    for await (const event of client.streamRunEvents('run_1')) events.push(event.event)
    expect(events).toEqual(['message.delta', 'run.completed'])
  })

  it('posts stop and approval decisions to a run', async () => {
    const seen: Array<{ url: string; body?: string }> = []
    const client = new HermesClient({ baseUrl: 'https://h.example', apiKey: 'secret' }, mockFetch((url, init) => {
      seen.push({ url, body: String(init?.body ?? '') })
      return Response.json({ ok: true })
    }))

    await client.stopRun('run_1')
    await client.respondToApproval('run_1', 'once')
    expect(seen).toEqual([
      { url: 'https://h.example/v1/runs/run_1/stop', body: '' },
      { url: 'https://h.example/v1/runs/run_1/approval', body: JSON.stringify({ choice: 'once' }) },
    ])
  })

  it('reconciles run state after an SSE disconnect', async () => {
    const client = new HermesClient({ baseUrl: 'https://h.example', apiKey: 'secret' }, mockFetch((url) => {
      expect(url).toBe('https://h.example/v1/runs/run_1')
      return Response.json({ run_id: 'run_1', status: 'completed', output: 'done' })
    }))
    await expect(client.getRun('run_1')).resolves.toMatchObject({ run_id: 'run_1', status: 'completed', output: 'done' })
  })

  it('polls a disconnected active run until it reaches a resumable state', async () => {
    const states = ['running', 'running', 'completed']
    const client = new HermesClient({ baseUrl: 'https://h.example', apiKey: ['test', 'token'].join('-') }, mockFetch(() => {
      const status = states.shift() ?? 'completed'
      return Response.json({ run_id: 'run_1', status, ...(status === 'completed' ? { output: 'done' } : {}) })
    }))

    await expect(client.waitForRunState('run_1', { maxAttempts: 3, pollMs: 0 }))
      .resolves.toMatchObject({ status: 'completed', output: 'done' })
  })

  it('returns waiting-for-approval instead of polling forever', async () => {
    const client = new HermesClient({ baseUrl: 'https://h.example', apiKey: ['test', 'token'].join('-') }, mockFetch(() =>
      Response.json({ run_id: 'run_1', status: 'waiting_for_approval' })))

    await expect(client.waitForRunState('run_1', { maxAttempts: 3, pollMs: 0 }))
      .resolves.toMatchObject({ status: 'waiting_for_approval' })
  })

  it('keeps Blink in its own session lane on the main gateway', async () => {
    const seen: { listUrl?: string; createBody?: string } = {}
    const client = new HermesClient({ baseUrl: 'https://h.example', apiKey: 'secret' }, mockFetch((url, init) => {
      if (url.includes('/api/sessions?')) {
        seen.listUrl = url
        return Response.json({ sessions: [
          { session_id: 'blink_1', title: 'Hermes Blink / G2' },
          { session_id: 'desktop_1', title: 'Desktop session' },
          { session_id: 'blink_2', title: 'Hermes Blink / Voice' },
        ] })
      }
      seen.createBody = String(init?.body)
      return Response.json({ session: { session_id: 'blink_new', title: 'Hermes Blink / G2' } }, { status: 201 })
    }))

    const sessions = await client.listSessions()
    expect(sessions.map(({ id, title }) => ({ id, title }))).toEqual([
      { id: 'blink_1', title: 'Hermes Blink / G2' },
      { id: 'blink_2', title: 'Hermes Blink / Voice' },
    ])
    await client.createSession()
    expect(seen.listUrl).toBe('https://h.example/api/sessions?limit=50&source=api-server')
    expect(JSON.parse(seen.createBody ?? '{}')).toMatchObject({ title: 'Hermes Blink / G2', model: 'hermes-blink' })
  })

  it('passes an abort signal and converts aborts to timeout errors', async () => {
    const abortError = new DOMException('Aborted', 'AbortError')
    const fetchImpl = vi.fn((_url: string, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal)
      return Promise.reject(abortError)
    }) as unknown as typeof fetch
    const client = new HermesClient({ baseUrl: 'https://h.example', apiKey: 'secret' }, fetchImpl, { healthMs: 1, listMs: 1, chatMs: 1, runMs: 1 })

    await expect(client.health()).rejects.toBeInstanceOf(HermesApiError)
    await expect(client.health()).rejects.toThrow(/timed out/)
  })

  it('times out when response headers arrive but the JSON body stalls', async () => {
    const stalled = new ReadableStream<Uint8Array>({ start() {} })
    const client = new HermesClient(
      { baseUrl: 'https://h.example', apiKey: ['test', 'token'].join('-') },
      mockFetch(() => new Response(stalled, { status: 200 })),
      { healthMs: 5, listMs: 5, chatMs: 5, runMs: 5 },
    )

    await expect(client.getRun('run_1')).rejects.toThrow(/body timed out/i)
  })

  it('times out and cancels a stalled SSE stream', async () => {
    let cancelled = false
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"event":"message.delta","delta":"hi"}\n\n'))
      },
      cancel() { cancelled = true },
    })
    const client = new HermesClient(
      { baseUrl: 'https://h.example', apiKey: ['test', 'token'].join('-') },
      mockFetch(() => new Response(stream, { status: 200 })),
      { healthMs: 5, listMs: 5, chatMs: 5, runMs: 5 },
    )

    const events = client.streamRunEvents('run_1')
    await expect(events.next()).resolves.toMatchObject({ value: { event: 'message.delta' } })
    await expect(events.next()).rejects.toThrow(/stream timed out/i)
    expect(cancelled).toBe(true)
  })
})

describe('parseSseEvents', () => {
  it('ignores comments and malformed event chunks', () => {
    expect(parseSseEvents(': keepalive\n\ndata: {"event":"run.completed"}\n\ndata: nope\n\n')).toEqual([{ event: 'run.completed' }])
  })

  it('parses CRLF-delimited SSE blocks used by mobile WebViews', () => {
    expect(parseSseEvents('data: {"event":"message.delta","delta":"hi"}\r\n\r\ndata: {"event":"run.completed"}\r\n\r\n'))
      .toEqual([
        { event: 'message.delta', delta: 'hi' },
        { event: 'run.completed' },
      ])
  })
})

describe('Hermes response validation', () => {
  it('rejects a run response without a usable run id', async () => {
    const client = new HermesClient({ baseUrl: 'https://h.example', apiKey: 'secret' }, mockFetch(() => Response.json({ status: 'started' }, { status: 202 })))
    await expect(client.startRun('s1', 'hello')).rejects.toThrow(/run id/i)
  })

  it('rejects a session response without a usable session id', async () => {
    const client = new HermesClient({ baseUrl: 'https://h.example', apiKey: 'secret' }, mockFetch(() => Response.json({ session: { title: 'Hermes Blink / G2' } }, { status: 201 })))
    await expect(client.createSession()).rejects.toThrow(/session id/i)
  })
})
