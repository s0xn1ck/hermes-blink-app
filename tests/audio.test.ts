import { describe, expect, it } from 'vitest'
import { pcm16ChunksToWav } from '../src/audio'

describe('G2 microphone audio', () => {
  it('wraps 16 kHz mono PCM chunks in a valid WAV file', async () => {
    const wav = pcm16ChunksToWav([new Uint8Array([1, 2]), new Uint8Array([3, 4])])
    const bytes = new Uint8Array(await wav.arrayBuffer())
    expect(new TextDecoder().decode(bytes.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(bytes.slice(8, 12))).toBe('WAVE')
    expect(new DataView(bytes.buffer).getUint32(24, true)).toBe(16_000)
    expect(new DataView(bytes.buffer).getUint32(40, true)).toBe(4)
    expect([...bytes.slice(44)]).toEqual([1, 2, 3, 4])
  })

  it('rejects empty or oversized recordings', () => {
    expect(() => pcm16ChunksToWav([])).toThrow(/no audio/i)
    expect(() => pcm16ChunksToWav([new Uint8Array(1_000_001)])).toThrow(/too long/i)
  })
})
