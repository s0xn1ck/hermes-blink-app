export type HermesConfig = {
  baseUrl: string
  apiKey: string
  sessionId?: string
  deviceBindingId?: string
}


export type BlinkSettings = {
  fastScroll: boolean
  activityStatus: boolean
  thinkingSummaries: boolean
  verbosity: 'brief' | 'normal' | 'verbose'
  systemPrompt: string
}

const STORAGE_KEY = 'even-g2-hermes-config'
const TOKEN_STORAGE_KEY = 'even-g2-hermes-session-token'
const SETTINGS_KEY = 'hermes-blink-settings'

export const defaultSettings: BlinkSettings = {
  fastScroll: false,
  activityStatus: true,
  thinkingSummaries: true,
  verbosity: 'normal',
  systemPrompt: '',
}

export function normalizeBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, '')
  let url: URL
  try {
    url = new URL(trimmed)
  } catch {
    throw new Error('Hermes URL must start with https://')
  }
  if (url.username || url.password) throw new Error('Hermes URL must not contain credentials')
  if (url.pathname !== '/' || url.search || url.hash) throw new Error('Hermes URL must be an origin without a path, query, or fragment')
  if (url.protocol !== 'https:' && !isAllowedDevHttpUrl(trimmed)) {
    throw new Error('Hermes URL must use https:// outside local development')
  }
  return url.origin
}

export function isAllowedDevHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol !== 'http:') return false
    const host = url.hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host.startsWith('192.168.') || host.startsWith('10.') || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
  } catch {
    return false
  }
}

export function parseConfig(raw: string | null): HermesConfig | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<HermesConfig> | null
    if (!parsed || typeof parsed !== 'object' || !parsed.baseUrl || !parsed.apiKey) return null
    return {
      baseUrl: normalizeBaseUrl(parsed.baseUrl),
      apiKey: parsed.apiKey,
      sessionId: parsed.sessionId,
      deviceBindingId: parsed.deviceBindingId,
    }
  } catch {
    return null
  }
}

export function loadConfig(
  storage: Storage = window.localStorage,
  tokenStorage?: Storage,
): HermesConfig | null {
  const secrets = tokenStorage ?? storage
  const raw = storage.getItem(STORAGE_KEY)
  const apiKey = secrets.getItem(TOKEN_STORAGE_KEY)
  if (!raw || !apiKey) return null
  try {
    const parsed = JSON.parse(raw) as Partial<HermesConfig>
    if (!parsed.baseUrl) return null
    return { ...parsed, baseUrl: normalizeBaseUrl(parsed.baseUrl), apiKey }
  } catch {
    return null
  }
}

export function saveConfig(
  config: HermesConfig,
  storage: Storage = window.localStorage,
  tokenStorage?: Storage,
): HermesConfig {
  const secrets = tokenStorage ?? storage
  const normalized = { ...config, baseUrl: normalizeBaseUrl(config.baseUrl) }
  const { apiKey, ...persisted } = normalized
  storage.setItem(STORAGE_KEY, JSON.stringify(persisted))
  secrets.setItem(TOKEN_STORAGE_KEY, apiKey)
  return normalized
}

export function clearConfig(
  storage: Storage = window.localStorage,
  tokenStorage?: Storage,
): void {
  const secrets = tokenStorage ?? storage
  storage.removeItem(STORAGE_KEY)
  secrets.removeItem(TOKEN_STORAGE_KEY)
}

export function loadSettings(storage: Storage = window.localStorage): BlinkSettings {
  const raw = storage.getItem(SETTINGS_KEY)
  if (!raw) return defaultSettings
  try {
    const parsed = JSON.parse(raw) as Partial<BlinkSettings>
    return normalizeSettings(parsed)
  } catch {
    return defaultSettings
  }
}

export function saveSettings(settings: BlinkSettings, storage: Storage = window.localStorage): BlinkSettings {
  const normalized = normalizeSettings(settings)
  storage.setItem(SETTINGS_KEY, JSON.stringify(normalized))
  return normalized
}

export function clearSettings(storage: Storage = window.localStorage): void {
  storage.removeItem(SETTINGS_KEY)
}

function normalizeSettings(settings: Partial<BlinkSettings>): BlinkSettings {
  return {
    fastScroll: typeof settings.fastScroll === 'boolean' ? settings.fastScroll : defaultSettings.fastScroll,
    activityStatus: typeof settings.activityStatus === 'boolean' ? settings.activityStatus : defaultSettings.activityStatus,
    thinkingSummaries: typeof settings.thinkingSummaries === 'boolean' ? settings.thinkingSummaries : defaultSettings.thinkingSummaries,
    verbosity: settings.verbosity === 'brief' || settings.verbosity === 'normal' || settings.verbosity === 'verbose' ? settings.verbosity : defaultSettings.verbosity,
    systemPrompt: typeof settings.systemPrompt === 'string' ? settings.systemPrompt.slice(0, 1000) : defaultSettings.systemPrompt,
  }
}
