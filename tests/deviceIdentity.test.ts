import { describe, expect, it } from 'vitest'
import { deriveDeviceBindingId } from '../src/deviceIdentity'

describe('device pairing identity', () => {
  it('derives a stable, non-reversible identifier without exposing the serial number', async () => {
    const first = await deriveDeviceBindingId(' G2-SERIAL-123 ')
    const second = await deriveDeviceBindingId('G2-SERIAL-123')
    expect(first).toBe(second)
    expect(first).toMatch(/^g2_[a-f0-9]{32}$/)
    expect(first).not.toContain('SERIAL')
  })

  it('fails closed when no glasses serial is available', async () => {
    await expect(deriveDeviceBindingId('')).rejects.toThrow(/serial/i)
  })
})
