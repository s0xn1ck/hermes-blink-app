import { HermesApiError, HermesClient, type ApprovalChoice, type HermesRunEvent, type HermesRunStatus, type HermesSession } from './hermesClient'
import {
  clearConfig,
  clearSettings,
  defaultSettings,
  loadConfig,
  loadSettings,
  normalizeBaseUrl,
  saveConfig,
  saveSettings,
  type BlinkSettings,
  type HermesConfig,
} from './storage'
import { buildDebugPayload } from './diagnostics'
import { buildBlinkPrompt } from './prompt'
import { chunkForG2, formatLensPage, tailForPhone } from './text'
import type { G2Bridge, G2Event } from './g2Bridge'
import manifest from '../app.json'
import { pcm16ChunksToWav } from './audio'

type DebugState = {
  bridge: string
  hermes: string
  session: string
  lastEvent: string
  lastRequest: string
}

type AppView = 'home' | 'sessions' | 'settings'
type SettingsTab = 'display' | 'session' | 'hermes'

const tabLabels: Record<SettingsTab, string> = {
  display: 'Display',
  session: 'Session',
  hermes: 'Hermes',
}

const MAX_PROMPT_CHARS = 4_000
const MAX_OUTPUT_CHARS = 50_000

export class G2HermesApp {
  private client: HermesClient | null = null
  private config: HermesConfig | null = null
  private session: HermesSession | null = null
  private sessions: HermesSession[] = []
  private pages: string[] = ['Configure Hermes on phone screen.']
  private pageIndex = 0
  private currentRunId: string | null = null
  private runStatus: HermesRunStatus['status'] | 'idle' = 'idle'
  private runOutput = ''
  private lastDeltaRenderAt = 0
  private pendingApproval: HermesRunEvent | null = null
  private approvalConfirmArmed = false
  private connectionState: 'checking' | 'online' | 'offline' = 'offline'
  private view: AppView = 'home'
  private settingsTab: SettingsTab = 'display'
  private settings: BlinkSettings = loadSettings()
  private voiceRecording = false
  private voiceChunks: Uint8Array[] = []
  private voiceBytes = 0
  private voiceTimeout: ReturnType<typeof globalThis.setTimeout> | null = null
  private debug: DebugState = {
    bridge: 'ready',
    hermes: 'not connected',
    session: 'none',
    lastEvent: 'none',
    lastRequest: 'none',
  }

  constructor(private readonly bridge: G2Bridge, private readonly root: HTMLElement) {}

  async start(): Promise<void> {
    this.bridge.onEvent((event) => this.withUiErrors(() => this.handleG2Event(event)))
    this.bridge.onAudio((pcm) => this.captureAudio(pcm))
    this.updateDebug({ bridge: 'ready' })

    const config = loadConfig(window.localStorage, window.sessionStorage)
    if (!config) {
      this.renderConfigForm()
      await this.show('Setup required', 'Enter your HTTPS Hermes Gateway URL and scoped token on the phone.', 0)
      return
    }
    await this.connectDirect(config).catch(async (error) => {
      this.updateDebug({ hermes: 'failed', lastRequest: String(error?.message ?? error) })
      this.renderConfigForm(String(error?.message ?? error))
      await this.show('Connection failed', 'Open the phone screen and update your Hermes credentials.', 0)
    })
  }

  private async handleG2Event(event: G2Event): Promise<void> {
    this.updateDebug({ lastEvent: event })
    if (event === 'tap' && this.client && this.session && !['queued', 'running', 'waiting_for_approval', 'stopping'].includes(this.runStatus)) {
      await this.toggleVoice()
      return
    }
    if (event === 'swipeDown') await this.nextPage()
    if (event === 'swipeUp') await this.previousPage()
    if (event === 'doubleTap') await this.bridge.exit()
  }

