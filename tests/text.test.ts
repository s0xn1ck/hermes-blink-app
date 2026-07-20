import { describe, expect, it } from 'vitest'
import { chunkForG2, formatLensPage, tailForPhone } from '../src/text'

describe('G2 text formatting', () => {
  it('chunks long text', () => {
    const chunks = chunkForG2('word '.repeat(250), 120)
    expect(chunks.length).toBeGreaterThan(1)
  })

  it('formats page navigation', () => {
    expect(formatLensPage('Hermes', 'hello', 0, 2)).toContain('[1/2] Tap next')
  })

  it('bounds live output', () => {
    const result = tailForPhone('a'.repeat(2_000) + 'LATEST', 200)
    expect(result.startsWith('…\n')).toBe(true)
    expect(result.endsWith('LATEST')).toBe(true)
  })
})