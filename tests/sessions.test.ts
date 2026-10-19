// The Sessions block: the Agents view opens with every live session of the
// project, this one marked, each answering what it is doing, whether it is
// moving, how far it has got, what it costs and when it next needs the
// person. With this session alone live, the block is left out.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { LiveSession } from '../types'

const ROOT = '/work/atlas'

const START = { cwd: ROOT, surface: null, isInteractive: false } as const
const NO_PAGE = { options: { page: false } } as const

const paneAt = (bodyColumns: number) =>
  ({
    plugin: 'polis',
    component: 'Pane',
    requestId: 'polis',
    surface: 'terminal',
    props: {
      title: 'Polis',
      isFocused: false,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 80 },
      view: {},
    },
  }) as const

// The engine beneath the mod for a session in /work/atlas, over a store
// other live sessions share. This session has spent $0.40 so far.
const world = (on: On, kept: Record<string, unknown>): void => {
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
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.repo', () => ({ value: null }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200_000, tokens: 30_000, percent: 15 },
      cost: { usd: 0.4 },
      rateLimits: [],
    },
  }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('agent.register', (_, e) => ({ value: { agent: e.name } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('process.run', () => ({ value: { exitCode: 128, stdout: '', stderr: 'not a repository' } as never }))
  on('tool.call', { tool: 'Skill' }, () => ({ result: { success: true } }) as never)
}

const other = (sessionId: string, at: number, extra: Partial<LiveSession> = {}): LiveSession => ({
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
  movedAt: at,
  ...extra,
})

// The Agents view's texts, in the order drawn.
const agentsTexts = async ($: Engine, columns = 90): Promise<string[]> => {
  const ui = await $.ui.mount(paneAt(columns))
  await ui.press({ key: 'view-agents' })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()

  return texts
}

// The Sessions block's texts: from its heading up to the AGENTS heading.
const sessionsBlock = async ($: Engine, columns = 90): Promise<string[]> => {
  const texts = await agentsTexts($, columns)
  const at = texts.indexOf('SESSIONS')

  return at < 0 ? [] : texts.slice(at, texts.indexOf('AGENTS'))
}

test('with another session live, the Agents view opens with both, newest activity first, this one marked', NO_PAGE, async ($, on) => {
  const clock = mock.clock(on)
  const kept: Record<string, unknown> = {}
  world(on, kept)
  await $.session.start(START)
  await $.turn.start({ text: 'Implement the Sessions block', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Skill', tool_use_id: 's-1', skill: 'implement' } as never)

  kept[`live:${ROOT}:session-2`] = other('session-2', clock.now(), {
    title: 'Write the docs',
    state: 'needs you',
    wait: { text: 'a plan to approve', at: clock.now() },
    phase: 'writing the spec',
    kind: 'HITL',
    nextStep: '/to-tickets',
    task: 'Draft the manual',
    tasksDone: 2,
    tasksTotal: 5,
    contextTokens: 60_000,
    zoneLimit: 100_000,
    tokens: 1_200_000,
    costUsd: 3.1,
  })
  await clock.advance(5000)

  const block = await sessionsBlock($)
  expect(block[0]).toBe('SESSIONS')
  expect(block[1]).toBe('2 live · 1.2M tokens · $3.50')
  // This session acted last: it comes first.
  expect(block.slice(2)).toEqual([
    '●',
    'Implement the Sessions block',
    'working · you are here',
    'implementing · ctx 30k of 150k · next: /code-review',
    '○',
    'Write the docs',
    'needs you: a plan to approve',
    'writing the spec · Draft the manual · 2/5 · ctx 60k of 100k · 1.2M tokens · next: /to-tickets',
  ])
})

test('with this session the only live one, there is no Sessions block', NO_PAGE, async ($, on) => {
  const clock = mock.clock(on)
  const kept: Record<string, unknown> = {}
  world(on, kept)
  await $.session.start(START)
  await clock.advance(5000)

  const texts = await agentsTexts($)
  expect(texts).not.toContain('SESSIONS')
  expect(texts).toContain('AGENTS')
})

test('the other sessions follow by their latest activity, and the heading sums every live one', NO_PAGE, async ($, on) => {
  const clock = mock.clock(on)
  const kept: Record<string, unknown> = {}
  world(on, kept)
  await $.session.start(START)
  kept[`live:${ROOT}:older`] = other('older', clock.now() - 60_000, { title: 'Older', state: 'idle', tokens: 400_000, costUsd: 1 })
  kept[`live:${ROOT}:newer`] = other('newer', clock.now() - 1000, { title: 'Newer', tokens: 100_000, costUsd: 0.6 })
  await clock.advance(5000)

  const block = await sessionsBlock($)
  expect(block[1]).toBe('3 live · 500k tokens · $2.00')
  expect(block.filter(text => ['Older', 'Newer'].includes(text))).toEqual(['Newer', 'Older'])
  expect(block).toContain('idle')
  // Nothing worked yet this session: it says only that it is idle.
  expect(block.slice(2, 5)).toEqual(['●', 'untitled session', 'idle · you are here'])
})

test('sessions follow by when they last changed, not by their heartbeats, this one included', NO_PAGE, async ($, on) => {
  const clock = mock.clock(on)
  const kept: Record<string, unknown> = {}
  world(on, kept)
  await $.session.start(START)
  // This session has done nothing since it started, a minute and a half ago.
  await clock.advance(90_000)
  const now = clock.now()
  kept[`live:${ROOT}:beating`] = other('beating', now - 1000, { title: 'Beating', movedAt: now - 80_000 })
  kept[`live:${ROOT}:moving`] = other('moving', now - 20_000, { title: 'Moving', movedAt: now - 30_000 })
  await clock.advance(5000)

  const block = await sessionsBlock($)
  const titles = block.filter(text => ['Moving', 'Beating', 'untitled session'].includes(text))
  expect(titles).toEqual(['Moving', 'Beating', 'untitled session'])
})

test('a narrow pane wraps the entries rather than cutting them', NO_PAGE, async ($, on) => {
  const clock = mock.clock(on)
  const kept: Record<string, unknown> = {}
  world(on, kept)
  await $.session.start(START)
  const detail = 'writing the spec · Draft the manual · 2/5 · next: /to-tickets'
  kept[`live:${ROOT}:session-2`] = other('session-2', clock.now(), {
    title: 'Write the docs for every surface',
    phase: 'writing the spec',
    task: 'Draft the manual',
    tasksDone: 2,
    tasksTotal: 5,
    nextStep: '/to-tickets',
  })
  await clock.advance(5000)

  for (const [columns, wrap] of [[21, 'wrap'], [90, 'truncate-end']] as const) {
    const ui = await $.ui.mount(paneAt(columns))
    await ui.press({ key: 'view-agents' })
    expect((await ui.find({ type: 'Text', text: detail }))?.props.wrap).toBe(wrap)
    expect((await ui.find({ type: 'Text', text: 'Write the docs for every surface' }))?.props.wrap).toBe(wrap)
    await ui.unmount()
  }
})
