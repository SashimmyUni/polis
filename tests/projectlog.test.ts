import { expect, test } from 'claude-code/testing'

import {
  MAX_SESSIONS,
  agentTree,
  asProjectLog,
  countAgents,
  emptyLog,
  projectHeadline,
  projectLines,
  sessionRecord,
  totalsOf,
  upsertSession,
} from '../hooks/projectlog'
import type { AgentNode, ProjectLog, SessionRecord } from '../hooks/projectlog'
import type { AgentRun, AgentRunStatus, Task } from '../types'

const ROOT = 'C:\\Work\\atlas'
const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR
const NOW = 100 * DAY

const run = (key: string, extra: Partial<AgentRun> = {}): AgentRun => ({
  key,
  agentId: key,
  label: `label of ${key}`,
  type: 'general-purpose',
  status: 'done',
  tools: 0,
  families: {},
  tokens: 0,
  startedAt: 0,
  ...extra,
})

const node = (key: string, extra: Partial<AgentNode> = {}): AgentNode => ({
  key,
  type: 'general-purpose',
  label: `label of ${key}`,
  status: 'done',
  tokens: 0,
  tools: 0,
  startedAt: 0,
  children: [],
  ...extra,
})

const task = (id: string, status: Task['status']): Task => ({
  id,
  subject: `Task ${id}`,
  status,
  area: 'general',
  blockedBy: [],
  source: 'task',
})

const session = (id: string, startedAt: number, extra: Partial<SessionRecord> = {}): SessionRecord => ({
  id,
  startedAt,
  lastActive: startedAt + HOUR,
  title: `Session ${id}`,
  turns: 3,
  tokens: 1000,
  costUsd: 1,
  tasksDone: 1,
  tasksTotal: 2,
  filesEdited: 4,
  agents: [],
  ...extra,
})

const logOf = (...sessions: SessionRecord[]): ProjectLog => ({ root: ROOT, sessions })

const status = (value: AgentRunStatus): AgentRunStatus => value

test('agent tree: three levels, oldest first, nothing dropped', () => {
  const tree = agentTree([
    run('c1', { parentAgentId: 'b', startedAt: 40, tokens: 5 }),
    run('b', { parentAgentId: 'a', startedAt: 20, status: status('running'), name: 'scout', tokens: 900, tools: 7 }),
    run('a2', { startedAt: 30, endedAt: 31 }),
    run('a', { startedAt: 10, endedAt: 99, type: 'Explore' }),
    run('c0', { parentAgentId: 'b', startedAt: 35 }),
  ])

  expect(tree.map(one => one.key)).toEqual(['a', 'a2'])
  const a = tree[0]
  expect(a?.type).toBe('Explore')
  expect(a?.endedAt).toBe(99)
  expect(a?.name).toBeUndefined()
  expect(a?.children.map(one => one.key)).toEqual(['b'])
  const b = a?.children[0]
  expect(b).toMatchObject({ name: 'scout', status: 'running', tokens: 900, tools: 7, startedAt: 20 })
  expect(b?.endedAt).toBeUndefined()
  expect(b?.children.map(one => one.key)).toEqual(['c0', 'c1'])
  expect(countAgents(tree)).toEqual({ agents: 2, subAgents: 3 })
  expect(tree[1]?.endedAt).toBe(31)
})

test('agent tree: an unknown or own parent leaves a run top-level; none is shown twice', () => {
  const tree = agentTree([
    run('a', { parentAgentId: 'ghost', startedAt: 1 }),
    run('b', { parentAgentId: 'b', startedAt: 2 }),
    run('c', { startedAt: 3 }),
    // A run with no agent id of its own can spawn nothing.
    { ...run('d', { startedAt: 4 }), agentId: undefined },
  ])

  expect(tree.map(one => one.key)).toEqual(['a', 'b', 'c', 'd'])
  expect(agentTree([])).toEqual([])
})

