// Notifications: this session's AFK work stalling, or leaving the smart zone
// while AFK work runs, is raised once as a native notification titled Polis,
// with a toast standing in when none is sent. Waits are Claude Code's own to
// notify, never Polis's.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On, UiNotifyResult } from 'claude-code'

const ROOT = '/work/atlas'
const MINUTE = 60_000

type World = {
  clock: MockClock
  /** What the store holds under a key. */
  kept: Record<string, unknown>
  /** Every notification raised, as title and text. */
  notified: { title?: string; text: string }[]
  /** Every toast drawn. */
  toasts: string[]
  /** How the next notification is answered: sent, not sent, or refused by a hook. */
  answer: { value: UiNotifyResult } | { deny: string }
}

const SENT = { value: { isSent: true, channel: 'kitty' } } as const

// A session in /work/atlas on a terminal, outside a repository.
const world = (on: On): World => {
  const clock = mock.clock(on)
  const here: World = { clock, kept: {}, notified: [], toasts: [], answer: SENT }
  on('store.get', (_, e) => ({ value: here.kept[e.key] }))
  on('store.set', (_, e) => {
    here.kept[e.key] = e.value

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete here.kept[e.key]

    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(here.kept) }))
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
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    here.toasts.push(e.text)

    return { value: undefined }
  })
  on('ui.notify', (_, e) => {
    here.notified.push({ title: e.title, text: e.text })

    return here.answer as never
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('agent.register', (_, e) => ({ value: { agent: e.name } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('prompt.compose', () => ({ sections: [] }))
  on('classic.PermissionRequest', () => ({}))
  on('tool.call', { tool: 'Skill' }, () => ({ result: { success: true } }) as never)
  on('tool.call', { tool: 'Read' }, () => ({ result: { text: '' } }) as never)

  return here
}

const START = { cwd: ROOT, surface: null, isInteractive: false } as const

// A session on AFK work: implementing, its turn just started.
const implementing = async ($: Engine): Promise<void> => {
  await $.session.start(START)
  await $.prompt.submit({ text: '/implement', command: { name: 'implement', args: '' } } as never)
  await $.turn.start({ text: 'Implement #54', turnId: 'turn-1' })
}

const SLOW = { timeoutMs: 60_000, options: { page: false } } as const

const STALLED = { title: 'Polis', text: '"Implement #54" stalled: no progress' }

test('AFK work that stalls is notified once, naming the session and why', SLOW, async ($, on) => {
  const here = world(on)
  await implementing($)
  await here.clock.advance(4 * MINUTE)
  expect(here.notified).toEqual([])

  await here.clock.advance(3 * MINUTE)
  expect(here.notified).toEqual([STALLED])
})

test('a stall cleared by progress and begun again is a new stall, notified again', SLOW, async ($, on) => {
  const here = world(on)
  await implementing($)
  await here.clock.advance(6 * MINUTE)
  await $.tool.call({ tool: 'Read', tool_use_id: 'r1', file_path: '/work/atlas/a.ts' } as never)
  await here.clock.advance(4 * MINUTE)
  expect(here.notified).toEqual([STALLED])

  await here.clock.advance(2 * MINUTE)
  expect(here.notified).toEqual([STALLED, STALLED])
})

test('a stall that changes its reason without clearing is the same stall, not notified again', SLOW, async ($, on) => {
  const here = world(on)
  let hold: Promise<void> | undefined
  on('tool.call', { tool: 'Bash' }, async (_, e) => {
    await hold

    return (e.command === 'npm test' ? { result: 'Exit code 1\nFAIL', isError: true } : { result: { stdout: '', stderr: '', interrupted: false } }) as never
  })
  await implementing($)
  for (const id of ['1', '2', '3']) {
    await $.tool.call({ tool: 'Bash', tool_use_id: `b${id}`, command: 'npm test' })
    await $.tool.call({ tool: 'Read', tool_use_id: `r${id}`, file_path: '/work/atlas/a.ts' } as never)
  }
  expect(here.notified).toEqual([{ title: 'Polis', text: '"Implement #54" stalled: tests failed 3×' }])

  // A call left running fifteen minutes: the stall goes on, for another reason.
  let release = () => {}
  hold = new Promise(resolve => (release = resolve))
  const running = $.tool.call({ tool: 'Bash', tool_use_id: 'b4', command: 'npm run e2e' })
  await here.clock.advance(16 * MINUTE)
  release()
  await running
  expect(here.notified).toHaveLength(1)
})

test('a notification not sent is shown as a toast instead', SLOW, async ($, on) => {
  const here = world(on)
  here.answer = { value: { isSent: false, reason: 'no-surface' } }
  await implementing($)
  await here.clock.advance(6 * MINUTE)

  expect(here.notified).toEqual([STALLED])
  expect(here.toasts).toEqual([STALLED.text])
})

test('a notification refused by a hook is shown as a toast instead', SLOW, async ($, on) => {
  const here = world(on)
  here.answer = { deny: 'not now' }
  await implementing($)
  await here.clock.advance(6 * MINUTE)

  expect(here.toasts).toEqual([STALLED.text])
})

const measure = ($: Engine, tokens: number, window = 200_000) =>
  $.session.measure({
    context: { window, tokens, percent: Math.round((tokens / window) * 100) },
    rateLimits: [],
    changed: ['context'],
  } as never)

const OUT = { title: 'Polis', text: '"Implement #54" is out of the smart zone: context 151k is past 150k' }

test('AFK work leaving the smart zone is notified once per crossing, and the caution not at all', SLOW, async ($, on) => {
  const here = world(on)
  await implementing($)
  await measure($, 122_000)
  expect(here.notified).toEqual([])

  await measure($, 151_000)
  await measure($, 160_000)
  expect(here.notified).toEqual([OUT])

  // Back inside re-arms it: the next crossing is another one.
  await measure($, 100_000)
  await measure($, 151_000)
  expect(here.notified).toEqual([OUT, OUT])
})

test('leaving the smart zone off AFK work is not notified', SLOW, async ($, on) => {
  const here = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Grill me', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Skill', tool_use_id: 's1', skill: 'grilling' } as never)
  await measure($, 151_000)
  await $.turn.complete({ answer: 'done', durationMs: 4000, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await measure($, 100_000)
  await measure($, 151_000)

  expect(here.notified).toEqual([])
})

test('a wait on the person is never notified by Polis', SLOW, async ($, on) => {
  const here = world(on)
  await implementing($)
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  await here.clock.advance(10 * MINUTE)
  await $.turn.complete({ answer: 'Which one?', durationMs: 4000, isAborted: false, turnId: 'turn-1', reason: 'answer' })
  await here.clock.advance(10 * MINUTE)

  expect(here.notified).toEqual([])
})

// Another session of the project, its AFK work stalled and out of the smart
// zone, as its own record in the shared store says.
const otherStalled = (now: number) => ({
  sessionId: 'session-2',
  root: ROOT,
  title: 'Cut the tickets',
  state: 'working',
  wait: null,
  phase: 'implementing',
  kind: 'AFK',
  nextStep: '/code-review',
  task: '',
  agents: 0,
  tasksDone: 0,
  tasksTotal: 0,
  contextTokens: 160_000,
  zoneLimit: 150_000,
  tokens: 0,
  costUsd: 0,
  stall: 'no progress',
  updatedAt: now,
})

test('only the session it happened in notifies: another session stalled over the same store is not notified here', SLOW, async ($, on) => {
  const here = world(on)
  await $.session.start(START)
  for (let minute = 0; minute < 3; minute += 1) {
    here.kept[`live:${ROOT}:session-2`] = otherStalled(here.clock.now())
    await here.clock.advance(MINUTE)
  }
  expect(here.notified).toEqual([])

  // This session's own stall is notified here, once, and only its own.
  await $.prompt.submit({ text: '/implement', command: { name: 'implement', args: '' } } as never)
  await $.turn.start({ text: 'Implement #54', turnId: 'turn-1' })
  for (let minute = 0; minute < 7; minute += 1) {
    here.kept[`live:${ROOT}:session-2`] = otherStalled(here.clock.now())
    await here.clock.advance(MINUTE)
  }
  expect(here.notified).toEqual([STALLED])
})

test('a sent notification draws no toast', SLOW, async ($, on) => {
  const here = world(on)
  await implementing($)
  await here.clock.advance(6 * MINUTE)

  expect(here.toasts).toEqual([])
})
