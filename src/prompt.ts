import type { BlinkSettings } from './storage'

export function buildBlinkPrompt(prompt: string, settings: BlinkSettings): string {
  const glassesPrompt = [
    'Reply for smart glasses. Keep it concise, high-signal, and readable in short pages.',
    settings.activityStatus ? 'Include a tiny status if useful.' : '',
    settings.thinkingSummaries ? 'If reasoning is useful, summarize it briefly instead of dumping chain-of-thought.' : '',
    settings.verbosity === 'brief' ? 'Prefer one-screen answers.' : '',
    settings.verbosity === 'verbose' ? 'More detail is allowed, but preserve page readability.' : '',
    settings.systemPrompt.trim(),
    `User: ${prompt}`,
  ].filter(Boolean)
  return glassesPrompt.join('\n')
}