test('agent tree: a cycle in the parent links is cut and no run appears twice', () => {
  const tree = agentTree([
    run('x', { parentAgentId: 'z', startedAt: 1 }),
    run('y', { parentAgentId: 'x', startedAt: 2 }),
    run('z', { parentAgentId: 'y', startedAt: 3 }),
    run('r', { startedAt: 0 }),
  ])
  const keys: string[] = []
  const walk = (nodes: readonly AgentNode[]): void => {
    for (const one of nodes) {
      keys.push(one.key)
      walk(one.children)
    }
  }
  walk(tree)

  expect(keys.slice().sort()).toEqual(['r', 'x', 'y', 'z'])
  expect(tree.map(one => one.key)).toEqual(['r', 'x'])
  expect(tree[1]?.children[0]?.key).toBe('y')
  expect(tree[1]?.children[0]?.children[0]?.key).toBe('z')
  expect(tree[1]?.children[0]?.children[0]?.children).toEqual([])
})

test('session record: the session as it stands now', () => {
  const record = sessionRecord({
    id: 's1',
    startedAt: 1000,
    now: 5000,
    title: `  fix the\n login ${'very '.repeat(30)}bug`,
    turns: 4,
    tokens: 12_345,
    costUsd: 0.5,
    tasks: [task('1', 'completed'), task('2', 'in_progress'), task('3', 'completed'), task('4', 'pending')],
    filesEdited: 6,
    agents: [run('a', { startedAt: 1 }), run('b', { parentAgentId: 'a', startedAt: 2 })],
  })

  expect(record).toMatchObject({
    id: 's1',
    startedAt: 1000,
    lastActive: 5000,
    turns: 4,
    tokens: 12_345,
    costUsd: 0.5,
    tasksDone: 2,
    tasksTotal: 4,
    filesEdited: 6,
  })
  expect(record.title.length).toBe(80)
  expect(record.title.startsWith('fix the login very')).toBe(true)
  expect(record.title.endsWith('…')).toBe(true)
  expect(record.agents.map(one => one.key)).toEqual(['a'])
  expect(record.agents[0]?.children.map(one => one.key)).toEqual(['b'])
})

test('saved log: malformed data is dropped piece by piece, never thrown on', () => {
  expect(asProjectLog(undefined, ROOT)).toEqual(emptyLog(ROOT))
  expect(asProjectLog(null, ROOT)).toEqual(emptyLog(ROOT))
  expect(asProjectLog('log', ROOT)).toEqual(emptyLog(ROOT))
  expect(asProjectLog([], ROOT)).toEqual(emptyLog(ROOT))
  expect(asProjectLog({ root: ROOT }, ROOT)).toEqual(emptyLog(ROOT))
  expect(asProjectLog({ root: ROOT, sessions: 'many' }, ROOT)).toEqual(emptyLog(ROOT))

  // A log kept for another project is not this one's.
  expect(asProjectLog(logOf(session('s1', 1)), 'C:\\Work\\other')).toEqual(emptyLog('C:\\Work\\other'))

  const damaged = {
    root: ROOT,
    sessions: [
      null,
      7,
      'x',
      { startedAt: 5 },
      { id: '', startedAt: 5 },
      { id: 42 },
      {
        id: 'ok',
        startedAt: 'yesterday',
        lastActive: NaN,
        title: 12,
        turns: -3,
        tokens: '900',
        costUsd: Infinity,
        tasksDone: null,
        tasksTotal: {},
        agents: [
          null,
          { type: 'no key', status: 'done' },
          { key: 'bad-status', status: 'sleeping' },
          { key: 'bare', status: 'failed' },
          {
            key: 'deep',
            type: 'Explore',
            label: 'search',
            name: 'scout',
            status: 'running',
            tokens: 50,
            tools: 'many',
            startedAt: 9,
            endedAt: 12,
            children: [{ key: 'kid', status: 'done', tokens: 1 }, 'junk', { key: 'kid2', status: 'x' }],
          },
        ],
      },
      { id: 'agents-not-list', startedAt: 3, agents: { key: 'a' } },
    ],
  }
  const log = asProjectLog(damaged, ROOT)

  expect(log.root).toBe(ROOT)
  // Kept in the order they began; the damaged start time fell back to 0.
  expect(log.sessions.map(one => one.id)).toEqual(['ok', 'agents-not-list'])
  expect(log.sessions[1]?.agents).toEqual([])
  const ok = log.sessions[0]
  expect(ok).toMatchObject({
    startedAt: 0,
    lastActive: 0,
    title: '',
    turns: 0,
    tokens: 0,
    costUsd: 0,
    tasksDone: 0,
    tasksTotal: 0,
    filesEdited: 0,
  })
  expect(ok?.agents.map(one => one.key)).toEqual(['bare', 'deep'])
  expect(ok?.agents[0]).toEqual({
    key: 'bare',
    type: '',
    label: '',
    status: 'failed',
    tokens: 0,
    tools: 0,
    startedAt: 0,
    children: [],
  })
  const deep = ok?.agents[1]
  expect(deep).toMatchObject({ name: 'scout', tools: 0, endedAt: 12, tokens: 50 })
  expect(deep?.children.map(one => one.key)).toEqual(['kid'])
})

