import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('..', import.meta.url).pathname

function readProject(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8')
}

describe('hardware-smoke relevance hardening', () => {
  it('does not ship placeholder voice controls before microphone/audio is implemented', () => {
    const app = readProject('src/app.ts')
    expect(app).not.toContain("'even-ai'")
    expect(app).not.toContain('Even AI')
    expect(app).not.toContain('Voice Mode')
    expect(app).not.toContain('Speech to text')
    expect(app).not.toContain('sttProvider')
    expect(app).not.toContain('data-setting="sessionTitle"')
    expect(app).not.toContain('Default Agent')
    expect(app).not.toContain('Default Model')
    expect(app).not.toContain("Agent', 'Hermes default")
    expect(app).not.toContain('Read Speed')
    expect(app).not.toContain('Stream Pages')
    expect(app).not.toContain('Exec access')
    expect(app).not.toContain('Reasoning hint')
    expect(app).not.toContain('Fast mode hint')
    expect(app).not.toContain('[data-step]')
    expect(app).not.toContain('data-step=')
  })

  it('keeps settings focused on implemented Hermes Blink behavior', () => {
    const storage = readProject('src/storage.ts')
    expect(storage).toContain('fastScroll')
    expect(storage).toContain('systemPrompt')
    expect(storage).not.toContain('readSpeedWpm')
    expect(storage).not.toContain('streamPages')
    expect(storage).not.toContain('reasoning')
    expect(storage).not.toContain('fastMode')
    expect(storage).not.toContain('execAccess')
    expect(storage).not.toContain('voiceModeAutomatic')
    expect(storage).not.toContain('conversationContext')
  })
})
