import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const app = readFileSync(new URL('../src/app.ts', import.meta.url), 'utf8')
const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')

describe('info panel', () => {
  it('uses the manifest version instead of a stale hard-coded version', () => {
    expect(app).toContain("import manifest from '../app.json'")
    expect(app).toContain('v${escapeHtml(manifest.version)}')
    expect(app).not.toContain('<span class="version">v0.1.0</span>')
  })

  it('prevents cards and long links from creating horizontal scroll', () => {
    expect(styles).toMatch(/\.info-modal\s*\{[^}]*box-sizing:\s*border-box/s)
    expect(styles).toMatch(/\.info-row\s*>\s*div\s*\{[^}]*min-width:\s*0/s)
    expect(styles).toMatch(/\.info-row\s+(?:a|small)[^{]*\{[^}]*overflow-wrap:\s*anywhere/s)
  })
})
