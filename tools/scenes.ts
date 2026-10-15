// Development only: the made-up sessions ("scenes") the city is drawn from,
// shared by tools/preview.ts (a page to judge the look) and
// tools/manual-images.ts (the manual's pictures), so the two cannot drift.
import type { CityInput } from '../hooks/city'
import { expectedFor } from '../hooks/logic'
import type { AgentRun, Proc, Task, TaskStatus } from '../types'

export const task = (
  id: string,
  subject: string,
  area: string,
  status: TaskStatus,
  rest: Partial<Task> = {},
): Task => ({ id, subject, area, status, blockedBy: [], source: 'task', ...rest })

export const agent = (
  id: string,
  type: string,
  label: string,
  families: { [family: string]: number },
  rest: Partial<AgentRun> = {},
): AgentRun => ({
  key: id,
  agentId: id,
  label,
  type,
  status: 'running',
  tools: Object.values(families).reduce((sum, count) => sum + count, 0),
  families,
  tokens: 42_000,
  startedAt: 0,
  ...rest,
})

export const proc = (id: string, kind: Proc['kind'], label: string): Proc => ({
  id,
  kind,
  label,
  status: 'running',
  startedAt: 0,
})

// A new session: no tasks, only the civic block.
export const base: CityInput = {
  now: 0,
  tasks: [],
  agents: [],
  procs: [],
  turn: {
    id: null,
    isWorking: false,
    startedAt: 0,
    endedAt: 0,
    expected: null,
    tokens: 0,
    outTokens: 0,
    cacheRead: 0,
    tools: 0,
    steps: 0,
    agents: 0,
    hasWarned: false,
  },
  usage: {
    contextTokens: 24_000,
    contextWindow: 200_000,
    contextPercent: 12,
    rateLimits: [],
    costUsd: 0,
    sessionTokens: 0,
    mainFamilies: {},
    zoneLimit: 150_000,
    zoneAnnounced: 'inside',
  },
  project: null,
  skills: { available: [], used: {}, suggested: [] },
}

export const small: CityInput = {
  ...base,
  tasks: [
    task('1', 'Define the schema', 'api', 'completed'),
    task('2', 'Build the endpoints', 'api', 'in_progress'),
    task('3', 'Write the client', 'api', 'pending'),
  ],
  agents: [agent('a', 'polis:worker', 'Build the endpoints', { edit: 6, shell: 3, read: 9 }, { taskId: '2' })],
  turn: { ...base.turn, id: 't', isWorking: true, tokens: 31_000, tools: 9, expected: expectedFor('M', 'heuristic', []) },
  usage: { ...base.usage, contextPercent: 34, contextTokens: 68_000, mainFamilies: { plan: 4, read: 5, delegate: 1 } },
}

