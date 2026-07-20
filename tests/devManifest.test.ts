import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname

describe('dev manifest generation', () => {
  it('writes a temporary dev manifest with a single explicit network origin', () => {
    execFileSync('node', ['scripts/pack-dev.mjs'], {
      cwd: root,
      env: { ...process.env, HERMES_BLINK_API_ORIGIN: 'https://dev-hermes.example.com:8642/api' },
      stdio: 'pipe',
    })
    const manifest = JSON.parse(readFileSync(join(root, '.tmp/app.dev.generated.json'), 'utf8'))
    expect(manifest.name).toBe('Hermes Blink Dev')
    expect(manifest.package_id).toBe('com.s0xn1ck.hermesblink.dev')
    expect(manifest.permissions.find((p: any) => p.name === 'network').whitelist).toEqual(['https://dev-hermes.example.com:8642'])
  })
})