test('saved log: a good log comes back as it was, and a duplicated id keeps the last', () => {
  const good = logOf(
    session('s1', 100, { agents: [node('a', { children: [node('b', { name: 'n', endedAt: 5 })] })] }),
    session('s2', 200),
  )

  expect(asProjectLog(JSON.parse(JSON.stringify(good)), ROOT)).toEqual(good)

  const twice = asProjectLog({ root: ROOT, sessions: [session('s1', 100), session('s1', 100, { turns: 9 })] }, ROOT)
  expect(twice.sessions).toHaveLength(1)
  expect(twice.sessions[0]?.turns).toBe(9)
})

test('saved log: a tree too deep or too wide is cut, not followed', () => {
  let chain: unknown = { key: 'leaf', status: 'done' }
  for (let i = 0; i < 40; i += 1) chain = { key: `n${i}`, status: 'done', children: [chain] }
  const wide = Array.from({ length: 200 }, (_, i) => ({ key: `w${i}`, status: 'done' }))
  const log = asProjectLog({ root: ROOT, sessions: [{ id: 's', agents: [chain, ...wide] }] }, ROOT)
  const agents = log.sessions[0]?.agents ?? []

  expect(agents).toHaveLength(60)
  let depth = 0
  for (let at: AgentNode | undefined = agents[0]; at !== undefined; at = at.children[0]) depth += 1
  expect(depth).toBeLessThan(12)
})

test('upsert: a session with the same id is replaced, a new one appended in order', () => {
  const log = logOf(session('s1', 100, { turns: 1 }), session('s3', 300))
  const frozen = JSON.stringify(log)

  const replaced = upsertSession(log, session('s1', 100, { turns: 8 }))
  expect(replaced.sessions.map(one => one.id)).toEqual(['s1', 's3'])
  expect(replaced.sessions[0]?.turns).toBe(8)

  // A session begun between the two lands between them.
  const between = upsertSession(log, session('s2', 200))
  expect(between.sessions.map(one => one.id)).toEqual(['s1', 's2', 's3'])
  expect(between.root).toBe(ROOT)

  expect(JSON.stringify(log)).toBe(frozen)
  expect(upsertSession(emptyLog(ROOT), session('only', 5)).sessions).toHaveLength(1)
})

