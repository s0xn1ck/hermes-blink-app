const SAMPLE_RATE = 16_000
const MAX_PCM_BYTES = 1_000_000

export function pcm16ChunksToWav(chunks: Uint8Array[]): Blob {
  const pcmBytes = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0)
  if (pcmBytes === 0) throw new Error('No audio was captured from the G2 microphones.')
  if (pcmBytes > MAX_PCM_BYTES) throw new Error('Voice recording is too long. Keep it under 30 seconds.')

  const buffer = new ArrayBuffer(44 + pcmBytes)
  const view = new DataView(buffer)
  const bytes = new Uint8Array(buffer)
  const text = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index)
  }
  text(0, 'RIFF')
  view.setUint32(4, 36 + pcmBytes, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, pcmBytes, true)

  let offset = 44
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new Blob([buffer], { type: 'audio/wav' })
}