  private renderConfigForm(error = ''): void {
    const baseUrl = this.config?.baseUrl ?? ''
    const addressField = `<label>Hermes Gateway URL <input name="baseUrl" type="url" inputmode="url" autocomplete="url" placeholder="https://hermes.example.com" value="${escapeHtml(baseUrl)}" required /></label>`
    this.root.innerHTML = this.shell(`
      <section class="card help-card">
        <p class="eyebrow">Private self-hosted connection</p>
        <h2>Connect Hermes Blink</h2>
        <p>Use the same private bridge URL and disposable token configured for Even’s Add Agent.</p>
        <ol class="setup-steps">
          <li>Keep Hermes bound to localhost.</li>
          <li>Expose only Hermes Blink Bridge over private HTTPS.</li>
          <li>Paste that bridge URL and its scoped token below.</li>
        </ol>
      </section>
      <section class="card connect-card">
        <div class="status-pill disconnected" role="status">● Not connected</div>
        ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
        <form id="config-form">
          ${addressField}
          <label>Access token <input name="apiKey" type="password" autocomplete="off" placeholder="Scoped Hermes Blink token" required /></label>
          <button type="submit">Connect securely</button>
        </form>
      </section>
      ${this.renderDebugPanel()}
    `, 'home')

    this.root.querySelector<HTMLFormElement>('#config-form')?.addEventListener('submit', async (event) => {
      event.preventDefault()
      const target = event.currentTarget as HTMLFormElement
      const form = new FormData(target)
      const candidate: HermesConfig = {
        baseUrl: normalizeBaseUrl(String(form.get('baseUrl') ?? '')),
        apiKey: String(form.get('apiKey') ?? '').trim(),
      }
      await this.connectDirect(candidate).catch((err) => this.renderConfigForm(String(err.message ?? err)))
    })
    this.wireNavigation()
    this.wireDebugEvents()
  }

  private async connectDirect(candidate: HermesConfig): Promise<void> {
    const deviceBindingId = await this.bridge.deviceBindingId().catch(() => '')
    const config = { ...candidate, ...(deviceBindingId ? { deviceBindingId } : {}) }
    if (new URL(config.baseUrl).protocol !== 'https:') {
      throw new Error('Hermes Blink requires an HTTPS Gateway URL.')
    }
    if (!config.apiKey) throw new Error('Enter the scoped Hermes Blink token.')
    this.config = config
    this.client = new HermesClient(config)
    this.connectionState = 'checking'
    this.updateDebug({ hermes: 'checking health', lastRequest: 'GET /health' })
    await this.show('Connecting', 'Checking Hermes Gateway...', 0)
    const ok = await this.client.health()
    if (!ok) throw new Error('Hermes health check failed')
    this.connectionState = 'online'
    this.config = saveConfig(config, window.localStorage, window.sessionStorage)

    await this.finishConnection(config.sessionId)
  }

  private async finishConnection(selectedSessionId?: string): Promise<void> {
    this.updateDebug({ hermes: 'healthy', lastRequest: 'GET /api/sessions' })
    this.sessions = await this.client!.listSessions()
    this.session = selectedSessionId ? this.sessions.find((s) => s.id === selectedSessionId) ?? null : this.sessions[0] ?? null
    if (!this.session) {
      this.updateDebug({ lastRequest: 'POST /api/sessions' })
      this.session = await this.client!.createSession()
      this.sessions = [this.session]
    }
    this.persistSession(this.session.id)
    this.view = 'home'
    this.renderCurrentView()
    await this.show('Connected', `Session: ${this.session.title ?? this.session.id}\n\nTap once to speak. Tap again to send. Swipe to page replies.`, 0)
  }

  private renderCurrentView(): void {
    if (!this.config) {
      this.renderConfigForm()
      return
    }
    if (this.view === 'sessions') this.renderSessionsView()
    else if (this.view === 'settings') this.renderSettingsView()
    else this.renderHomeView()
  }

  private renderHomeView(): void {
    const online = this.connectionState === 'online'
    this.root.innerHTML = this.shell(`
      <section class="card connect-card">
        <button id="retry-connection" class="status-pill ${online ? 'connected' : 'disconnected'}" type="button">● ${online ? `Connected · ${escapeHtml(this.shortHost())}` : 'Connection issue · tap to retry'} <span>⌄</span></button>
        <p class="muted">Active session</p>
        <h2>${escapeHtml(this.session?.title ?? this.session?.id ?? 'No session')}</h2>
        <div class="button-row">
          <button id="refresh-sessions" type="button">Refresh sessions</button>
          <button id="new-session" type="button">New session</button>
        </div>
      </section>
      <section class="card lens-card">
        <h2>Glasses output</h2>
        <p>${escapeHtml(this.pages[this.pageIndex] ?? 'Send a message to Hermes.')}</p>
        <p class="muted">${escapeHtml(this.runStatusLabel())}</p>
      </section>
      ${this.renderRunControls()}
      ${this.renderComposer()}
      ${this.renderDebugPanel()}
    `, 'home')
    this.wireNavigation()
    this.wireHomeEvents()
    this.wireComposer()
    this.wireRunControls()
    this.wireDebugEvents()
    this.updateDebugPanel()
  }