test('upsert: only the newest sessions are kept, and older ones lose their sub-agents', () => {
  expect(MAX_SESSIONS).toBe(40)
  const tree = (): AgentNode[] => [node('top', { children: [node('sub', { children: [node('subsub')] })] })]
  let log = emptyLog(ROOT)
  for (let i = 0; i < 45; i += 1) log = upsertSession(log, session(`s${i}`, 1000 + i, { agents: tree() }))

  expect(log.sessions).toHaveLength(MAX_SESSIONS)
  expect(log.sessions[0]?.id).toBe('s5')
  expect(log.sessions[39]?.id).toBe('s44')

  // The newest ten keep every level; the rest keep their top-level agents.
  const full = log.sessions.slice(-10)
  const slim = log.sessions.slice(0, -10)
  expect(full.every(one => countAgents(one.agents).subAgents === 2)).toBe(true)
  expect(slim).toHaveLength(30)
  expect(slim.every(one => one.agents.length === 1 && one.agents[0]?.children.length === 0)).toBe(true)
  expect(slim[0]?.agents[0]).toMatchObject({ key: 'top', label: 'label of top' })

  // Replacing an old session by id does not bring its sub-agents back.
  const again = upsertSession(log, session('s5', 1005, { agents: tree() }))
  expect(again.sessions).toHaveLength(MAX_SESSIONS)
  expect(again.sessions[0]?.agents[0]?.children).toEqual([])

  // The input was not touched by the trimming.
  const kept = logOf(...Array.from({ length: 12 }, (_, i) => session(`k${i}`, i, { agents: tree() })))
  const trimmed = upsertSession(kept, session('k12', 12, { agents: tree() }))
  expect(kept.sessions[0]?.agents[0]?.children).toHaveLength(1)
  expect(trimmed.sessions[0]?.agents[0]?.children).toEqual([])

  // An out-of-order start is placed by its time and may fall off the old end.
  const stale = upsertSession(log, session('ancient', 1))
  expect(stale.sessions.some(one => one.id === 'ancient')).toBe(false)
  expect(stale.sessions).toHaveLength(MAX_SESSIONS)
})

test('totals: sums over every kept session; agents are counted by depth', () => {
  const log = logOf(
    session('s1', 1, { turns: 5, tokens: 1000, costUsd: 1.25, tasksDone: 2, agents: [node('a', { children: [node('b', { children: [node('c')] })] }), node('d')] }),
    session('s2', 2, { turns: 7, tokens: 2_500_000, costUsd: 3.5, tasksDone: 4, agents: [node('e', { children: [node('f')] })] }),
    session('s3', 3, { turns: 0, tokens: 0, costUsd: 0, tasksDone: 0 }),
  )

  expect(totalsOf(log)).toEqual({
    sessions: 3,
    agents: 3,
    subAgents: 3,
    turns: 12,
    tokens: 2_501_000,
    costUsd: 4.75,
    tasksDone: 6,
  })
  expect(totalsOf(emptyLog(ROOT))).toEqual({
    sessions: 0,
    agents: 0,
    subAgents: 0,
    turns: 0,
    tokens: 0,
    costUsd: 0,
    tasksDone: 0,
  })
  expect(countAgents([])).toEqual({ agents: 0, subAgents: 0 })
  expect(projectHeadline(log)).toBe('3 sessions · 3 agents · 3 sub-agents · 2.5M tokens · $4.75')
  expect(projectHeadline(emptyLog(ROOT))).toBe('0 sessions · 0 agents · 0 sub-agents · 0 tokens · $0.00')
  expect(projectHeadline(logOf(session('s1', 1, { agents: [node('a', { children: [node('b')] })] })))).toBe(
    '1 session · 1 agent · 1 sub-agent · 1.0k tokens · $1.00',
  )
})

