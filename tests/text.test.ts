import { describe, expect, it } from 'vitest'
import { chunkForG2, formatLensPage } from '../src/text'

describe('G2 text formatting', () => {
  it('chunks long text below the per-page limit', () => {
    const chunks = chunkForG2('word '.repeat(250), 120)
    expect(chunks.length).toBeGreaterThan(1)
    expect(chunks.every((chunk) => chunk.length <= 120)).toBe(true)
  })

  it('formats page with navigation suffix when multipage', () => {
    expect(formatLensPage('Hermes', 'hello', 0, 2)).toContain('[1/2] Tap next')
  })
})