  private renderSessionsView(): void {
    const current = this.session
      ? `<div class="empty-state"><strong>${escapeHtml(this.session.title ?? this.session.id)}</strong><br><span>${escapeHtml(this.session.id)}</span></div>`
      : '<div class="empty-state">No sessions yet</div>'
    const allSessions = this.sessions.length
      ? this.sessions.map((session) => `
        <button class="session-row ${session.id === this.session?.id ? 'selected' : ''}" type="button" data-session-id="${escapeHtml(session.id)}">
          <span>▱</span><strong>${escapeHtml(session.title || session.id)}</strong>
        </button>
      `).join('')
      : '<div class="empty-state">No sessions yet</div>'

    this.root.innerHTML = this.shell(`
      <section class="card search-card">
        <div class="search-row"><input id="session-search" aria-label="Search sessions" placeholder="Search sessions..." /><button id="refresh-sessions" type="button" aria-label="Refresh sessions" title="Refresh sessions">⌕</button></div>
      </section>
      ${this.client ? '' : '<p class="error banner">Connect to the Gateway to manage sessions</p>'}
      <section class="card">
        <h2 class="section-title">Current</h2>
        ${current}
        <h2 class="section-title row-title">All sessions <button id="new-session" type="button" aria-label="Create new session" title="Create new session">☑</button></h2>
        <div id="session-list">${allSessions}</div>
      </section>
      ${this.renderDebugPanel()}
    `, 'sessions')
    this.wireNavigation()
    this.wireHomeEvents()
    this.root.querySelectorAll<HTMLButtonElement>('[data-session-id]').forEach((button) => {
      button.addEventListener('click', () => this.selectSession(button.dataset.sessionId ?? ''))
    })
    this.root.querySelector<HTMLInputElement>('#session-search')?.addEventListener('input', (event) => {
      const query = (event.currentTarget as HTMLInputElement).value.toLowerCase()
      this.root.querySelectorAll<HTMLElement>('[data-session-id]').forEach((row) => {
        row.hidden = !row.textContent?.toLowerCase().includes(query)
      })
    })
    this.wireDebugEvents()
    this.updateDebugPanel()
  }

  private renderSettingsView(): void {
    this.root.innerHTML = this.shell(`
      <nav class="settings-tabs">
        ${Object.entries(tabLabels).map(([key, label]) => `<button class="${key === this.settingsTab ? 'active' : ''}" data-settings-tab="${key}" type="button">${label}</button>`).join('')}
      </nav>
      ${this.renderSettingsPanel()}
      ${this.renderDebugPanel()}
    `, 'settings')
    this.wireNavigation()
    this.root.querySelectorAll<HTMLButtonElement>('[data-settings-tab]').forEach((button) => {
      button.addEventListener('click', () => {
        this.settingsTab = button.dataset.settingsTab as SettingsTab
        this.renderSettingsView()
      })
    })
    this.wireSettingsEvents()
    this.wireDebugEvents()
    this.updateDebugPanel()
  }

  private renderSettingsPanel(): string {
    const s = this.settings
    if (this.settingsTab === 'display') {
      return this.settingsCard([
        section('Reading'),
        toggle('thinkingSummaries', '◌', 'Show thinking summaries', s.thinkingSummaries),
        selectRow('verbosity', '↔', 'Verbosity', s.verbosity, ['brief', 'normal', 'verbose']),
        toggle('fastScroll', '▸▸', 'Fast Scroll', s.fastScroll),
        section('Activity status'),
        toggle('activityStatus', '☷', 'Activity Status', s.activityStatus),
      ])
    }
    if (this.settingsTab === 'session') {
      return this.settingsCard([
        section('Session'),
        `<div class="setting-row"><span class="icon">▱</span><span>Current</span><strong>${escapeHtml(this.session?.title ?? this.session?.id ?? 'No session')}</strong></div>`,
        toggle('thinkingSummaries', '✦', 'Topic distiller', s.thinkingSummaries),
        section('Display behavior'),
        toggle('fastScroll', '▸▸', 'Fast scroll', s.fastScroll),
      ])
    }
    if (this.settingsTab === 'hermes') {
      return this.settingsCard([
        section('Gateway'),
        `<div class="setting-row"><span class="icon">☤</span><span>Host</span><strong>${escapeHtml(this.shortHost())}</strong></div>`,
        section('System prompt'),
        `<textarea class="settings-textarea" data-setting="systemPrompt" placeholder="Optional prompt appended before glasses requests">${escapeHtml(s.systemPrompt)}</textarea>`,
        `<p class="muted">Used to tune Hermes replies for short, readable glasses output.</p>`,
      ])
    }
    throw new Error(`Unknown settings tab: ${this.settingsTab}`)
  }

