import { describe, expect, it } from 'vitest'
import { buildDebugPayload } from '../src/diagnostics'

describe('buildDebugPayload', () => {
  it('omits secrets and strips URL path/session ids from copied diagnostics', () => {
    const payload = buildDebugPayload(
      {
        bridge: 'ready',
        hermes: 'healthy',
        session: 'secret-session-id',
        lastEvent: 'tap',
        lastRequest: 'POST /api/sessions/secret-session-id/chat failed with token=abc123 and Authorization: Bearer secret',
      },
      'https://gateway.example.com/private/path?token=secret',
    )

    expect(payload).toMatchObject({
      bridge: 'ready',
      hermes: 'healthy',
      session: 'present',
      baseUrlHost: 'gateway.example.com',
    })
    const serialized = JSON.stringify(payload)
    expect(serialized).not.toContain('secret-session-id')
    expect(serialized).not.toContain('/private/path')
    expect(serialized).not.toContain('abc123')
    expect(serialized).not.toContain('Bearer secret')
  })
})
