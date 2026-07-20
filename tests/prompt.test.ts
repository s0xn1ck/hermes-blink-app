import { describe, expect, it } from 'vitest'
import { buildBlinkPrompt } from '../src/prompt'
import { defaultSettings } from '../src/storage'

describe('buildBlinkPrompt', () => {
  it('always wraps the user prompt with glasses readability instructions', () => {
    const prompt = buildBlinkPrompt('summarize this', defaultSettings)
    expect(prompt).toContain('Reply for smart glasses')
    expect(prompt).toContain('User: summarize this')
  })

  it('uses only implemented display hints and trims custom system prompt', () => {
    const prompt = buildBlinkPrompt('go', {
      ...defaultSettings,
      activityStatus: false,
      thinkingSummaries: false,
      verbosity: 'brief',
      systemPrompt: '  use bullets  ',
    })
    expect(prompt).toContain('Prefer one-screen answers.')
    expect(prompt).toContain('use bullets')
    expect(prompt).not.toContain('tiny status')
    expect(prompt).not.toContain('chain-of-thought')
    expect(prompt).not.toContain('undefined')
  })
})