  private shell(content: string, active: AppView): string {
    return `
      <main class="app-shell">
        <header class="app-header">
          <div class="identity"><div class="logo">☤</div><div><p>Agent</p><h1>Hermes Blink</h1></div></div>
          <nav class="top-nav">
            <button data-info type="button" aria-label="Info">ⓘ</button>
            <button class="${active === 'sessions' ? 'active' : ''}" data-view="sessions" type="button" aria-label="Sessions">▱</button>
            <button class="${active === 'settings' ? 'active' : ''}" data-view="settings" type="button" aria-label="Settings">☷</button>
            <button class="${active === 'home' ? 'active' : ''}" data-view="home" type="button" aria-label="Home">⌂</button>
          </nav>
        </header>
        ${content}
      </main>
    `
  }

  private showInfoModal(): void {
    const modal = document.createElement('div')
    modal.className = 'modal-backdrop'
    modal.innerHTML = `
      <section class="info-modal" role="dialog" aria-modal="true" aria-label="Hermes Blink info">
        <header class="modal-header">
          <div class="info-heading"><span class="info-mark">☤</span><div><p>Hermes client for G2</p><h2>Hermes Blink</h2></div></div>
          <span class="version">v${escapeHtml(manifest.version)}</span>
          <button class="modal-close" type="button" aria-label="Close">×</button>
        </header>
        <p class="info-intro">A private voice-and-display client for your self-hosted Hermes. The broad Hermes credential stays on your bridge host.</p>
        <div class="info-list">
          ${infoRow('☷', 'Settings', 'Control reply length, paging and the active Hermes session.')}
          ${infoRow('◇', 'Diagnostics', 'Copy sanitized connection details from Debug. Tokens are never included.')}
          ${infoLink('Hermes documentation', 'hermes-agent.nousresearch.com/docs', 'Gateway and API server reference.')}
          ${infoLink('Source and issues', 'github.com/s0xn1ck/hermes-blink-app', 'Setup, security policy and issue tracker.')}
        </div>
      </section>
    `
    modal.addEventListener('click', (event) => {
      if (event.target === modal || (event.target as HTMLElement).closest('.modal-close')) modal.remove()
    })
    this.root.appendChild(modal)
  }

  private renderComposer(): string {
    const runActive = ['queued', 'running', 'waiting_for_approval', 'stopping'].includes(this.runStatus)
    return `
      <div class="composer voice-composer">
        <button id="composer-sessions" type="button" aria-label="Open sessions">▱</button>
        <button id="voice-toggle" class="voice-button ${this.voiceRecording ? 'recording' : ''}" type="button" ${runActive ? 'disabled' : ''}>${runActive ? 'Hermes is working…' : this.voiceRecording ? '● Listening · tap to send' : '◉ Tap glasses to speak'}</button>
      </div>
      <pre id="status" class="status-log" role="status" aria-live="polite"></pre>
    `
  }

  private renderRunControls(): string {
    if (this.runStatus === 'idle' && !this.currentRunId) return ''
    const stopVisible = ['queued', 'running', 'waiting_for_approval', 'stopping'].includes(this.runStatus)
    const approvalVisible = this.runStatus === 'waiting_for_approval'
    const approvalAction = String(this.pendingApproval?.description ?? this.pendingApproval?.command ?? this.pendingApproval?.preview ?? 'No safe details provided. Deny unless you recognize this action.').slice(0, 5_000)
    return `
      <section class="card run-card">
        <h2>${approvalVisible ? 'Approval needed' : 'Run status'}</h2>
        <p class="muted">${escapeHtml(this.runStatusLabel())}</p>
        ${stopVisible ? '<button id="stop-run" class="danger" type="button">Stop run</button>' : ''}
        ${approvalVisible ? `
          <div class="approval-details">
            <p><strong>Tool:</strong> ${escapeHtml(String(this.pendingApproval?.tool ?? 'Unknown tool'))}</p>
            <p><strong>Action:</strong></p><pre class="approval-action">${escapeHtml(approvalAction)}</pre>
            <p class="muted">Approval applies once to this request only.</p>
          </div>
          <div class="button-row approval-row">
            <button data-approval-choice="deny" class="danger" type="button">Deny</button>
            <button data-approval-choice="once" type="button">${this.approvalConfirmArmed ? 'Confirm approve once' : 'Review & approve'}</button>
          </div>` : ''}
      </section>
    `
  }

  private runStatusLabel(): string {
    if (!this.currentRunId) return 'Tap / swipe on glasses to page through replies.'
    if (this.runStatus === 'waiting_for_approval') return `Approval needed · ${this.currentRunId}`
    if (this.runStatus === 'completed') return `Done · ${this.currentRunId}`
    if (this.runStatus === 'failed') return `Failed · ${this.currentRunId}`
    if (this.runStatus === 'cancelled') return `Cancelled · ${this.currentRunId}`
    return `${this.runStatus} · ${this.currentRunId}`
  }

