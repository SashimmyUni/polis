// The project's archive as the store keeps it across sessions: seeded from
// the board, grown as tasks finish, a reopened task taken out, the oldest
// folded into exact counts, and a bad record read back safely.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Archive } from '../types'

const ROOT = '/work/atlas'
const KEY = `archive:${ROOT}`
const DAY = 24 * 3_600_000

const START = { cwd: ROOT, surface: null, isInteractive: false } as const

const turnEnd = (turnId: string) =>
  ({ answer: 'done', durationMs: 4000, isAborted: false, turnId, reason: 'answer' }) as const

type World = { kept: Record<string, unknown>; session: { id: string }; logs: string[] }

// The engine beneath the mod for a session in /work/atlas, over a store in memory.
const world = (on: On, kept: Record<string, unknown> = {}): World => {
  const session = { id: 'session-1' }
  const logs: string[] = []
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
  on('session.surfaces', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.repo', () => ({ value: null }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: session.id }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 20_000, percent: 10 }, rateLimits: [] },
  }))
  on('fs.exists', () => ({ value: true }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', (_, e) => {
    logs.push(e.text)

    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('agent.register', (_, e) => ({ value: { agent: e.name } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  let made = 0
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => {
    made += 1

    return { result: { task: { id: String(made), subject: e.subject } } }
  })
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: [] },
  }))

  return { kept, session, logs }
}

const archived = (kept: Record<string, unknown>): Archive => kept[KEY] as Archive

// One turn that creates the tasks named and finishes the first `done` of them.
const work = async ($: Engine, turnId: string, subjects: readonly string[], done: number, from = 1) => {
  await $.turn.start({ text: 'Go on', turnId })
  for (const subject of subjects) {
    await $.tool.call({
      tool: 'TaskCreate',
      tool_use_id: `c-${subject}`,
      subject,
      description: '',
      metadata: { area: 'api' },
    })
  }
  for (let index = 0; index < done; index += 1) {
    await $.tool.call({ tool: 'TaskUpdate', tool_use_id: `u-${index}`, taskId: String(from + index), status: 'completed' })
  }
  await $.turn.complete(turnEnd(turnId))
}

test('the finished tasks an earlier session left on the board start the archive', async ($, on) => {
  const clock = mock.clock(on)
  await clock.advance(10 * DAY)
  const earlier = {
    sessionId: 'session-0',
    at: clock.now() - DAY,
    tasks: [
      { id: '1', subject: 'Draw the map', status: 'completed', area: 'ui', blockedBy: [], source: 'task', doneAt: clock.now() - DAY, verdict: { state: 'passed', by: 'verifier', at: 1 } },
      { id: '2', subject: 'Write the guide', status: 'pending', area: 'docs', blockedBy: [], source: 'task' },
    ],
  }
  const { kept } = world(on, { [`tasks:${ROOT}`]: earlier })
  await $.session.start(START)

  expect(archived(kept).entries).toEqual([
    { id: 'session-/1', subject: 'Draw the map', area: 'ui', doneAt: clock.now() - DAY, sessionId: 'session-0', verdict: 'passed' },
  ])
  expect(archived(kept).folded).toEqual({})
})

test('the archive grows over two sessions, and a task carried over is archived once', async ($, on) => {
  const clock = mock.clock(on)
  const here = world(on)
  here.session.id = 'aaaaaaaa-1'
  // The clock moves before the session starts: a day of its timers is slow to run.
  await clock.advance(DAY)
  await $.session.start(START)
  await work($, 'turn-1', ['Define the schema', 'Add the route'], 1)
  expect(archived(here.kept).entries.map(entry => [entry.id, entry.subject, entry.area, entry.sessionId])).toEqual([
    ['aaaaaaaa/1', 'Define the schema', 'api', 'aaaaaaaa-1'],
  ])
  // A /clear: the process goes on under another id, the board carried as an earlier session's.
  await $.session.end({ reason: 'clear', sessionId: 'aaaaaaaa-1', resume: {} } as never)

  here.session.id = 'bbbbbbbb-2'
  // The engine here goes on numbering from three.
  await work($, 'turn-2', ['Write the docs'], 1, 3)
  expect(archived(here.kept).entries.map(entry => [entry.subject, entry.sessionId])).toEqual([
    ['Define the schema', 'aaaaaaaa-1'],
    ['Write the docs', 'bbbbbbbb-2'],
  ])
  // The carried first task is still archived once, under the name it is carried by.
  expect(archived(here.kept).entries.map(entry => entry.id)).toEqual(['aaaaaaaa/1', 'bbbbbbbb/3'])
})

