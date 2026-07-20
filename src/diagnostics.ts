export type DebugSnapshot = {
  bridge: string
  hermes: string
  session: string
  lastEvent: string
  lastRequest: string
}

export type DebugPayload = {
  bridge: string
  hermes: string
  session: 'none' | 'present'
  lastEvent: string
  lastRequest: string
  baseUrlHost: string
}

export function buildDebugPayload(debug: DebugSnapshot, baseUrl?: string | null): DebugPayload {
  return {
    bridge: truncate(debug.bridge, 120),
    hermes: truncate(debug.hermes, 120),
    session: debug.session && debug.session !== 'none' ? 'present' : 'none',
    lastEvent: truncate(debug.lastEvent, 80),
    lastRequest: sanitizeLastRequest(debug.lastRequest),
    baseUrlHost: safeHost(baseUrl),
  }
}

function sanitizeLastRequest(value: string): string {
  return truncate(value
    .replace(/Bearer\s+\S+/gi, 'Bearer [redacted]')
    .replace(/token=[^\s&]+/gi, 'token=[redacted]')
    .replace(/\/api\/sessions\/[^\s/]+/g, '/api/sessions/[redacted]'), 180)
}

function safeHost(value?: string | null): string {
  if (!value) return 'none'
  try {
    return new URL(value).host
  } catch {
    return 'invalid-url'
  }
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value
}