  private wireNavigation(): void {
    this.root.querySelector<HTMLButtonElement>('[data-info]')?.addEventListener('click', () => this.showInfoModal())
    this.root.querySelectorAll<HTMLButtonElement>('[data-view]').forEach((button) => {
      button.addEventListener('click', () => {
        this.view = button.dataset.view as AppView
        this.renderCurrentView()
      })
    })
  }

  private wireHomeEvents(): void {
    this.root.querySelector<HTMLButtonElement>('#retry-connection')?.addEventListener('click', async () => {
      if (!this.config) return
      await this.withUiErrors(() => this.connectDirect(this.config!))
    })
    this.root.querySelector<HTMLButtonElement>('#refresh-sessions')?.addEventListener('click', async () => {
      await this.withUiErrors(() => this.refreshSessions())
    })
    this.root.querySelector<HTMLButtonElement>('#new-session')?.addEventListener('click', async () => {
      if (!this.client) return
      await this.withUiErrors(async () => {
        this.updateDebug({ lastRequest: 'POST /api/sessions' })
        this.session = await this.client!.createSession()
        this.sessions = [this.session, ...this.sessions.filter((s) => s.id !== this.session!.id)]
        this.persistSession(this.session.id)
        this.renderCurrentView()
        this.setStatus(`Created ${this.session.id}`)
        await this.show('New session', this.session.title ?? this.session.id, 0)
      })
    })
  }

  private wireComposer(): void {
    this.root.querySelector<HTMLButtonElement>('#composer-sessions')?.addEventListener('click', () => {
      this.view = 'sessions'
      this.renderCurrentView()
    })
    this.root.querySelector<HTMLButtonElement>('#voice-toggle')?.addEventListener('click', async () => {
      await this.withUiErrors(() => this.toggleVoice())
    })
  }

  private captureAudio(pcm: Uint8Array): void {
    if (!this.voiceRecording || pcm.byteLength === 0) return
    this.voiceBytes += pcm.byteLength
    if (this.voiceBytes > 1_000_000) {
      void this.withUiErrors(() => this.stopVoiceAndSend())
      return
    }
    this.voiceChunks.push(pcm.slice())
  }

  private async toggleVoice(): Promise<void> {
    if (this.voiceRecording) await this.stopVoiceAndSend()
    else await this.startVoice()
  }

  private async startVoice(): Promise<void> {
    if (!this.client || !this.session) throw new Error('Connect Hermes before recording.')
    this.voiceChunks = []
    this.voiceBytes = 0
    await this.bridge.startMicrophone()
    this.voiceRecording = true
    this.voiceTimeout = globalThis.setTimeout(() => {
      void this.withUiErrors(() => this.stopVoiceAndSend())
    }, 25_000)
    this.renderCurrentView()
    this.setStatus('Listening on the G2 microphones. Tap again to send.')
    await this.show('Listening', 'Speak now. Tap again to transcribe and send.', 0)
  }

  private async stopVoiceAndSend(): Promise<void> {
    if (!this.voiceRecording || !this.client) return
    this.voiceRecording = false
    if (this.voiceTimeout !== null) globalThis.clearTimeout(this.voiceTimeout)
    this.voiceTimeout = null
    await this.bridge.stopMicrophone()
    const wav = pcm16ChunksToWav(this.voiceChunks)
    this.voiceChunks = []
    this.voiceBytes = 0
    this.setStatus('Transcribing voice…')
    await this.show('Transcribing', 'Turning your speech into a Hermes prompt…', 0)
    const transcript = await this.client.transcribeAudio(wav)
    this.setStatus(`You said: ${transcript}`)
    await this.show('You said', transcript, 0)
    await this.sendPrompt(transcript)
  }

