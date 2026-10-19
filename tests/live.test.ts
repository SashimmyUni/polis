// Live sessions: each running session of the project keeps one record under
// its own key in the shared store, and reads the others' to say what needs
// the person elsewhere.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { liveKeeper, needsYouMark } from '../hooks/live'
import type { LiveStore } from '../hooks/live'
import type { LiveSession } from '../types'

const ROOT = '/work/atlas'
const T0 = Date.parse('2026-10-19T09:00:00Z')

// One store, as every session of the mod shares it: what one sets the others get.
const sharedStore = (): LiveStore & { kept: Map<string, unknown> } => {
  const kept = new Map<string, unknown>()

  return {
    kept,
    get: async key => kept.get(key),
    set: async (key, value) => {
      kept.set(key, JSON.parse(JSON.stringify(value)))
    },
    delete: async key => {
      kept.delete(key)
    },
    keys: async () => [...kept.keys()],
  }
}

const live = (sessionId: string, at: number, extra: Partial<LiveSession> = {}): LiveSession => ({
  sessionId,
  root: ROOT,
  title: `session ${sessionId}`,
  state: 'working',
  wait: null,
  phase: '',
  kind: '',
  nextStep: '',
  task: '',
  agents: 0,
  tasksDone: 0,
  tasksTotal: 0,
  contextTokens: 0,
  zoneLimit: 150_000,
  tokens: 0,
  costUsd: 0,
  stall: '',
  updatedAt: at,
  ...extra,
})

test('two sessions over one store each write their own key, and each sees the other and not itself', async () => {
  const store = sharedStore()
  const a = liveKeeper(store)
  const b = liveKeeper(store)
  await a.write(live('a', T0), T0)
  await b.write(live('b', T0), T0)

  expect([...store.kept.keys()]).toEqual([`live:${ROOT}:a`, `live:${ROOT}:b`])
  expect((await a.others(ROOT, 'a', T0)).map(one => one.sessionId)).toEqual(['b'])
  expect((await b.others(ROOT, 'b', T0)).map(one => one.sessionId)).toEqual(['a'])
})

test('a session silent for over two minutes is dropped from the store; one at two minutes stays', async () => {
  const store = sharedStore()
  await liveKeeper(store).write(live('quiet', T0), T0)
  await liveKeeper(store).write(live('recent', T0 + 1000), T0 + 1000)
  const reader = liveKeeper(store)

  expect((await reader.others(ROOT, 'me', T0 + 120_000)).map(one => one.sessionId)).toEqual(['quiet', 'recent'])
  expect((await reader.others(ROOT, 'me', T0 + 120_001)).map(one => one.sessionId)).toEqual(['recent'])
  expect([...store.kept.keys()]).toEqual([`live:${ROOT}:recent`])
})

test('a cleanly ended session takes its record with it at once', async () => {
  const store = sharedStore()
  const a = liveKeeper(store)
  await a.write(live('a', T0), T0)
  await a.end(ROOT, 'a')

  expect(await liveKeeper(store).others(ROOT, 'b', T0)).toEqual([])
  expect(store.kept.size).toBe(0)
})

test('a record is written on change at most every two seconds, and unchanged every thirty', async () => {
  const store = sharedStore()
  const a = liveKeeper(store)
  const at = (ms: number) => a.write(live('a', 0, { tasksDone: ms >= 1000 ? 1 : 0 }), T0 + ms)

  expect(await at(0)).toBe(true)
  // Changed, but too soon after the last write.
  expect(await at(1000)).toBe(false)
  expect(await at(2000)).toBe(true)
  // Unchanged: nothing until the heartbeat is due.
  expect(await at(10_000)).toBe(false)
  expect(await at(31_999)).toBe(false)
  expect(await at(32_000)).toBe(true)
  expect((store.kept.get(`live:${ROOT}:a`) as LiveSession).updatedAt).toBe(T0 + 32_000)
})

test('after a /clear the session writes under its new id at once and the old record goes', async () => {
  const store = sharedStore()
  const a = liveKeeper(store)
  await a.write(live('before', 0), T0)
  await a.end(ROOT, 'before')

  expect(await a.write(live('after', 0), T0 + 500)).toBe(true)
  expect([...store.kept.keys()]).toEqual([`live:${ROOT}:after`])
})

const asking = (sessionId: string, title: string, text: string, at: number): LiveSession =>
  live(sessionId, at, { title, state: 'needs you', wait: { text, at } })

test('needs you counts the other sessions that need the person beside this one', () => {
  expect(needsYouMark('a plan to approve', [])).toBe('▲ needs you: a plan to approve')
  expect(needsYouMark('a plan to approve', [asking('b', 'Fix login', 'a question for you', T0)])).toBe(
    '▲ needs you: a plan to approve · +1 in another session',
  )
  expect(
    needsYouMark('a plan to approve', [
      asking('b', 'Fix login', 'a question for you', T0),
      asking('c', 'Docs', 'permission for Bash', T0),
      live('d', T0),
    ]),
  ).toBe('▲ needs you: a plan to approve · +2 in other sessions')
})

