import { describe, expect, it, vi } from 'vitest'
import { createPreviewBridge } from '../src/g2Bridge'

describe('preview bridge', () => {
  it('renders without Even hardware and forwards glasses text to the preview sink', async () => {
    const sink = vi.fn()
    const bridge = createPreviewBridge(sink)

    await bridge.showText('Hello glasses')

    expect(sink).toHaveBeenCalledWith('Hello glasses')
    await expect(bridge.deviceBindingId()).resolves.toBe('preview-device')
    await expect(bridge.exit()).resolves.toBeUndefined()
  })
})
