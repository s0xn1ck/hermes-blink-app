import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('..', import.meta.url).pathname

function readProject(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('direct self-hosted guardrails', () => {
  it('keeps the package and Even manifest versions aligned', () => {
    const manifest = JSON.parse(readProject('app.json'))
    const packageJson = JSON.parse(readProject('package.json'))
    expect(manifest.version).toBe(packageJson.version)
  })

  it('uses only user-entered HTTPS Hermes credentials and no shared relay', () => {
    const app = readProject('src/app.ts')
    expect(app).toContain('Hermes Gateway URL')
    expect(app).toContain("protocol !== 'https:'")
    expect(app).toContain('connectDirect')
    expect(app).not.toContain('PROD_RELAY_ORIGIN')
    expect(app).not.toContain('connectRelay')
    expect(app).not.toContain('BlinkRelayClient')
  })

  it('per-user pack injects the exact user Gateway origin into the manifest', () => {
    const script = readProject('scripts/pack-dev.mjs')
    expect(script).toContain('VITE_HERMES_BLINK_API_ORIGIN')
    expect(script).toContain('whitelist: [origin]')
  })
})