  private wireRunControls(): void {
    this.root.querySelector<HTMLButtonElement>('#stop-run')?.addEventListener('click', async () => {
      if (!this.client || !this.currentRunId) return
      await this.withUiErrors(async () => {
        this.updateDebug({ lastRequest: `POST /v1/runs/${this.currentRunId}/stop` })
        await this.client!.stopRun(this.currentRunId!)
        this.runStatus = 'stopping'
        this.setStatus('Stopping run...')
        await this.show('Hermes', 'Stopping run...', 0)
        this.renderCurrentView()
      })
    })
    this.root.querySelectorAll<HTMLButtonElement>('[data-approval-choice]').forEach((button) => {
      button.addEventListener('click', async () => {
        if (!this.client || !this.currentRunId) return
        const choice = button.dataset.approvalChoice as ApprovalChoice
        if (choice === 'once' && !this.approvalConfirmArmed) {
          this.approvalConfirmArmed = true
          this.setStatus('Review the full action, then tap Confirm approve once.')
          this.renderCurrentView()
          return
        }
        await this.withUiErrors(async () => {
          this.updateDebug({ lastRequest: `POST /v1/runs/${this.currentRunId}/approval` })
          await this.client!.respondToApproval(this.currentRunId!, choice, String(this.pendingApproval?.approval_id ?? ''))
          this.pendingApproval = null
          this.approvalConfirmArmed = false
          this.runStatus = 'running'
          this.setStatus(`Approval sent: ${choice}`)
          await this.show('Hermes', `Approval sent: ${choice}`, 0)
          this.renderCurrentView()
        })
      })
    })
  }