export const busy: CityInput = {
  ...base,
  tasks: [
    task('1', 'Define the schema', 'api', 'completed', { verdict: { state: 'passed', by: 'verifier', at: 0 } }),
    task('2', 'Build the endpoints', 'api', 'in_progress'),
    task('2a', 'Auth middleware', 'api', 'completed', { parentId: '2' }),
    task('2b', 'Rate limiting', 'api', 'in_progress', { parentId: '2' }),
    task('3', 'Write the client', 'api', 'pending', { blockedBy: ['2'] }),
    task('4', 'Dashboard page', 'ui', 'in_progress'),
    task('5', 'Settings page', 'ui', 'pending'),
    task('6', 'Design tokens', 'ui', 'completed'),
    task('7', 'Dark theme', 'ui', 'completed', { verdict: { state: 'failed', by: 'checks', at: 0 } }),
    task('8', 'Unit tests', 'tests', 'in_progress'),
    task('9', 'Integration tests', 'tests', 'pending', { blockedBy: ['2', '4'] }),
    task('10', 'Load tests', 'tests', 'pending'),
    task('11', 'README', 'docs', 'completed', { verdict: { state: 'passed', by: 'checks', at: 0 } }),
    task('12', 'API reference', 'docs', 'pending', { blockedBy: ['2'] }),
    task('13', 'Audit the old service', 'research', 'completed'),
    task('14', 'Compare queue libraries', 'research', 'completed'),
    task('15', 'CI pipeline', 'ops', 'in_progress'),
    task('16', 'Staging deploy', 'ops', 'pending'),
  ],
  agents: [
    agent('a', 'polis:worker', 'Build the endpoints', { edit: 12, shell: 5, read: 9 }, { taskId: '2', name: 'api-1' }),
    agent('b', 'polis:worker', 'Dashboard page', { edit: 8, read: 4, web: 2 }, { taskId: '4' }),
    agent('c', 'polis:verifier', 'Check the unit tests', { shell: 9, read: 6, search: 3 }, { taskId: '8' }),
    agent('d', 'Explore', 'Find rate limit callers', { search: 14, read: 7 }, { taskId: '2b', parentAgentId: 'a' }),
    agent('e', 'Plan', 'Plan the deploy', { read: 5, search: 2, plan: 3 }),
    agent('f', 'general-purpose', 'CI pipeline', { shell: 7, edit: 3, mcp: 2 }, { taskId: '15' }),
  ],
  procs: [proc('p1', 'shell', 'npm run dev'), proc('p2', 'monitor', 'Watch the build'), proc('p3', 'cron', 'every 10 minutes')],
  // Tests passed, lint failed, types passed but edits came after: one lamp each.
  checks: [
    { kind: 'test', hasPassed: true, at: 0, ms: 4200, command: 'npm test', editsSince: 0 },
    { kind: 'lint', hasPassed: false, at: 0, ms: 1800, command: 'npm run lint', editsSince: 0 },
    { kind: 'types', hasPassed: true, at: 0, ms: 6100, command: 'tsc --noEmit', editsSince: 3 },
  ],
  waits: [{ kind: 'permission', at: 0, tool: 'Bash' }],
  turn: { ...base.turn, id: 't', isWorking: true, tokens: 410_000, tools: 61, expected: expectedFor('L', 'model', []) },
  usage: { ...base.usage, contextPercent: 71, contextTokens: 142_000, mainFamilies: { plan: 14, delegate: 6, read: 5, skill: 2 } },
  skills: { available: [], used: { 'code-review': 1, 'security-review': 1, dataviz: 2 }, suggested: ['simplify'] },
  project: {
    root: '/work/atlas',
    name: 'atlas',
    phase: 'Building the API',
    milestones: [],
    sessions: 4,
    lastSessionId: '',
    turns: 31,
    tokens: 2_400_000,
    tasksDone: 22,
    lastActive: 0,
  },
}

const AREAS = ['api', 'ui', 'tests', 'docs', 'research', 'ops', 'data', 'mobile']
const STATUSES: TaskStatus[] = ['completed', 'completed', 'in_progress', 'pending']

export const full: CityInput = {
  ...busy,
  tasks: AREAS.flatMap((area, a) =>
    Array.from({ length: 6 + ((a * 5) % 11) }, (_, k) =>
      task(`${area}-${k}`, `${area} task ${k + 1}`, area, STATUSES[(a + k) % 4] ?? 'pending'),
    ),
  ),
  agents: busy.agents.map((run, index) => ({ ...run, taskId: `${AREAS[index] ?? 'api'}-2` })),
  usage: { ...busy.usage, contextPercent: 88, contextTokens: 176_000 },
}

// One district holding a task in each state a building shows, and nobody at
// work: blocked (by the one in progress), in progress, planned, and three
// finished, verified, not checked and failed its check. Lots fill from the
// front corner back, so the blocked lot stands in front where nothing hides
// it, and the finished buildings at the back.
export const states: CityInput = {
  ...base,
  tasks: [
    task('1', 'Publish the manual', 'docs', 'pending', { blockedBy: ['2'] }),
    task('2', 'Write the chapters', 'docs', 'in_progress'),
    task('3', 'Add a glossary', 'docs', 'pending'),
    task('4', 'Draw the pictures', 'docs', 'completed', { verdict: { state: 'passed', by: 'verifier', at: 0 } }),
    task('5', 'Write the preface', 'docs', 'completed'),
    task('6', 'Check the links', 'docs', 'completed', { verdict: { state: 'failed', by: 'verifier', at: 0 } }),
  ],
}

export const scenes: [string, CityInput][] = [
  ['A new session', base],
  ['One district, one agent', small],
  ['A busy project', busy],
  ['A full city', full],
]

// The agent types the manual and the preview show, each with the tool
// families it has used most.
export const icons = [
  ['main', { plan: 9, delegate: 4, read: 3 }],
  ['Explore', { search: 12, read: 6, web: 1 }],
  ['Plan', { read: 5, search: 2, plan: 4 }],
  ['polis:worker', { edit: 9, shell: 4, read: 2 }],
  ['polis:verifier', { shell: 6, read: 3, search: 1 }],
  ['general-purpose', { mcp: 3, web: 2, skill: 1 }],
] as const