test('when only other sessions need the person, the one waiting longest is named', () => {
  expect(needsYouMark(undefined, [live('d', T0)])).toBeUndefined()
  expect(needsYouMark(undefined, [asking('b', 'Fix login', 'a question for you', T0)])).toBe(
    '▲ needs you in "Fix login": a question for you',
  )
  expect(
    needsYouMark(undefined, [
      asking('c', 'Docs', 'permission for Bash', T0 + 5000),
      asking('b', 'Fix login', 'a question for you', T0),
    ]),
  ).toBe('▲ needs you in "Fix login": a question for you · +1 in another session')
  expect(needsYouMark(undefined, [asking('b', '', 'a plan to approve', T0)])).toBe(
    '▲ needs you in another session: a plan to approve',
  )
})

test('only the sessions of the same project are read', async () => {
  const store = sharedStore()
  await liveKeeper(store).write(live('elsewhere', T0, { root: '/work/atlas-two' }), T0)
  await liveKeeper(store).write(live('here', T0), T0)

  expect((await liveKeeper(store).others(ROOT, 'me', T0)).map(one => one.sessionId)).toEqual(['here'])
})

// ------------------------------------------------------------- the mod itself

// The engine beneath the mod for a session in /work/atlas, over a store
// other live sessions share.
const world = (on: On, kept: Record<string, unknown>) => {
  const calls: string[] = []
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = JSON.parse(JSON.stringify(e.value))

    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    delete kept[e.key]

    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(kept) }))
  on('session.surfaces', () => ({ value: ['vscode'] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.repo', () => ({ value: null }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 0, percent: 0 }, rateLimits: [] },
  }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', (_, e) => {
    calls.push(`status:${e.text ?? ''}`)

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('agent.register', (_, e) => ({ value: { agent: e.name } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.PermissionDenied', () => ({}))

  return {
    status: (): string | undefined => {
      const last = calls.filter(call => call.startsWith('status:')).at(-1)

      return last === undefined || last === 'status:' ? undefined : last.slice('status:'.length)
    },
  }
}

const START = { cwd: ROOT, surface: null, isInteractive: false } as const
const NO_PAGE = { options: { page: false } } as const

test('the mod keeps its record while the session runs and takes it away when it ends', NO_PAGE, async ($, on) => {
  const clock = mock.clock(on)
  const kept: Record<string, unknown> = {}
  world(on, kept)
  const key = `live:${ROOT}:session-1`

  await $.session.start(START)
  expect(kept[key]).toMatchObject({ sessionId: 'session-1', root: ROOT, state: 'idle', wait: null })

  await $.turn.start({ text: 'Fix the login form', turnId: 'turn-1' })
  await clock.advance(2000)
  expect(kept[key]).toMatchObject({ title: 'Fix the login form', state: 'working' })

  await $.session.end({ reason: 'other', sessionId: 'session-1' } as never)
  expect(kept[key]).toBeUndefined()
})

test('another session that needs the person is named on the status line within five seconds, and goes when it is answered', NO_PAGE, async ($, on) => {
  const clock = mock.clock(on)
  const kept: Record<string, unknown> = {}
  const { status } = world(on, kept)
  await $.session.start(START)
  expect(status()).toBeUndefined()

  const other = `live:${ROOT}:session-2`
  kept[other] = asking('session-2', 'Write the docs', 'a plan to approve', clock.now())
  await clock.advance(5000)
  expect(status()).toBe('▲ needs you in "Write the docs": a plan to approve')

  // This session needs the person too: the other one is counted.
  await $.classic.PermissionRequest({ tool_name: 'Write', tool_input: {} })
  expect(status()).toBe('▲ needs you: permission for Write · +1 in another session')
  await $.classic.PermissionDenied({ tool_name: 'Write', tool_input: {}, tool_use_id: 'w1', reason: 'no' })

  kept[other] = live('session-2', clock.now(), { title: 'Write the docs' })
  await clock.advance(5000)
  expect(status()).toBeUndefined()
})

test('a session that fell silent stops counting after two minutes', NO_PAGE, async ($, on) => {
  const clock = mock.clock(on)
  const kept: Record<string, unknown> = {}
  const { status } = world(on, kept)
  await $.session.start(START)
  kept[`live:${ROOT}:session-2`] = asking('session-2', 'Write the docs', 'a plan to approve', clock.now())
  await clock.advance(5000)
  expect(status()).toBe('▲ needs you in "Write the docs": a plan to approve')

  await clock.advance(120_000)
  expect(status()).toBeUndefined()
  expect(kept[`live:${ROOT}:session-2`]).toBeUndefined()
})
