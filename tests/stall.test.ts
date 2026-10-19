// Stalled AFK work: silence, a call that never ends, a check failing again
// and again, an agent repeating itself. Flagged in place of the AFK element,
// cleared by progress, never for HITL work, idle sessions or open waits.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = '/work/atlas'
const MINUTE = 60_000

type World = {
  clock: MockClock
  /** The last status line the mod set, or undefined once it cleared it. */
  status: () => string | undefined
  /** What the store holds under a key. */
  kept: Record<string, unknown>
  /** How the next Bash calls end: passing, or failing with exit code 1. */
  bash: { isFailing: boolean; hold?: Promise<void> }
}

// A session in /work/atlas on a terminal, outside a repository.
const world = (on: On): World => {
  const clock = mock.clock(on)
  const kept: Record<string, unknown> = {}
  const bash: World['bash'] = { isFailing: false }
  let status: string | undefined
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete kept[e.key]

    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(kept) }))
  on('fs.exists', () => ({ value: false }))
  on('fs.write', () => ({ value: undefined }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
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
    status = e.text === '' ? undefined : e.text

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('agent.register', (_, e) => ({ value: { agent: e.name } }))
  let spawned = 0
  on('agent.spawn', () => {
    spawned += 1

    return { model: 'haiku', agentId: `agent-${spawned}` }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('prompt.compose', () => ({ sections: [] }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('tool.call', { tool: 'Skill' }, () => ({ result: { success: true } }) as never)
  on('tool.call', { tool: 'Read' }, () => ({ result: { text: '' } }) as never)
  on('tool.call', { tool: 'Edit' }, () => ({ result: { filePath: '/work/atlas/a.ts' } }) as never)
  on('tool.call', { tool: 'Bash' }, async () => {
    await bash.hold

    return (
      bash.isFailing
        ? { result: 'Exit code 1\nFAIL', isError: true }
        : { result: { stdout: '', stderr: '', interrupted: false } }
    ) as never
  })

  return { clock, status: () => status, kept, bash }
}

const START = { cwd: ROOT, surface: null, isInteractive: false } as const

const turnEnd = (turnId: string) =>
  ({ answer: 'done', durationMs: 4000, isAborted: false, turnId, reason: 'answer' }) as const

// A session on AFK work: implementing, its turn just started.
const implementing = async ($: Engine): Promise<void> => {
  await $.session.start(START)
  await $.prompt.submit({ text: '/implement', command: { name: 'implement', args: '' } } as never)
  await $.turn.start({ text: 'Implement #54', turnId: 'turn-1' })
}

// The Overview's texts, as the pane draws it in a terminal.
const overviewTexts = async ($: Engine): Promise<string[]> => {
  const ui = await $.ui.mount({
    plugin: 'polis',
    component: 'Pane',
    requestId: 'polis',
    surface: 'terminal',
    props: { title: 'Polis', isFocused: false, bodyColumns: 100, placement: 'dock', scroll: { offset: 0, bodyRows: 80 }, view: {} },
  } as never)
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()

  return texts.filter(text => text.includes('Stalled'))
}

const AFK = '◇ AFK: implementing · next: /code-review · ctx 20k'

// Minutes of clock ticks take a while to run through: without the page's
// drawing every two seconds, a call can stay in flight for fifteen of them.
const SLOW = { timeoutMs: 60_000, options: { page: false } } as const

test('AFK work silent for five minutes is stalled with no progress', SLOW, async ($, on) => {
  const here = world(on)
  await implementing($)
  await here.clock.advance(4 * MINUTE)
  expect(here.status()).toBe(AFK)

  await here.clock.advance(MINUTE)
  expect(here.status()).toBe('⚠ stalled 5m: no progress · next: /code-review · ctx 20k')
  await here.clock.advance(MINUTE)
  expect(here.status()).toBe('⚠ stalled 6m: no progress · next: /code-review · ctx 20k')
  // The moment it stalled is noted once in the Overview's activity.
  expect(await overviewTexts($)).toEqual(['Stalled: no progress'])
})

test('a tool call in flight is not silence, until it has run fifteen minutes', SLOW, async ($, on) => {
  const here = world(on)
  await implementing($)
  let release = () => {}
  here.bash.hold = new Promise(resolve => (release = resolve))
  const running = $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm run e2e' })
  await here.clock.advance(14 * MINUTE)
  expect(here.status()).toBe(AFK)

  await here.clock.advance(MINUTE)
  expect(here.status()).toBe('⚠ stalled 15m: Bash running 15m · next: /code-review · ctx 20k')

  release()
  await running
  expect(here.status()).toBe(AFK)
})

test('the same check failing three times in a row stalls work until it passes', SLOW, async ($, on) => {
  const here = world(on)
  await implementing($)
  here.bash.isFailing = true
  const edit = (id: string) => $.tool.call({ tool: 'Edit', tool_use_id: id, file_path: '/work/atlas/a.ts', old_string: 'a', new_string: 'b' } as never)

  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' })
  await edit('e1')
  await here.clock.advance(MINUTE)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b2', command: 'npx tsc --noEmit' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b3', command: 'npm test' })
  await edit('e2')
  expect(here.status()).toBe(AFK)

  await here.clock.advance(MINUTE)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b4', command: 'npm test' })
  expect(here.status()).toBe('⚠ stalled 2m: tests failed 3× · next: /code-review · ctx 20k')
  // Edits and other calls go on, and the fix loop is still going nowhere.
  await edit('e3')
  expect(here.status()).toBe('⚠ stalled 2m: tests failed 3× · next: /code-review · ctx 20k')

  here.bash.isFailing = false
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b5', command: 'npm test' })
  expect(here.status()).toBe(AFK)
})

const LIVE = `live:${ROOT}:session-1`
const stallKept = (here: World): unknown => (here.kept[LIVE] as { stall?: unknown } | undefined)?.stall

test('the stall reason goes into the live record, and leaves it with the stall', SLOW, async ($, on) => {
  const here = world(on)
  await implementing($)
  await here.clock.advance(6 * MINUTE)
  expect(stallKept(here)).toBe('no progress')

  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/work/atlas/a.ts' } as never)
  await here.clock.advance(2000)
  expect(stallKept(here)).toBe('')
})

test('HITL work is never stalled', SLOW, async ($, on) => {
  const here = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Grill me', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Skill', tool_use_id: 's1', skill: 'grilling' } as never)
  await here.clock.advance(6 * MINUTE)

  expect(here.status()).toBe('◆ HITL: grilling · next: /to-spec · ctx 20k')
  expect(stallKept(here)).toBe('')
})

test('an idle session is never stalled', SLOW, async ($, on) => {
  const here = world(on)
  await implementing($)
  await $.turn.complete(turnEnd('turn-1'))
  await here.clock.advance(6 * MINUTE)

  expect(here.status()).toBe('next: /code-review · ctx 20k')
  expect(stallKept(here)).toBe('')
})

test('work waiting on the person is never stalled', SLOW, async ($, on) => {
  const here = world(on)
  await implementing($)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  await here.clock.advance(6 * MINUTE)

  expect(here.status()).toBe('▲ needs you: permission for Bash · next: /code-review · ctx 20k')
  expect(stallKept(here)).toBe('')
})

const WORKER = {
  tool_use_id: 'a1',
  prompt: 'Do it',
  description: 'Write the table',
  subagentType: 'polis:worker',
  provider: { plugin: 'polis', tier: 'user' },
  parentModel: 'opus',
  background: true,
  fork: false,
} as const

test('an agent making the same call with the same input three times in a row stalls work until it does something else', SLOW, async ($, on) => {
  const here = world(on)
  await implementing($)
  await $.agent.spawn(WORKER)
  const read = (id: string, path: string, agentId?: string) =>
    $.tool.call({ tool: 'Read', tool_use_id: id, file_path: path, ...(agentId === undefined ? {} : { agentId }) } as never)
  const WORKING = '◇ AFK: implementing · 1 agent · next: /code-review · ctx 20k'

  await read('r1', '/work/atlas/a.ts', 'agent-1')
  await here.clock.advance(MINUTE)
  // Another agent's calls, here the main loop's, are no break in this one's row.
  await read('r2', '/work/atlas/b.ts')
  await read('r3', '/work/atlas/a.ts', 'agent-1')
  // The same tool on another input is another call.
  await read('r4', '/work/atlas/c.ts')
  await read('r5', '/work/atlas/c.ts')
  expect(here.status()).toBe(WORKING)

  await here.clock.advance(MINUTE)
  await read('r6', '/work/atlas/a.ts', 'agent-1')
  expect(here.status()).toBe(`⚠ stalled 2m: same call 3× · next: /code-review · ctx 20k`)

  await read('r7', '/work/atlas/d.ts', 'agent-1')
  expect(here.status()).toBe(WORKING)
})

test('a tool call or an agent event clears the stall at once', SLOW, async ($, on) => {
  const here = world(on)
  await implementing($)
  const stalled = async () => {
    await here.clock.advance(5 * MINUTE)
    expect(here.status()).toMatch(/^⚠ stalled 5m: no progress/)
  }

  await stalled()
  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/work/atlas/a.ts' } as never)
  expect(here.status()).toBe(AFK)

  await stalled()
  await $.agent.spawn(WORKER)
  expect(here.status()).toBe('◇ AFK: implementing · 1 agent · next: /code-review · ctx 20k')

  await stalled()
  await $.turn.complete({ ...turnEnd('turn-1'), agentId: 'agent-1' })
  expect(here.status()).toBe(AFK)
})