  private wireSettingsEvents(): void {
    this.root.querySelectorAll<HTMLElement>('[data-toggle]').forEach((element) => {
      element.addEventListener('click', () => {
        const key = element.dataset.toggle as keyof BlinkSettings
        this.updateSetting(key, !this.settings[key])
      })
    })
    this.root.querySelectorAll<HTMLSelectElement>('[data-select]').forEach((select) => {
      select.addEventListener('change', () => this.updateSetting(select.dataset.select as keyof BlinkSettings, select.value))
    })
    this.root.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-setting]').forEach((input) => {
      input.addEventListener('change', () => this.updateSetting(input.dataset.setting as keyof BlinkSettings, input.value))
    })
  }

  private updateSetting(key: keyof BlinkSettings, value: unknown): void {
    this.settings = saveSettings({ ...this.settings, [key]: value })
    this.renderSettingsView()
  }

  private selectSession(id: string): void {
    if (!id) return
    this.session = this.sessions.find((s) => s.id === id) ?? { id }
    this.persistSession(id)
    this.renderSessionsView()
  }

  private async refreshSessions(): Promise<void> {
    if (!this.client) return
    this.updateDebug({ lastRequest: 'GET /api/sessions' })
    const sessions = await this.client.listSessions()
    this.sessions = sessions
    const previousId = this.session?.id
    this.session = previousId ? sessions.find((s) => s.id === previousId) ?? sessions[0] ?? null : sessions[0] ?? null
    if (!this.session) {
      this.updateDebug({ lastRequest: 'POST /api/sessions' })
      this.session = await this.client.createSession()
      this.sessions = [this.session]
    }
    this.persistSession(this.session.id)
    this.renderCurrentView()
    this.setStatus(`Loaded ${this.sessions.length} session(s)`)
    await this.show('Sessions refreshed', this.session.title ?? this.session.id, 0)
  }

  private async sendPrompt(prompt: string): Promise<void> {
    if (!this.client || !this.session) return
    if (['queued', 'running', 'waiting_for_approval', 'stopping'].includes(this.runStatus)) {
      throw new Error('A Hermes run is already active. Stop it before sending another message.')
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      throw new Error(`Message is too long. Keep it under ${MAX_PROMPT_CHARS.toLocaleString()} characters.`)
    }
    const tunedPrompt = buildBlinkPrompt(prompt, this.settings)
    this.runOutput = ''
    this.lastDeltaRenderAt = 0
    this.pendingApproval = null
    this.approvalConfirmArmed = false
    this.pages = chunkForG2('Starting Hermes run...')
    this.pageIndex = 0
    this.runStatus = 'queued'
    await this.show('Hermes', 'Queued...', 0)
    this.setStatus('Starting run...')
    this.updateDebug({ lastRequest: 'POST /v1/runs' })

    const run = await this.client.startRun(this.session.id, tunedPrompt, 'Reply for Hermes Blink smart glasses. Prefer short, pageable output.')
    this.currentRunId = run.run_id
    this.runStatus = 'running'
    this.updateDebug({ lastRequest: `GET /v1/runs/${run.run_id}/events` })
    this.renderCurrentView()

    let terminalEventSeen = false
    try {
      for await (const event of this.client.streamRunEvents(run.run_id)) {
        await this.applyRunEvent(event)
        if (['run.completed', 'run.failed', 'run.cancelled'].includes(event.event)) {
          terminalEventSeen = true
          break
        }
      }
    } catch (error) {
      this.updateDebug({ lastRequest: `Event stream interrupted: ${String(error instanceof Error ? error.message : error)}` })
    }
    if (!terminalEventSeen && this.currentRunId === run.run_id) {
      this.updateDebug({ lastRequest: `GET /v1/runs/${run.run_id}` })
      this.setStatus('Connection interrupted. Following the run by status…')
      await this.show('Hermes', 'Connection interrupted. Reconnecting…', 0)
      const reconciled = await this.client.waitForRunState(run.run_id)
      if (reconciled.status === 'completed') {
        await this.applyRunEvent({ event: 'run.completed', run_id: run.run_id, output: reconciled.output })
      } else if (reconciled.status === 'failed') {
        await this.applyRunEvent({ event: 'run.failed', run_id: run.run_id, error: reconciled.error })
      } else if (reconciled.status === 'cancelled') {
        await this.applyRunEvent({ event: 'run.cancelled', run_id: run.run_id })
      } else if (reconciled.status === 'waiting_for_approval') {
        await this.applyRunEvent({ event: 'approval.request', run_id: run.run_id })
      } else {
        throw new Error(`Hermes run is still ${reconciled.status} after the reconnect window. Open the session before starting another run.`)
      }
    }
  }

  private async applyRunEvent(event: HermesRunEvent): Promise<void> {
    if (event.event === 'message.delta') {
      this.runStatus = 'running'
      this.runOutput = (this.runOutput + String(event.delta ?? '')).slice(0, MAX_OUTPUT_CHARS)
      this.pages = chunkForG2(this.runOutput || 'Hermes thinking...')
      this.pageIndex = Math.min(this.pageIndex, this.pages.length - 1)
      this.setStatus(tailForPhone(this.runOutput))
      const now = Date.now()
      if (now - this.lastDeltaRenderAt >= 125) {
        this.lastDeltaRenderAt = now
        await this.renderCurrentPage()
      }
      return
    }
    if (event.event === 'approval.request') {
      this.runStatus = 'waiting_for_approval'
      this.pendingApproval = event
      this.approvalConfirmArmed = false
      this.pages = chunkForG2('Approval needed. Open phone to approve or deny.')
      this.pageIndex = 0
      this.setStatus('Approval needed')
      await this.show('Approval needed', 'Open phone to approve or deny.', 0)
      this.renderCurrentView()
      return
    }
    if (event.event === 'tool.started') {
      this.runStatus = 'running'
      const toolText = `Using tool: ${String(event.tool ?? 'tool')}`
      this.setStatus(toolText)
      if (this.settings.activityStatus) await this.show('Hermes', toolText, 0)
      return
    }
    if (event.event === 'run.completed') {
      this.runStatus = 'completed'
      const output = String(event.output ?? (this.runOutput || '(empty response)')).slice(0, MAX_OUTPUT_CHARS)
      this.runOutput = output
      this.pages = chunkForG2(output)
      this.pageIndex = 0
      await this.renderCurrentPage()
      this.setStatus(tailForPhone(output))
      this.renderCurrentView()
      return
    }
    if (event.event === 'run.failed') {
      this.runStatus = 'failed'
      const error = String(event.error ?? 'Run failed')
      this.pages = chunkForG2(error)
      this.pageIndex = 0
      await this.show('Error', error, 0)
      this.setStatus(error)
      this.renderCurrentView()
      return
    }
    if (event.event === 'run.cancelled') {
      this.runStatus = 'cancelled'
      this.pages = chunkForG2('Run cancelled.')
      this.pageIndex = 0
      await this.show('Cancelled', 'Run cancelled.', 0)
      this.setStatus('Run cancelled')
      this.renderCurrentView()
    }
  }

  private persistSession(sessionId: string): void {
    if (!this.config) return
    this.config = saveConfig({ ...this.config, sessionId }, window.localStorage, window.sessionStorage)
    this.updateDebug({ session: sessionId })
  }

  private async withUiErrors(action: () => Promise<void>): Promise<void> {
    try {
      await action()
    } catch (error) {
      const message = String(error instanceof Error ? error.message : error)
      if (error instanceof HermesApiError || error instanceof TypeError) this.connectionState = 'offline'
      this.updateDebug({ lastRequest: message })
      if (this.config && this.connectionState === 'offline') this.renderCurrentView()
      this.setStatus(message)
      this.pages = chunkForG2(message)
      this.pageIndex = 0
      await this.show('Error', message, 0)
    }
  }

  private async nextPage(): Promise<void> {
    if (this.pages.length === 0) return
    const step = this.settings.fastScroll ? 2 : 1
    this.pageIndex = Math.min(this.pageIndex + step, this.pages.length - 1)
    await this.renderCurrentPage()
  }

  private async previousPage(): Promise<void> {
    const step = this.settings.fastScroll ? 2 : 1
    this.pageIndex = Math.max(this.pageIndex - step, 0)
    await this.renderCurrentPage()
  }

  private async renderCurrentPage(): Promise<void> {
    await this.show('Hermes', this.pages[this.pageIndex] ?? '', this.pageIndex)
  }

  private async show(title: string, body: string, page: number): Promise<void> {
    await this.bridge.showText(formatLensPage(title, body, page, this.pages.length))
  }

  private setStatus(value: string): void {
    const status = this.root.querySelector<HTMLElement>('#status')
    if (status) status.textContent = value
  }

  private shortHost(): string {
    if (!this.config) return 'not connected'
    try {
      return new URL(this.config.baseUrl).host
    } catch {
      return this.config.baseUrl
    }
  }

  private updateDebug(update: Partial<DebugState>): void {
    this.debug = { ...this.debug, ...update }
    this.updateDebugPanel()
  }

  private wireDebugEvents(): void {
    this.root.querySelector<HTMLButtonElement>('#copy-debug')?.addEventListener('click', async () => {
      const payload = JSON.stringify(buildDebugPayload(this.debug, this.config?.baseUrl), null, 2)
      try {
        await navigator.clipboard?.writeText(payload)
        this.setStatus('Copied sanitized debug info')
      } catch {
        this.setStatus(payload)
      }
    })
    this.root.querySelector<HTMLButtonElement>('#reset-config')?.addEventListener('click', async () => {
      await this.withUiErrors(async () => {
        clearConfig(window.localStorage, window.sessionStorage)
        clearSettings()
        this.client = null
        this.config = null
        this.session = null
        this.sessions = []
        this.settings = defaultSettings
        this.updateDebug({ hermes: 'reset', session: 'none', lastRequest: 'cleared local credentials' })
        this.renderConfigForm('Credentials cleared. Enter your Hermes Gateway settings again.')
        await this.show('Reset', 'Hermes credentials cleared from this phone.', 0)
      })
    })
  }

  private renderDebugPanel(): string {
    return `
      <details class="debug">
        <summary>Debug</summary>
        <dl id="debug-panel">
          <dt>Bridge</dt><dd data-debug="bridge">${escapeHtml(this.debug.bridge)}</dd>
          <dt>Hermes</dt><dd data-debug="hermes">${escapeHtml(this.debug.hermes)}</dd>
          <dt>Session</dt><dd data-debug="session">${escapeHtml(this.debug.session)}</dd>
          <dt>Last G2 event</dt><dd data-debug="lastEvent">${escapeHtml(this.debug.lastEvent)}</dd>
          <dt>Last request</dt><dd data-debug="lastRequest">${escapeHtml(this.debug.lastRequest)}</dd>
        </dl>
        <div class="button-row">
          <button id="copy-debug" type="button">Copy debug</button>
          <button id="reset-config" class="danger" type="button">Reset</button>
        </div>
      </details>
    `
  }

  private updateDebugPanel(): void {
    Object.entries(this.debug).forEach(([key, value]) => {
      const element = this.root.querySelector<HTMLElement>(`[data-debug="${key}"]`)
      if (element) element.textContent = value
    })
  }

  private settingsCard(rows: string[]): string {
    return `<section class="card settings-card">${rows.join('')}</section>`
  }
}

