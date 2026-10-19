// A main-loop turn that ends by asking the person something needs them: the
// desktop app's wrap-up ask, a numbered round of questions, or a reply that
// ends with a question. The person's next prompt answers it.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = '/work/atlas'

const START = { cwd: ROOT, surface: null, isInteractive: false } as const

const WRAP_UP = 'mcp__ccd_turn__wrap_up'

// The engine beneath the mod in an editor's chat panel, where the status line
// is what draws; returns the last status line the mod set.
const world = (on: On): (() => string | undefined) => {
  const kept: Record<string, unknown> = {}
  let last: string | undefined
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('session.surfaces', () => ({ value: ['vscode'] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.repo', () => ({ value: null }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 20_000, percent: 10 }, rateLimits: [] },
  }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', (_, e) => {
    last = e.text === undefined || e.text === '' ? undefined : e.text

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('agent.register', (_, e) => ({ value: { agent: e.name } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('tool.call', { tool: WRAP_UP } as never, () => ({ result: {} as never }))
  on('classic.PermissionRequest', () => ({}))

  return () => last
}

const ended = (answer: string, more: object = {}) =>
  ({ answer, durationMs: 4000, isAborted: false, turnId: 'turn-1', reason: 'answer', ...more }) as never

// The first element of the status line: what leads the strip.
const lead = (status: string | undefined): string | undefined => status?.split(' · ')[0]

const wrapUp = (ask?: string, more: object = {}) =>
  ({ tool: WRAP_UP, tool_use_id: 'w1', recap: 'Done.', ...(ask === undefined ? {} : { ask }), ...more }) as never

test('a reply whose last paragraph ends with a question needs the person', async ($, on) => {
  mock.clock(on)
  const status = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Fix the build', turnId: 'turn-1' })

  await $.turn.complete(ended('The build passes now.\n\n**Shall I commit?**'))

  expect(lead(status())).toBe('▲ needs you: a question for you')
})

test('a numbered round of questions needs the person, counted', async ($, on) => {
  mock.clock(on)
  const status = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Grill me on the plan', turnId: 'turn-1' })

  await $.turn.complete(
    ended('Round 2.\n\n**Q1** Who owns the store?\n\n**Q2** Files or keys?\n\n❓ And the timings?\n\nI recommend keys.'),
  )

  expect(lead(status())).toBe('▲ needs you: 3 questions for you')
})

test('the wrap-up ask needs the person, and comes before the questions in the reply', async ($, on) => {
  mock.clock(on)
  const status = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Fix the build', turnId: 'turn-1' })

  await $.tool.call(wrapUp('Commit the fix?'))
  await $.turn.complete(ended('**Q1** One?\n\n**Q2** Two?'))

  expect(lead(status())).toBe('▲ needs you: a question for you')
})

test('an empty wrap-up ask asks nothing, and a lone question marker is not a round', async ($, on) => {
  mock.clock(on)
  const status = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Fix the build', turnId: 'turn-1' })

  await $.tool.call(wrapUp(''))
  await $.turn.complete(ended('**Q1** Was it the cache?\n\nIt was: fixed.'))

  expect(status() ?? '').not.toContain('needs you')
})

test('the next prompt clears the ask', async ($, on) => {
  mock.clock(on)
  const status = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Fix the build', turnId: 'turn-1' })
  await $.tool.call(wrapUp('Commit the fix?'))
  await $.turn.complete(ended('Fixed.'))
  expect(lead(status())).toBe('▲ needs you: a question for you')

  await $.turn.start({ text: 'Yes, commit', turnId: 'turn-2' })
  expect(status() ?? '').not.toContain('needs you')
  // The wrap-up's ask was for the turn before: this one ends asking nothing.
  await $.turn.complete(ended('Committed.', { turnId: 'turn-2' }))
  expect(status() ?? '').not.toContain('needs you')
})

test('a subagent, an aborted turn and a refused turn never ask the person', async ($, on) => {
  mock.clock(on)
  const status = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Fix the build', turnId: 'turn-1' })

  await $.tool.call(wrapUp('From an agent?', { agentId: 'agent-1' }))
  await $.turn.complete(ended('Should the caller retry?', { agentId: 'agent-1', turnId: 'agent-turn' }))
  expect(status() ?? '').not.toContain('needs you')

  await $.turn.complete(ended('Shall I go on?', { reason: 'aborted', isAborted: true }))
  expect(status() ?? '').not.toContain('needs you')

  await $.turn.start({ text: 'Try again', turnId: 'turn-2' })
  await $.turn.complete(ended('Shall I go on?', { reason: 'refusal', turnId: 'turn-2' }))
  expect(status() ?? '').not.toContain('needs you')
})

test('a turn that ends asking nothing stays quiet', async ($, on) => {
  mock.clock(on)
  const status = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Fix the build', turnId: 'turn-1' })

  await $.turn.complete(ended('Is it fixed? It is: the build passes.'))

  expect(status()).toBe('ctx 20k')
})

test('an older permission still comes before the ask', async ($, on) => {
  mock.clock(on)
  const status = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Fix the build', turnId: 'turn-1' })

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {}, agent_id: 'agent-1' } as never)
  await $.turn.complete(ended('Shall I commit?'))

  expect(lead(status())).toBe('▲ needs you: permission for Bash')
})