const sample = (): ProjectLog =>
  logOf(
    session('old', NOW - 3 * DAY, {
      lastActive: NOW - 3 * DAY,
      title: 'Set up the repository and the build',
      turns: 12,
      tokens: 480_000,
      costUsd: 3.4,
      tasksDone: 5,
      tasksTotal: 5,
      agents: [node('o1', { type: 'Explore', label: 'map the layout', tokens: 30_000, tools: 14 })],
    }),
    session('mid', NOW - 2 * HOUR, {
      lastActive: NOW - 2 * HOUR,
      title: 'Add the login page',
      turns: 20,
      tokens: 1_200_000,
      costUsd: 8.9,
      tasksDone: 4,
      tasksTotal: 6,
      agents: [
        node('m1', {
          type: 'general-purpose',
          label: 'write the form',
          name: 'builder',
          status: 'failed',
          tokens: 80_000,
          tools: 31,
          children: [node('m2', { type: 'Explore', label: 'find the styles', tokens: 2500, tools: 1 })],
        }),
      ],
    }),
    session('live', NOW - HOUR, {
      lastActive: NOW,
      title: 'Fix the session timeout bug that logs people out',
      turns: 3,
      tokens: 150_000,
      costUsd: 0.8,
      tasksDone: 1,
      tasksTotal: 3,
      agents: [node('l1', { status: 'running', label: 'reproduce the timeout', tokens: 4000, tools: 2 })],
    }),
  )

test('lines: newest session first, the live one marked, agents nested under it', () => {
  const lines = projectLines(sample(), { now: NOW, liveId: 'live', columns: 100 })

  expect(lines).toEqual([
    '● now  Fix the session timeout bug that logs people out — 3 turns · 150k tokens · $0.80 · 1/3 tasks',
    '  └ ● general-purpose: reproduce the timeout · 4.0k tok · 2 tools',
    '○ 2h ago  Add the login page — 20 turns · 1.2M tokens · $8.90 · 4/6 tasks',
    '  └ ✘ builder (general-purpose): write the form · 80k tok · 31 tools',
    '    └ ✔ Explore: find the styles · 2.5k tok · 1 tool',
    '○ 3d ago  Set up the repository and the build — 12 turns · 480k tokens · $3.40 · 5/5 tasks',
    '  └ ✔ Explore: map the layout · 30k tok · 14 tools',
  ])

  // Without a live session every mark is hollow.
  const none = projectLines(sample(), { now: NOW, columns: 100 })
  expect(none.filter(line => line.startsWith('●'))).toEqual([])
  expect(none.filter(line => line.startsWith('○'))).toHaveLength(3)
  expect(projectLines(emptyLog(ROOT), { now: NOW, columns: 100 })).toEqual([])
})

test('lines: every line fits the width, at 60 and at 100 columns', () => {
  const big = logOf(
    ...Array.from({ length: 5 }, (_, i) =>
      session(`s${i}`, NOW - (i + 1) * DAY, {
        lastActive: NOW - i * DAY,
        title: 'A long first prompt that goes on and on about many different things to do'.repeat(2),
        turns: 123,
        tokens: 98_765_432,
        costUsd: 1234.5,
        tasksDone: 12,
        tasksTotal: 34,
        agents: [
          node('a', {
            type: 'a-very-long-agent-type-name',
            name: 'a-long-name',
            label: 'a label that is far too long for a narrow terminal to hold in one line',
            tokens: 123_456,
            tools: 123,
            children: [
              node('b', {
                label: 'another label that is also much too long for the terminal width',
                children: [node('c', { children: [node('d', { children: [node('e', { children: [node('f')] })] })] })],
              }),
            ],
          }),
        ],
      }),
    ),
  )

  for (const columns of [60, 100, 40]) {
    const lines = projectLines(big, { now: NOW, liveId: 's0', columns })
    expect(lines.length).toBeGreaterThan(10)
    expect(lines.filter(line => line.length > columns)).toEqual([])
  }

  // At 60 columns the figures lose their words before the title is lost.
  const narrow = projectLines(logOf(sample().sessions[2] as SessionRecord), { now: NOW, columns: 60 })
  expect(narrow[0]).toBe('○ now  Fix the session timeout bu… — 3t · 150k · $0.80 · 1/3')
  expect(narrow[1]).toBe('  └ ● general-purpose: reproduce the t… · 4.0k tok · 2 tools')
})