function section(label: string): string {
  return `<h2 class="section-title">${escapeHtml(label)}</h2>`
}

function infoRow(icon: string, title: string, text: string): string {
  return `<div class="info-row"><span class="info-icon">${icon}</span><div class="info-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(text)}</small></div></div>`
}

function infoLink(title: string, subtitle: string, body: string): string {
  return `<div class="info-row linkish"><span class="info-icon">↗</span><div class="info-copy"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(subtitle)}</small><span>${escapeHtml(body)}</span></div><span class="arrow">→</span></div>`
}

function toggle(key: keyof BlinkSettings, icon: string, label: string, checked: boolean): string {
  return `<button class="setting-row setting-button" data-toggle="${key}" type="button" aria-pressed="${checked}"><span class="icon">${icon}</span><span>${escapeHtml(label)}</span><span class="toggle ${checked ? 'on' : ''}" aria-hidden="true"><span></span></span></button>`
}

function selectRow(key: keyof BlinkSettings, icon: string, label: string, value: string, options: string[]): string {
  const opts = options.map((option) => `<option value="${escapeHtml(option)}"${option === value ? ' selected' : ''}>${escapeHtml(option)}</option>`).join('')
  return `<label class="setting-row"><span class="icon">${icon}</span><span>${escapeHtml(label)}</span><select data-select="${key}">${opts}</select></label>`
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[char] ?? char))
}
