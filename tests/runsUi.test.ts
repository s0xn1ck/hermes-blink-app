import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = new URL('..', import.meta.url).pathname
const app = () => readFileSync(join(root, 'src/app.ts'), 'utf8')

describe('Runs API UI wiring', () => {
  it('uses Runs/SSE instead of the legacy session chat endpoint for prompts', () => {
    const source = app()
    expect(source).toContain('startRun(')
    expect(source).toContain('streamRunEvents(')
    expect(source).toContain('stopRun(')
    expect(source).toContain('respondToApproval(')
    expect(source).toContain('waitForRunState(')
    expect(source).not.toContain('.chat(')
    expect(source).not.toContain('/chat')
  })

  it('renders lifecycle and approval controls for Hermes run state', () => {
    const source = app()
    expect(source).toContain("'waiting_for_approval'")
    expect(source).toContain('Approval needed')
    expect(source).toContain('data-approval-choice="once"')
    expect(source).toContain('data-approval-choice="deny"')
    expect(source).toContain('id="stop-run"')
    expect(source).toContain('approvalConfirmArmed')
    expect(source).toContain('Confirm approve once')
    expect(source).toContain('retry-connection')
  })
})