test('a task reopened within the week leaves the archive', async ($, on) => {
  mock.clock(on)
  const here = world(on)
  await $.session.start(START)
  await work($, 'turn-1', ['Define the schema'], 1)
  expect(archived(here.kept).entries).toHaveLength(1)
  // A /clear: the process goes on under another id, the board carried as an earlier session's.
  await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: {} } as never)

  here.session.id = 'session-2'
  await $.turn.start({ text: 'It broke', turnId: 'turn-2' })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 'u', taskId: 'session-/1', status: 'in_progress' })
  await $.turn.complete(turnEnd('turn-2'))
  expect(archived(here.kept).entries).toEqual([])

  await $.turn.start({ text: 'Fixed', turnId: 'turn-3' })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 'u2', taskId: 'session-/1', status: 'completed' })
  await $.turn.complete(turnEnd('turn-3'))
  expect(archived(here.kept).entries.map(entry => entry.id)).toEqual(['session-/1'])
})

test('past 2,000 tasks the oldest fold into exact counts per district', async ($, on) => {
  const clock = mock.clock(on)
  await clock.advance(DAY)
  const full: Archive = {
    entries: Array.from({ length: 2000 }, (_, index) => ({
      id: `old/${index}`,
      subject: `Old task ${index}`,
      area: index < 3 ? 'docs' : 'api',
      doneAt: index,
      sessionId: 'old',
    })),
    folded: { docs: 40 },
  }
  const here = world(on, { [KEY]: full })
  await $.session.start(START)
  await work($, 'turn-1', ['One', 'Two', 'Three', 'Four'], 4)

  const kept = archived(here.kept)
  expect(kept.entries).toHaveLength(2000)
  // The four oldest went: three in docs, one in api.
  expect(kept.folded).toEqual({ docs: 43, api: 1 })
  expect(kept.entries[0]?.id).toBe('old/4')
  expect(kept.entries.slice(-4).map(entry => entry.subject)).toEqual(['One', 'Two', 'Three', 'Four'])
})

test('a corrupt or hand-edited archive is read back safely', async ($, on) => {
  mock.clock(on)
  const bad = {
    entries: [
      'not an entry',
      { id: 'a/1', subject: 'Kept', area: 'api', doneAt: 5, sessionId: 'a', verdict: 'maybe' },
      { id: 'a/1', subject: 'A duplicate', area: 'api', doneAt: 6, sessionId: 'a' },
      { id: 'a/2', subject: 'No time', area: 'api', sessionId: 'a' },
      { id: 'a/3', subject: 'x'.repeat(5000), area: 'a-very-long-district-name-indeed', doneAt: 7, sessionId: 'a' },
    ],
    folded: { api: 12, docs: -4, ui: 'many', web: Number.POSITIVE_INFINITY },
  }
  const here = world(on, { [KEY]: bad })
  await $.session.start(START)
  await work($, 'turn-1', ['Fresh'], 1)

  const kept = archived(here.kept)
  expect(kept.entries.map(entry => entry.id)).toEqual(['a/1', 'a/3', 'session-/1'])
  expect(kept.entries[0]?.verdict).toBeUndefined()
  expect(kept.entries[1]?.subject.length).toBeLessThanOrEqual(240)
  expect(kept.entries[1]?.area.length).toBeLessThanOrEqual(24)
  expect(kept.folded).toEqual({ api: 12 })
  expect(here.logs).toEqual([])
})

test('something that is no archive at all starts a new one', async ($, on) => {
  mock.clock(on)
  const here = world(on, { [KEY]: 'garbage' })
  await $.session.start(START)
  await work($, 'turn-1', ['Fresh'], 1)

  expect(archived(here.kept)).toMatchObject({ entries: [{ id: 'session-/1' }], folded: {} })
  expect(here.logs).toEqual([])
})