test('lines: levels past the fourth are summarised', () => {
  const chain = node('l1', {
    children: [node('l2', { children: [node('l3', { children: [node('l4', { children: [node('l5', { children: [node('l6')] }), node('l5b')] })] })] })],
  })
  const lines = projectLines(logOf(session('s', 1, { agents: [chain] })), { now: NOW, columns: 100 })

  expect(lines).toHaveLength(6)
  expect(lines[1]).toStartWith('  └ ✔ ')
  expect(lines[2]).toStartWith('    └ ✔ ')
  expect(lines[3]).toStartWith('      └ ✔ ')
  expect(lines[4]).toStartWith('        └ ✔ ')
  expect(lines[5]).toBe('          └ … 3 more below')
})

test('lines: more than six agents show the six that used the most tokens', () => {
  const agents = Array.from({ length: 9 }, (_, i) =>
    node(`a${i}`, { label: `job ${i}`, tokens: (i % 3 === 0 ? 100 : 1) * (i + 1), startedAt: i }),
  )
  const lines = projectLines(logOf(session('s', 1, { agents })), { now: NOW, columns: 100 })

  // Heaviest: a6 (700), a3 (400), a0 (100), then a8 (9), a7 (8), a5 (6); shown oldest first.
  expect(lines).toHaveLength(8)
  expect(lines.slice(1, 7).map(line => /job (\d)/.exec(line)?.[1])).toEqual(['0', '3', '5', '6', '7', '8'])
  expect(lines[7]).toBe('  └ … 3 more agents')

  const six = projectLines(logOf(session('s', 1, { agents: agents.slice(0, 6) })), { now: NOW, columns: 100 })
  expect(six).toHaveLength(7)
  expect(six.some(line => line.includes('more agents'))).toBe(false)
})

test('lines: older sessions beyond the limit are counted on a last line', () => {
  const many = logOf(...Array.from({ length: 12 }, (_, i) => session(`s${i}`, 1000 + i, { title: `Session number ${i}` })))

  const lines = projectLines(many, { now: NOW, columns: 60 })
  expect(lines).toHaveLength(9)
  expect(lines[0]).toContain('Session number 11')
  expect(lines[7]).toContain('Session number 4')
  expect(lines[8]).toBe('… and 4 earlier sessions')

  const three = projectLines(many, { now: NOW, columns: 60, maxSessions: 3 })
  expect(three).toHaveLength(4)
  expect(three[3]).toBe('… and 9 earlier sessions')

  const eleven = projectLines(many, { now: NOW, columns: 60, maxSessions: 11 })
  expect(eleven[11]).toBe('… and 1 earlier session')
  expect(projectLines(many, { now: NOW, columns: 60, maxSessions: 12 })).toHaveLength(12)
})

test('lines: when a session was last active, and a session with no title', () => {
  const at = (ago: number, extra: Partial<SessionRecord> = {}): string =>
    projectLines(logOf(session('s', 1, { lastActive: NOW - ago, ...extra })), { now: NOW, columns: 100 })[0] ?? ''

  expect(at(0)).toStartWith('○ now  ')
  expect(at(59_000)).toStartWith('○ now  ')
  expect(at(5 * MINUTE)).toStartWith('○ 5m ago  ')
  expect(at(2 * HOUR + 40 * MINUTE)).toStartWith('○ 2h ago  ')
  expect(at(23 * HOUR)).toStartWith('○ 23h ago  ')
  expect(at(3 * DAY + 5 * HOUR)).toStartWith('○ 3d ago  ')
  // A clock that is behind the record does not print a negative time.
  expect(at(-HOUR)).toStartWith('○ now  ')
  expect(at(0, { title: '', turns: 1 })).toBe('○ now  untitled session — 1 turn · 1.0k tokens · $1.00 · 1/2 tasks')
})
