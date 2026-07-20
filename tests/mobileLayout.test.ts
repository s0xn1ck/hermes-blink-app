import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const styles = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')

describe('mobile WebView scrolling', () => {
  it('uses one explicit touch-scroll container instead of the document body', () => {
    expect(styles).toMatch(/html, body\s*\{[^}]*height:\s*100%[^}]*overflow:\s*hidden/s)
    expect(styles).toMatch(/#app\s*\{[^}]*overflow-y:\s*auto[^}]*touch-action:\s*pan-y/s)
  })

  it('keeps form controls compatible with vertical touch scrolling', () => {
    expect(styles).toMatch(/input, textarea, select\s*\{[^}]*touch-action:\s*pan-y/s)
  })
})