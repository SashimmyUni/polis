import type {
  Activity,
  AgentRun,
  Expected,
  FamilyCounts,
  FileHit,
  LimitSample,
  LimitTrack,
  Milestone,
  MilestoneStatus,
  Proc,
  ProcKind,
  Project,
  Range,
  RateLimit,
  Size,
  SkillInfo,
  Task,
  TaskStatus,
  ToolFamily,
  TurnRecord,
  Wait,
  WaitKind,
  ZoneLevel,
} from '../types'
import { askText } from './ask'

// ---------------------------------------------------------------- formatting

export const elapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
}

// A stretch of time to the minute, for a forecast: seconds would claim more
// than a forecast knows.
export const about = (ms: number): string => {
  const minutes = Math.max(0, Math.round(ms / 60_000))
  if (minutes < 1) return 'under 1m'
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h${String(minutes % 60).padStart(2, '0')}m`

  return `${Math.floor(hours / 24)}d${hours % 24}h`
}

export const compact = (n: number): string => {
  if (n < 1000) return String(Math.round(n))
  if (n < 10_000) return `${(n / 1000).toFixed(1)}k`
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`

  return `${(n / 1_000_000).toFixed(1)}M`
}

export const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()

  return flat.length <= max ? flat : `${flat.slice(0, Math.max(1, max - 1))}…`
}

export const bar = (done: number, total: number, width: number): [string, string] => {
  const share = total <= 0 ? 0 : Math.min(1, Math.max(0, done / total))
  const filled = Math.round(share * width)

  return ['█'.repeat(filled), '░'.repeat(Math.max(0, width - filled))]
}

const words = (text: string): string[] =>
  text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(word => word.length >= 3 && !STOP.has(word))

const STOP = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'into', 'when', 'use',
  'used', 'using', 'any', 'all', 'are', 'not', 'can', 'will', 'should', 'have',
  'has', 'its', 'their', 'your', 'you', 'user', 'users', 'wants', 'want', 'new',
  'file', 'files', 'code', 'make', 'create', 'add', 'run', 'task', 'tasks',
  'claude', 'also', 'such', 'other', 'them', 'then', 'than', 'each', 'one',
])

// --------------------------------------------------------------------- tasks

const AREAS: readonly [RegExp, string][] = [
  [/\b(test\w*|specs?|verif\w*|qa|coverage)\b/, 'tests'],
  [/\b(docs?|readme|document\w*|write-?ups?|changelog)\b/, 'docs'],
  [/\b(ui|ux|views?|pages?|css|styl\w*|design\w*|layouts?|component\w*|frontend)\b/, 'ui'],
  [/\b(apis?|endpoints?|servers?|backend|databases?|db|schemas?|migrat\w*|quer\w*)\b/, 'backend'],
  [/\b(research\w*|explor\w*|investigat\w*|audit\w*|review\w*|analy\w*|survey\w*|find\w*)\b/, 'research'],
  [/\b(deploy\w*|releas\w*|ci|build\w*|config\w*|setup|install\w*|infra\w*|pipelines?)\b/, 'ops'],
]

export const inferArea = (subject: string): string => {
  const text = subject.toLowerCase()
  for (const [pattern, area] of AREAS) {
    if (pattern.test(text)) return area
  }

  return 'general'
}

const field = (bag: unknown, key: string): string | undefined => {
  if (typeof bag !== 'object' || bag === null) return undefined
  const value = (bag as { [key: string]: unknown })[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()

  return trimmed === '' ? undefined : trimmed
}

export const areaOf = (metadata: unknown, subject: string): string => {
  const given = field(metadata, 'area')

  return given === undefined ? inferArea(subject) : given.toLowerCase().slice(0, 24)
}

export type TodoItem = { content: string; status: TaskStatus; activeForm?: string }

// A todo list belongs to one loop: writing it replaces that loop's todos only.
export const mergeTodos = (
  list: readonly Task[],
  todos: readonly TodoItem[],
  agentId: string | undefined,
  parentId: string | undefined,
): Task[] => {
  const loop = agentId ?? 'main'
  // An earlier session's todos are that session's: this loop's list leaves them be.
  const isOwn = (task: Task): boolean =>
    task.source === 'todo' && task.sessionId === undefined && (task.agentId ?? 'main') === loop
  const kept = list.filter(task => !isOwn(task))
  const fresh = todos.map((todo, index): Task => {
    // A todo written again is the same work: what was learnt of it stays.
    const was = list.find(task => isOwn(task) && task.subject === todo.content)

    return {
      id: `todo:${loop}:${index}`,
      subject: todo.content,
      status: todo.status,
      area: was?.area ?? inferArea(todo.content),
      areaFrom: was?.areaFrom ?? 'title',
      blockedBy: [],
      source: 'todo',
      ...(was?.touched === undefined ? {} : { touched: was.touched }),
      // Reopened work is no longer what was checked.
      ...(was?.verdict === undefined || (was.status === 'completed' && todo.status !== 'completed')
        ? {}
        : { verdict: was.verdict }),
      ...(was?.doneAt === undefined ? {} : { doneAt: was.doneAt }),
      ...(todo.activeForm === undefined ? {} : { activeForm: todo.activeForm }),
      ...(agentId === undefined ? {} : { agentId }),
      ...(parentId === undefined ? {} : { parentId }),
    }
  })

  return [...kept, ...fresh].slice(-240)
}

export type TaskDraft = {
  id: string
  subject: string
  activeForm?: string
  metadata?: unknown
  agentId?: string
  parentId?: string
}

export const createTask = (list: readonly Task[], draft: TaskDraft): Task[] => {
  const parentId = field(draft.metadata, 'parent') ?? draft.parentId
  const parent = list.find(task => task.id === parentId)
  const isTagged = field(draft.metadata, 'area') !== undefined
  const task: Task = {
    id: draft.id,
    subject: draft.subject,
    status: 'pending',
    // A sub-task with no area of its own lives in its parent's district.
    area: !isTagged && parent !== undefined ? parent.area : areaOf(draft.metadata, draft.subject),
    areaFrom: isTagged ? 'tag' : (parent?.areaFrom ?? 'title'),
    blockedBy: [],
    source: 'task',
    ...(draft.activeForm === undefined ? {} : { activeForm: draft.activeForm }),
    ...(draft.agentId === undefined ? {} : { agentId: draft.agentId }),
    ...(parentId === undefined ? {} : { parentId }),
  }

  return [...list.filter(one => one.id !== task.id), task].slice(-240)
}

export type TaskPatch = {
  taskId: string
  subject?: string
  activeForm?: string
  status?: TaskStatus | 'deleted'
  owner?: string
  addBlockedBy?: readonly string[]
  addBlocks?: readonly string[]
  metadata?: unknown
}

const union = (a: readonly string[], b: readonly string[]): string[] => [...new Set([...a, ...b])]

export const patchTask = (list: readonly Task[], patch: TaskPatch): Task[] => {
  if (patch.status === 'deleted') {
    return list
      .filter(task => task.id !== patch.taskId)
      .map(task => ({ ...task, blockedBy: task.blockedBy.filter(id => id !== patch.taskId) }))
  }
  const { status } = patch
  const area = field(patch.metadata, 'area')
  const parentId = field(patch.metadata, 'parent')
  const blocks = patch.addBlocks ?? []

  return list.map(task => {
    if (task.id !== patch.taskId) {
      return blocks.includes(task.id)
        ? { ...task, blockedBy: union(task.blockedBy, [patch.taskId]) }
        : task
    }

    return {
      ...task,
      ...(patch.subject === undefined ? {} : { subject: patch.subject }),
      ...(patch.activeForm === undefined ? {} : { activeForm: patch.activeForm }),
      ...(status === undefined ? {} : { status }),
      ...(patch.owner === undefined ? {} : { owner: patch.owner }),
      ...(area === undefined ? {} : { area: area.toLowerCase().slice(0, 24), areaFrom: 'tag' as const }),
      ...(parentId === undefined ? {} : { parentId }),
      blockedBy: union(task.blockedBy, patch.addBlockedBy ?? []),
    }
  })
}

const TASK_STATUSES: readonly TaskStatus[] = ['pending', 'in_progress', 'completed']

// Tasks as the model reports them through the mod's own tool, for a session
// whose host gives it no task tool to watch: matched by id, made when new.
export const recordTasks = (list: readonly Task[], notes: unknown): Task[] => {
  let next = [...list]
  for (const raw of Array.isArray(notes) ? notes.slice(0, 60) : []) {
    const id = field(raw, 'id')
    if (id === undefined) continue
    const subject = field(raw, 'subject')
    const stated = field(raw, 'status')
    const status = stated === 'deleted' ? 'deleted' : TASK_STATUSES.find(one => one === stated)
    const owner = field(raw, 'owner')
    const activeForm = field(raw, 'activeForm')
    const waits = (raw as { blockedBy?: unknown }).blockedBy
    const metadata = { area: field(raw, 'area'), parent: field(raw, 'parent') }
    if (!next.some(task => task.id === id)) {
      if (subject === undefined || status === 'deleted') continue
      next = createTask(next, { id, subject, metadata })
    }
    next = patchTask(next, {
      taskId: id,
      metadata,
      addBlockedBy: Array.isArray(waits) ? waits.filter(one => typeof one === 'string') : [],
      ...(subject === undefined ? {} : { subject }),
      ...(status === undefined ? {} : { status }),
      ...(owner === undefined ? {} : { owner }),
      ...(activeForm === undefined ? {} : { activeForm }),
    })
  }

  return next
}

// The blockers of a task that are still unfinished.
export const openBlockers = (task: Task, list: readonly Task[]): string[] =>
  task.blockedBy.filter(id => list.some(one => one.id === id && one.status !== 'completed'))

export const isBlocked = (task: Task, list: readonly Task[]): boolean =>
  task.status !== 'completed' && openBlockers(task, list).length > 0

export type TaskStats = { done: number; active: number; waiting: number; total: number }

export const taskStats = (list: readonly Task[]): TaskStats => {
  const done = list.filter(task => task.status === 'completed').length
  const active = list.filter(task => task.status === 'in_progress').length

  return { done, active, waiting: list.length - done - active, total: list.length }
}

export type TaskRow = { task: Task; depth: number }

// Top-level tasks in order, each followed by its sub-tasks.
export const taskTree = (list: readonly Task[]): TaskRow[] => {
  const ids = new Set(list.map(task => task.id))
  const rows: TaskRow[] = []
  const walk = (parent: string | undefined, depth: number): void => {
    for (const task of list) {
      const isRoot = task.parentId === undefined || !ids.has(task.parentId) || task.parentId === task.id
      const isChild = parent === undefined ? isRoot : !isRoot && task.parentId === parent
      if (!isChild || depth > 4) continue
      rows.push({ task, depth })
      walk(task.id, depth + 1)
    }
  }
  walk(undefined, 0)

  return rows
}

export type District = { area: string; tasks: Task[] }

// Areas in the order their first task appeared.
export const districtsOf = (list: readonly Task[]): District[] => {
  const districts: District[] = []
  for (const task of list) {
    const found = districts.find(one => one.area === task.area)
    if (found === undefined) districts.push({ area: task.area, tasks: [task] })
    else found.tasks.push(task)
  }

  return districts
}

// -------------------------------------------------------------------- agents

export const isLive = (run: AgentRun): boolean =>
  run.status === 'starting' || run.status === 'running'

// The task an agent's brief is most likely about: word overlap with the open
// tasks, else the one task in progress when there is exactly one.
export const matchTask = (label: string, list: readonly Task[]): string | undefined => {
  const open = list.filter(task => task.status !== 'completed')
  const wanted = new Set(words(label))
  let best: { id: string; score: number } | undefined
  for (const task of open) {
    const have = words(task.subject)
    if (have.length === 0 || wanted.size === 0) continue
    const overlap = have.filter(word => wanted.has(word)).length
    const score = overlap / Math.min(have.length, wanted.size) + (task.status === 'in_progress' ? 0.1 : 0)
    if (overlap >= 1 && score >= 0.4 && (best === undefined || score > best.score)) {
      best = { id: task.id, score }
    }
  }
  if (best !== undefined) return best.id
  const active = open.filter(task => task.status === 'in_progress')

  return active.length === 1 ? active[0]?.id : undefined
}

export type AgentRow = { run: AgentRun; depth: number }

// Agents in spawn order, each followed by the agents its own loop spawned.
export const agentTree = (runs: readonly AgentRun[]): AgentRow[] => {
  const ids = new Set(runs.map(run => run.agentId))
  const rows: AgentRow[] = []
  const walk = (parent: string | undefined, depth: number): void => {
    for (const run of runs) {
      const isRoot = run.parentAgentId === undefined || !ids.has(run.parentAgentId)
      const isChild = parent === undefined ? isRoot : !isRoot && run.parentAgentId === parent
      if (!isChild || depth > 6) continue
      rows.push({ run, depth })
      if (run.agentId !== undefined) walk(run.agentId, depth + 1)
    }
  }
  walk(undefined, 0)

  return rows
}

export const bumpFamily = (families: FamilyCounts, family: ToolFamily): FamilyCounts => ({
  ...families,
  [family]: (families[family] ?? 0) + 1,
})

// The families an agent has used most: its equipment. Planning and unknown
// tools say little about what an agent does, so they come last.
export const topFamilies = (families: FamilyCounts, limit: number): ToolFamily[] => {
  const dull = (family: string): number => (family === 'plan' || family === 'other' ? 1 : 0)

  return (Object.entries(families) as [ToolFamily, number][])
    .filter(([, count]) => count > 0)
    .sort((a, b) => dull(a[0]) - dull(b[0]) || b[1] - a[1])
    .slice(0, limit)
    .map(([family]) => family)
}

// ----------------------------------------------------------------- processes

export const upsertProc = (list: readonly Proc[], proc: Proc): Proc[] =>
  [...list.filter(one => one.id !== proc.id), proc].slice(-40)

export const endProc = (
  list: readonly Proc[],
  id: string,
  status: 'done' | 'stopped',
  at: number,
): Proc[] =>
  list.map(proc =>
    proc.id === id && proc.status === 'running' ? { ...proc, status, endedAt: at } : proc,
  )

export type Background = { id: string; type: string; description: string; command?: string }

export type Cron = { id: string; schedule: string; prompt: string }

const KIND_OF: { [type: string]: ProcKind } = {
  shell: 'shell',
  local_bash: 'shell',
  monitor: 'monitor',
  workflow: 'workflow',
  local_workflow: 'workflow',
  subagent: 'agent',
  local_agent: 'agent',
  remote_agent: 'agent',
}

// What the engine says is in flight is the truth: anything else we still hold
// as running has ended.
export const reconcileProcs = (
  list: readonly Proc[],
  background: readonly Background[],
  crons: readonly Cron[],
  at: number,
): Proc[] => {
  const live = new Map<string, Proc>()
  for (const task of background) {
    const kind = KIND_OF[task.type] ?? 'other'
    if (kind === 'agent') continue
    live.set(task.id, {
      id: task.id,
      kind,
      label: clip(task.description === '' ? (task.command ?? task.type) : task.description, 80),
      status: 'running',
      startedAt: at,
    })
  }
  for (const cron of crons) {
    live.set(cron.id, {
      id: cron.id,
      kind: 'cron',
      label: clip(`${cron.schedule} · ${cron.prompt}`, 80),
      status: 'running',
      startedAt: at,
    })
  }
  const kept = list.map((proc): Proc => {
    const now = live.get(proc.id)
    live.delete(proc.id)
    if (now !== undefined) return { ...proc, status: 'running' }

    return proc.status === 'running' ? { ...proc, status: 'done', endedAt: at } : proc
  })

  return [...kept, ...live.values()].slice(-40)
}

// ------------------------------------------------------------------ estimate

export const SIZES: readonly Size[] = ['S', 'M', 'L', 'XL']

export const SIZE_LABEL: Record<Size, string> = {
  S: 'small',
  M: 'medium',
  L: 'large',
  XL: 'very large',
}

// Where a size class starts before this project has history of its own.
export const DEFAULTS: Record<Size, { tokens: number; ms: number; tools: number }> = {
  S: { tokens: 15_000, ms: 30_000, tools: 3 },
  M: { tokens: 60_000, ms: 150_000, tools: 12 },
  L: { tokens: 220_000, ms: 600_000, tools: 40 },
  XL: { tokens: 700_000, ms: 1_800_000, tools: 120 },
}

const MIN_SAMPLES = 5

const BIG = /\b(refactor\w*|implement\w*|build\w*|migrat\w*|rewrit\w*|redesign\w*|orchestrat\w*|end-to-end|across|entire|whole|every|all of)\b/i
const ASK = /^(what|why|how|where|when|which|who|is|are|does|do|can|could|explain|show|tell)\b/i

export const heuristicSize = (text: string): Size => {
  const trimmed = text.trim()
  const lines = trimmed.split('\n').filter(line => line.trim() !== '')
  const items = lines.filter(line => /^\s*([-*•]|\d+[.)])\s+/.test(line)).length
  let level = trimmed.length < 200 ? 0 : trimmed.length < 900 ? 1 : trimmed.length < 3500 ? 2 : 3
  if (items >= 3) level = Math.max(level, 2)
  if (items >= 8) level = 3
  if (BIG.test(trimmed)) level += 1
  if (level <= 1 && ASK.test(trimmed) && trimmed.length < 300 && !BIG.test(trimmed)) level = 0

  return SIZES[Math.min(3, level)] ?? 'M'
}

export const quantile = (values: readonly number[], q: number): number => {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const at = (sorted.length - 1) * q
  const low = Math.floor(at)
  const high = Math.ceil(at)
  const a = sorted[low] ?? 0
  const b = sorted[high] ?? a

  return Math.round(a + (b - a) * (at - low))
}

const spread = (values: readonly number[]): Range => ({
  low: quantile(values, 0.25),
  high: Math.max(1, quantile(values, 0.8)),
})

export const expectedFor = (
  size: Size,
  source: 'heuristic' | 'model',
  history: readonly TurnRecord[],
): Expected => {
  const same = history.filter(record => record.size === size)
  if (same.length < MIN_SAMPLES) {
    const base = DEFAULTS[size]

    return {
      size,
      source,
      tokens: { low: Math.round(base.tokens * 0.4), high: Math.round(base.tokens * 1.5) },
      ms: { low: Math.round(base.ms * 0.4), high: Math.round(base.ms * 1.5) },
      tools: { low: Math.round(base.tools * 0.4), high: Math.round(base.tools * 1.5) },
      samples: same.length,
    }
  }

  return {
    size,
    source,
    tokens: spread(same.map(record => record.tokens)),
    ms: spread(same.map(record => record.ms)),
    tools: spread(same.map(record => record.tools)),
    samples: same.length,
  }
}

export type EstimateMode = 'both' | 'history' | 'model'

// A small-model call costs a little on every prompt it sizes: under `both` it
// is kept for prompts long or structured enough to be worth a second opinion.
export const shouldAskModel = (mode: EstimateMode, text: string, size: Size): boolean => {
  const trimmed = text.trim()
  if (trimmed === '' || mode === 'history') return false
  if (mode === 'model') return true

  return trimmed.length >= 400 || trimmed.split('\n').length >= 4 || size === 'L' || size === 'XL'
}

export const SIZING_RUBRIC = [
  'Classify how much agent work this coding request needs. Answer with the label alone.',
  'S: a question, a lookup, or one small edit.',
  'M: a focused change touching a few files, or a short investigation.',
  'L: a multi-step feature, refactor or investigation across many files.',
  'XL: a large multi-part project that needs planning and delegation.',
  '',
  'Request:',
].join('\n')

export type GaugeState = 'under' | 'within' | 'over'

export const gaugeOf = (actual: number, range: Range): { share: number; state: GaugeState } => ({
  share: range.high <= 0 ? 0 : actual / range.high,
  state: actual > range.high ? 'over' : actual >= range.low ? 'within' : 'under',
})

export type SizeStat = { size: Size; count: number; tokens: number; ms: number }

export const sizeStats = (history: readonly TurnRecord[]): SizeStat[] =>
  SIZES.map(size => {
    const same = history.filter(record => record.size === size)

    return {
      size,
      count: same.length,
      tokens: quantile(same.map(record => record.tokens), 0.5),
      ms: quantile(same.map(record => record.ms), 0.5),
    }
  })

// -------------------------------------------------------------------- limits

const MINUTE = 60_000
const HOUR = 60 * MINUTE

// How far back a window's pace is read, and the shortest stretch of readings
// a pace is told from. A five-hour window is judged by its last half hour; a
// longer one by its last day, so that a night's rest counts toward its pace.
const PACE: { [kind: string]: { lookback: number; least: number } } = {
  five_hour: { lookback: 30 * MINUTE, least: 10 * MINUTE },
  seven_day: { lookback: 24 * HOUR, least: 2 * HOUR },
  spend_limit: { lookback: 24 * HOUR, least: 2 * HOUR },
}

const USUAL_PACE = { lookback: HOUR, least: 10 * MINUTE }

const paceOf = (kind: string): { lookback: number; least: number } => PACE[kind] ?? USUAL_PACE

const stamp = (iso: string | undefined): number | null => {
  const at = iso === undefined ? NaN : Date.parse(iso)

  return Number.isFinite(at) ? at : null
}

// Whether a reading belongs to another window than the one held: its reset
// time moved, the held window's reset has passed, or, where no reset time
// says, the figure fell.
const isNewWindow = (track: LimitTrack, limit: RateLimit, at: number): boolean => {
  const was = stamp(track.resetsAt)
  const is = stamp(limit.resetsAt)
  if (was !== null && is !== null) return Math.abs(is - was) > MINUTE
  const last = track.samples[track.samples.length - 1]

  return (was !== null && at >= was) || (last !== undefined && limit.percentUsed < last.percent)
}

// The readings a pace can still be told from: those inside the lookback, and
// the newest one before it, which says where the window stood as it began.
const trimSamples = (samples: readonly LimitSample[], since: number): LimitSample[] => {
  const older = samples.filter(sample => sample.at <= since)

  return [...older.slice(-1), ...samples.filter(sample => sample.at > since)].slice(-120)
}

// One more reading of a limit window. A level is kept from the first time it
// was read; a reading of a new window starts over, its warning not yet given.
export const recordLimit = (
  track: LimitTrack | undefined,
  limit: RateLimit,
  at: number,
): LimitTrack => {
  const reading = { at, percent: limit.percentUsed }
  const reset = limit.resetsAt === undefined ? {} : { resetsAt: limit.resetsAt }
  if (track === undefined || isNewWindow(track, limit, at)) {
    return { kind: limit.kind, samples: [reading], hasWarned: false, ...reset }
  }
  const last = track.samples[track.samples.length - 1]
  const samples =
    last !== undefined && last.percent === reading.percent ? track.samples : [...track.samples, reading]

  return { ...track, ...reset, samples: trimSamples(samples, at - paceOf(limit.kind).lookback) }
}

// What the store handed back, held to the shape of the tracks.
export const asTracks = (saved: unknown): LimitTrack[] => {
  if (!Array.isArray(saved)) return []
  const tracks: LimitTrack[] = []
  for (const raw of saved.slice(0, 8)) {
    const kind = field(raw, 'kind')
    const samples = (raw as { samples?: unknown } | null)?.samples
    if (kind === undefined || !Array.isArray(samples)) continue
    const resetsAt = field(raw, 'resetsAt')
    tracks.push({
      kind,
      samples: samples
        .filter(
          (one): one is LimitSample =>
            typeof one === 'object' &&
            one !== null &&
            Number.isFinite((one as LimitSample).at) &&
            Number.isFinite((one as LimitSample).percent),
        )
        .map(one => ({ at: one.at, percent: one.percent }))
        .slice(-120),
      hasWarned: (raw as { hasWarned?: unknown }).hasWarned === true,
      ...(resetsAt === undefined ? {} : { resetsAt }),
    })
  }

  return tracks
}

const newest = (track: LimitTrack): number => track.samples[track.samples.length - 1]?.at ?? 0

// A window as two sessions read it, folded into one: their readings in
// order, and a warning either of them gave counting for both. Of two
// different windows of a kind the one read last stands.
export const mergeTracks = (
  held: readonly LimitTrack[],
  kept: readonly LimitTrack[],
): LimitTrack[] => {
  const kinds = [...new Set([...held, ...kept].map(track => track.kind))]
  const merged: LimitTrack[] = []
  for (const kind of kinds) {
    const mine = held.find(track => track.kind === kind)
    const theirs = kept.find(track => track.kind === kind)
    if (mine === undefined || theirs === undefined) {
      const only = mine ?? theirs
      if (only !== undefined) merged.push(only)
      continue
    }
    const was = stamp(mine.resetsAt)
    const is = stamp(theirs.resetsAt)
    if (was === null || is === null || Math.abs(was - is) > MINUTE) {
      merged.push(newest(theirs) > newest(mine) ? theirs : mine)
      continue
    }
    const samples: LimitSample[] = []
    for (const sample of [...mine.samples, ...theirs.samples].sort((a, b) => a.at - b.at)) {
      if (samples[samples.length - 1]?.percent !== sample.percent) samples.push(sample)
    }
    merged.push({ ...mine, samples: samples.slice(-120), hasWarned: mine.hasWarned || theirs.hasWarned })
  }

  return merged
}

// `learning`: too few readings to tell a pace. `steady`: no rise lately.
// `lasting`: on course to reach the reset. `short`: on course to run out
// before it. `spent`: full already. `open`: a pace, but no reset time to
// hold it against.
export type LimitOutlook = 'learning' | 'steady' | 'lasting' | 'short' | 'spent' | 'open'

export type LimitForecast = {
  kind: string
  percentUsed: number
  /** When the window resets, where the engine says. */
  resetsAt: number | null
  /** Points of the window used an hour over the lookback, once it can be told. */
  perHour: number | null
  /** When the window would be full at that pace. */
  exhaustsAt: number | null
  outlook: LimitOutlook
}

// When a limit window runs out at its recent pace, against when it resets.
// The pace is what the window gained over the lookback that ends now, so a
// pause slows it and a long one ends the forecast.
export const forecastLimit = (
  limit: RateLimit,
  track: LimitTrack | undefined,
  now: number,
): LimitForecast => {
  const resetsAt = stamp(limit.resetsAt)
  const unknown = {
    kind: limit.kind,
    percentUsed: limit.percentUsed,
    resetsAt,
    perHour: null,
    exhaustsAt: null,
  }
  if (limit.percentUsed >= 100) return { ...unknown, outlook: 'spent' }
  // Readings of a window that has reset since say nothing of the new one.
  if (resetsAt !== null && resetsAt <= now) return { ...unknown, outlook: 'learning' }
  const { lookback, least } = paceOf(limit.kind)
  const samples = (track?.samples ?? []).filter(sample => sample.at <= now)
  const since = now - lookback
  const before = samples.filter(sample => sample.at <= since).slice(-1)[0]
  const from = before === undefined ? samples[0] : { at: since, percent: before.percent }
  if (from === undefined || now - from.at < least) return { ...unknown, outlook: 'learning' }
  const gained = limit.percentUsed - from.percent
  if (gained <= 0) return { ...unknown, outlook: 'steady' }
  const span = now - from.at
  const perHour = (gained * HOUR) / span
  const exhaustsAt = Math.round(now + ((100 - limit.percentUsed) * span) / gained)

  return {
    ...unknown,
    perHour,
    exhaustsAt,
    outlook: resetsAt === null ? 'open' : exhaustsAt < resetsAt ? 'short' : 'lasting',
  }
}

export const forecastsOf = (
  limits: readonly RateLimit[],
  tracks: readonly LimitTrack[],
  now: number,
): LimitForecast[] =>
  limits.map(limit => forecastLimit(limit, tracks.find(track => track.kind === limit.kind), now))

const LIMIT_NAME: { [kind: string]: readonly [string, string] } = {
  five_hour: ['5h', 'five-hour'],
  seven_day: ['7d', 'seven-day'],
  spend_limit: ['spend', 'spend'],
}

// A window's name, short for the band and whole for a sentence.
export const limitName = (kind: string, isShort = false): string =>
  LIMIT_NAME[kind]?.[isShort ? 0 : 1] ?? clip(kind.replace(/_/g, ' '), isShort ? 8 : 24)

const rate = (perHour: number | null): string => `${Math.round((perHour ?? 0) * 10) / 10}%/h`

// A forecast in a line, for the Resources view.
export const forecastText = (forecast: LimitForecast, now: number): string => {
  const { outlook, resetsAt } = forecast
  const full = about((forecast.exhaustsAt ?? now) - now)
  if (outlook === 'spent') {
    return resetsAt === null || resetsAt <= now
      ? 'limit reached'
      : `limit reached · resets in ${about(resetsAt - now)}`
  }
  if (outlook === 'learning') return 'pace not known yet: it takes a few readings'
  if (outlook === 'steady') return 'no rise lately: not on course to run out'
  if (outlook === 'open') return `full in about ${full} at ${rate(forecast.perHour)} · no reset time reported`
  if (outlook === 'lasting') return `at ${rate(forecast.perHour)} it lasts until the reset`
  const early = about((resetsAt ?? now) - (forecast.exhaustsAt ?? now))

  return `full in about ${full} at ${rate(forecast.perHour)}, ${early} before it resets`
}

// The window most worth a warning, in a few words for the band: one already
// full, else the one on course to run out soonest before its reset.
export const limitAlert = (forecasts: readonly LimitForecast[], now: number): string | undefined => {
  const spent = forecasts.find(one => one.outlook === 'spent')
  if (spent !== undefined) return `⚠ ${limitName(spent.kind, true)} limit reached`
  const short = forecasts
    .filter(one => one.outlook === 'short')
    .sort((a, b) => (a.exhaustsAt ?? 0) - (b.exhaustsAt ?? 0))[0]

  return short === undefined
    ? undefined
    : `⚠ ${limitName(short.kind, true)} limit out in ${about((short.exhaustsAt ?? now) - now)}`
}

// The one toast a window on course to run out early gets.
export const limitToast = (forecast: LimitForecast, now: number): string => {
  const full = about((forecast.exhaustsAt ?? now) - now)
  const early = about((forecast.resetsAt ?? now) - (forecast.exhaustsAt ?? now))

  return `The ${limitName(forecast.kind)} limit is on course to run out in about ${full}, ${early} before it resets`
}

// ---------------------------------------------------------------- smart zone

// Where state-of-the-art models stop reasoning sharply, whatever the window.
export const SMART_ZONE = 150_000

// The `smartZone` option as given, or the default for anything unusable.
export const smartZoneOf = (option: unknown): number =>
  typeof option === 'number' && Number.isFinite(option) && option > 0 ? Math.round(option) : SMART_ZONE

// The smart-zone limit: the option, or less on a window too small to hold it.
// An unknown window leaves the option alone.
export const zoneLimit = (window: number, smartZone: number): number =>
  window > 0 ? Math.min(smartZone, Math.floor(window * 0.8)) : smartZone

// The caution comes at 80% of the limit.
export const zoneCaution = (limit: number): number => Math.floor(limit * 0.8)

export const zoneOf = (tokens: number, limit: number): ZoneLevel =>
  limit <= 0 ? 'inside' : tokens >= limit ? 'out' : tokens >= zoneCaution(limit) ? 'caution' : 'inside'

const ZONE_RANK: Record<ZoneLevel, number> = { inside: 0, caution: 1, out: 2 }

// What a new reading announces: only a climb past the level last announced.
// Falling below the caution re-arms both warnings.
export const zoneCrossing = (
  announced: ZoneLevel,
  level: ZoneLevel,
): { announced: ZoneLevel; crossed?: ZoneLevel } => {
  if (level === 'inside') return { announced: 'inside' }

  return ZONE_RANK[level] > ZONE_RANK[announced] ? { announced: level, crossed: level } : { announced }
}

// The crossing owed to Claude after a reading: the higher of what was owed
// and what was just crossed, nothing once context is back inside.
export const zoneOwing = (owed: ZoneLevel, level: ZoneLevel, crossed: ZoneLevel | undefined): ZoneLevel => {
  if (level === 'inside') return 'inside'
  if (crossed === undefined) return owed

  return ZONE_RANK[crossed] > ZONE_RANK[owed] ? crossed : owed
}

// What Claude reads after the person's next prompt, once per crossing: never
// in the system prompt, whose cache a long session cannot afford to lose.
export const zoneNote = (level: ZoneLevel, tokens: number, limit: number): string =>
  level === 'out'
    ? [
        `Polis: this session's context is ${compact(tokens)}, past the smart-zone limit of ${compact(limit)}, beyond which reasoning is no longer at its sharpest.`,
        'Stop at the next phase boundary (the gap between two chunks of work, such as grilling and implementing) and recommend the person clears or compacts:',
        'recommend /clear, after writing down what the next phase needs, when the next phase does not depend on this conversation;',
        'recommend /compact when it does and losing some detail will not hurt the work.',
        'Until then, hand independent remaining pieces to sub-agents, which start with fresh context.',
        'Never carry on past this point without saying so.',
      ].join(' ')
    : [
        `Polis: this session's context is ${compact(tokens)}, past the smart-zone caution (${compact(zoneCaution(limit))} of a ${compact(limit)} limit).`,
        'Plan how this work will stop while there is still room:',
        'hand independent remaining pieces to sub-agents, which start with fresh context,',
        'or aim to stop at the next phase boundary.',
      ].join(' ')

// The smart-zone state in a few words, for the status line and the page;
// nothing inside the smart zone.
export const zoneMark = (level: ZoneLevel, tokens: number): string | undefined =>
  level === 'out'
    ? `ctx ${compact(tokens)}: out of the smart zone`
    : level === 'caution'
      ? `ctx ${compact(tokens)}: smart-zone caution`
      : undefined

// The toast for a crossing, saying what to do about it.
export const zoneToast = (level: ZoneLevel, tokens: number, limit: number): string =>
  level === 'out'
    ? `Out of the smart zone: context ${compact(tokens)} is past ${compact(limit)}. At the next phase boundary, /compact or /clear`
    : `Smart-zone caution: context ${compact(tokens)} of ${compact(limit)}. Plan a stop: hand remaining pieces to sub-agents, or aim for the next phase boundary`

// --------------------------------------------------------------------- waits

// The tools whose call is itself a wait on the person, whatever the mode.
export const ASKING: { [tool: string]: WaitKind } = {
  AskUserQuestion: 'question',
  ExitPlanMode: 'plan',
}

// One wait for each thing waited on: the same loop asking again for the same
// tool takes the place of its earlier request.
export const addWait = (list: readonly Wait[], wait: Wait): Wait[] =>
  [
    ...list.filter(
      one => !(one.kind === wait.kind && one.tool === wait.tool && one.agentId === wait.agentId),
    ),
    wait,
  ].slice(-12)

// A wait that holds work up, where the end of a turn only hands it back.
export const isBlocking = (wait: Wait): boolean => wait.kind !== 'turn'

// What the person is needed for first: the oldest thing holding work up,
// else the turn handed back to them.
export const topWait = (list: readonly Wait[]): Wait | undefined =>
  list.find(isBlocking) ?? list.find(wait => wait.kind === 'turn')

// What holds work up until the person acts: the top wait when it blocks.
export const topNeed = (list: readonly Wait[]): Wait | undefined => {
  const top = topWait(list)

  return top !== undefined && isBlocking(top) ? top : undefined
}

export const waitText = (wait: Wait): string => {
  if (wait.kind === 'permission') return `permission for ${clip(wait.tool ?? 'a tool', 28)}`
  if (wait.kind === 'question') return 'a question for you'
  if (wait.kind === 'plan') return 'a plan to approve'
  if (wait.kind === 'input') return `input for ${clip(wait.detail ?? 'a connector', 28)}`
  if (wait.kind === 'asked') return askText(wait.count)

  return wait.detail ?? 'your turn'
}

// A wait as the band and the status line mark it.
export const waitMark = (wait: Wait): string =>
  isBlocking(wait) ? `▲ needs you: ${waitText(wait)}` : `◇ ${waitText(wait)}`

export type SessionState = 'needs you' | 'working' | 'your turn' | 'idle'

// What the main session is doing: a wait on the person comes before the work
// it holds up.
export const sessionState = (isWorking: boolean, waits: readonly Wait[]): SessionState => {
  const top = topWait(waits)
  if (top !== undefined && isBlocking(top)) return 'needs you'
  if (isWorking) return 'working'

  return top === undefined ? 'idle' : 'your turn'
}

// The first question of an AskUserQuestion call, read loosely.
export const firstQuestion = (input: unknown): string | undefined => {
  const questions = (input as { questions?: unknown } | null)?.questions

  return Array.isArray(questions) ? field(questions[0], 'question') : undefined
}

// -------------------------------------------------------------------- skills

// Skills whose name or description shares words with what is being worked on.
export const suggestSkills = (
  available: readonly SkillInfo[],
  used: { [name: string]: number },
  corpus: string,
): string[] => {
  const wanted = new Set(words(corpus))
  if (wanted.size === 0) return []

  return available
    .filter(skill => used[skill.name] === undefined)
    .map(skill => {
      const named = words(skill.name).filter(word => wanted.has(word)).length
      const described = new Set(words(skill.description).filter(word => wanted.has(word))).size

      return { name: skill.name, score: named * 3 + described }
    })
    .filter(one => one.score >= 3)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(one => one.name)
}

// ------------------------------------------------------------------- project

export const projectName = (root: string): string => {
  const parts = root.split(/[\\/]+/).filter(part => part !== '')
  if (parts.includes('scratch-workspaces')) return 'Scratch'

  return parts[parts.length - 1] ?? 'Project'
}

// A path under the root, joined the way the root itself is written.
export const under = (root: string, ...parts: string[]): string => {
  const separator = root.includes('\\') && !root.includes('/') ? '\\' : '/'

  return [root.replace(/[\\/]+$/, ''), ...parts].join(separator)
}

// An absolute path as the address a browser opens: `C:\a\b` and `/a/b` alike.
export const fileUrl = (path: string): string => {
  const parts = path.split(/[\\/]+/).filter(part => part !== '')
  const hasDrive = /^[A-Za-z]:$/.test(parts[0] ?? '')
  const encoded = parts.map((part, index) =>
    index === 0 && hasDrive ? part : encodeURIComponent(part),
  )
  // A network share (`\\server\share`) names its server where a host goes.
  const isShare = /^(\\\\|\/\/)[^\\/]/.test(path)

  return `${isShare ? 'file://' : 'file:///'}${encoded.join('/')}`
}

export const newProject = (root: string, at: number): Project => ({
  root,
  name: projectName(root),
  phase: '',
  milestones: [],
  sessions: 0,
  lastSessionId: '',
  turns: 0,
  tokens: 0,
  tasksDone: 0,
  lastActive: at,
})

// What the store handed back, held to the record's shape: a value written by
// other code, or none, starts the project over.
export const asProject = (saved: unknown, root: string, at: number): Project => {
  const fresh = newProject(root, at)
  if (typeof saved !== 'object' || saved === null) return fresh
  const bag = saved as { [key: string]: unknown }
  const count = (key: string): number => (typeof bag[key] === 'number' ? (bag[key] as number) : 0)

  return mergeProject(
    {
      ...fresh,
      sessions: count('sessions'),
      lastSessionId: typeof bag.lastSessionId === 'string' ? bag.lastSessionId : '',
      turns: count('turns'),
      tokens: count('tokens'),
      tasksDone: count('tasksDone'),
    },
    { name: bag.name, phase: bag.phase, milestones: bag.milestones },
  )
}

export const asHistory = (saved: unknown): TurnRecord[] => {
  if (!Array.isArray(saved)) return []

  return saved
    .filter(
      (one): one is TurnRecord =>
        typeof one === 'object' &&
        one !== null &&
        SIZES.includes((one as TurnRecord).size) &&
        typeof (one as TurnRecord).tokens === 'number' &&
        typeof (one as TurnRecord).ms === 'number' &&
        typeof (one as TurnRecord).tools === 'number',
    )
    .slice(-300)
}

// ------------------------------------------------------------- carried tasks

/** The task list as the store keeps it between sessions. */
export type SavedTasks = { sessionId: string; at: number; tasks: Task[] }

// How long finished work stays on the board of the sessions that follow.
export const KEEP_DONE = 7 * 24 * HOUR

const finite = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined

// Finished tasks marked with when they were first saved so, and the mark
// taken off reopened ones: what a later session keeps them by.
export const stampDone = (list: readonly Task[], now: number): Task[] =>
  list.map(task => {
    if (task.status === 'completed') return task.doneAt === undefined ? { ...task, doneAt: now } : task
    if (task.doneAt === undefined) return task
    const { doneAt: _dropped, ...rest } = task

    return rest
  })

const strings = <K extends string>(raw: unknown, keys: readonly K[]): { [P in K]?: string } => {
  const out: { [P in K]?: string } = {}
  for (const key of keys) {
    const value = field(raw, key)
    if (value !== undefined) out[key] = value
  }

  return out
}

// One saved task, held to the contract's shape; one without an id, a subject
// or a known status is dropped.
const asTask = (raw: unknown): Task | undefined => {
  const id = field(raw, 'id')
  const subject = field(raw, 'subject')
  const status = TASK_STATUSES.find(one => one === field(raw, 'status'))
  if (id === undefined || subject === undefined || status === undefined) return undefined
  const bag = raw as { [key: string]: unknown }
  const areaFrom = (['tag', 'code', 'title'] as const).find(one => one === bag.areaFrom)
  const touched: { [area: string]: number } = {}
  if (typeof bag.touched === 'object' && bag.touched !== null) {
    for (const [area, count] of Object.entries(bag.touched).slice(0, 40)) {
      const edits = finite(count)
      if (edits !== undefined) touched[area] = edits
    }
  }
  const said = bag.verdict as { state?: unknown; by?: unknown; at?: unknown } | null | undefined
  const state = (['passed', 'failed'] as const).find(one => one === said?.state)
  const by = (['verifier', 'checks'] as const).find(one => one === said?.by)
  const doneAt = finite(bag.doneAt)

  return {
    id,
    subject: clip(subject, 240),
    status,
    area: (field(raw, 'area') ?? 'general').slice(0, 24),
    blockedBy: Array.isArray(bag.blockedBy)
      ? bag.blockedBy.filter((one): one is string => typeof one === 'string').slice(0, 40)
      : [],
    source: bag.source === 'todo' ? 'todo' : 'task',
    ...(areaFrom === undefined ? {} : { areaFrom }),
    ...(Object.keys(touched).length === 0 ? {} : { touched }),
    ...(state === undefined || by === undefined
      ? {}
      : { verdict: { state, by, at: finite(said?.at) ?? 0 } }),
    ...(doneAt === undefined ? {} : { doneAt }),
    ...strings(raw, ['activeForm', 'parentId', 'owner', 'agentId', 'sessionId']),
  }
}

// The tasks a session starts with: what the store kept of the project's
// board, less the work finished more than a week ago. Another session's tasks
// are marked as its own and renamed after it, since every session numbers its
// tasks from one; the same session resumed takes its list back as it was.
export const carryTasks = (saved: unknown, sessionId: string, now: number): Task[] => {
  const bag = saved as { at?: unknown; tasks?: unknown } | null | undefined
  if (typeof bag !== 'object' || bag === null || !Array.isArray(bag.tasks)) return []
  const from = field(saved, 'sessionId') ?? 'earlier'
  const at = finite(bag.at) ?? 0
  const all = bag.tasks.slice(-240).flatMap(raw => asTask(raw) ?? [])
  const kept = all.filter(
    task => task.status !== 'completed' || now - (task.doneAt ?? at) <= KEEP_DONE,
  )
  if (from === sessionId) return kept
  const mark = from.slice(0, 8)
  const ids = new Map(
    all.filter(task => task.sessionId === undefined).map(task => [task.id, `${mark}/${task.id}`] as const),
  )

  return kept.map(task => {
    if (task.sessionId !== undefined) return task
    // The loop that recorded it ended with its session.
    const { agentId: _ended, parentId, ...rest } = task

    return {
      ...rest,
      id: ids.get(task.id) ?? task.id,
      sessionId: from,
      blockedBy: task.blockedBy.map(id => ids.get(id) ?? id),
      ...(parentId === undefined ? {} : { parentId: ids.get(parentId) ?? parentId }),
    }
  })
}

// A loose read of one string field off a tool's result, whatever the tool.
export const pick = (bag: unknown, key: string): string | undefined => field(bag, key)

const STATUSES: readonly MilestoneStatus[] = ['planned', 'active', 'done']

export type ProjectInput = { name?: unknown; phase?: unknown; milestones?: unknown }

// What the model sent through the project tool, merged into the record:
// milestones are matched by id, new ones appended in the order given.
export const mergeProject = (project: Project, input: ProjectInput): Project => {
  const milestones = [...project.milestones]
  const given = Array.isArray(input.milestones) ? input.milestones : []
  for (const raw of given.slice(0, 40)) {
    const title = field(raw, 'title')
    const id = field(raw, 'id') ?? title?.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40)
    if (id === undefined) continue
    const stated = field(raw, 'status')
    const at = milestones.findIndex(one => one.id === id)
    const before = milestones[at]
    const status = STATUSES.find(one => one === stated) ?? before?.status ?? 'planned'
    const next: Milestone = { id, title: clip(title ?? before?.title ?? id, 80), status }
    if (at === -1) milestones.push(next)
    else milestones[at] = next
  }

  return {
    ...project,
    ...(typeof input.name === 'string' && input.name.trim() !== ''
      ? { name: clip(input.name, 40) }
      : {}),
    ...(typeof input.phase === 'string' ? { phase: clip(input.phase, 60) } : {}),
    milestones: milestones.slice(0, 40),
  }
}

export type Progress = { done: number; total: number; percent: number; unit: string }

// Milestones when the project has them, else this session's tasks.
export const progressOf = (project: Project | null, tasks: readonly Task[]): Progress => {
  const milestones = project?.milestones ?? []
  if (milestones.length > 0) {
    const done = milestones.filter(one => one.status === 'done').length
    const active = milestones.filter(one => one.status === 'active').length
    const percent = Math.round(((done + active * 0.5) / milestones.length) * 100)

    return { done, total: milestones.length, percent, unit: 'milestones' }
  }
  const top = tasks.filter(task => task.parentId === undefined)
  const done = top.filter(task => task.status === 'completed').length
  const active = top.filter(task => task.status === 'in_progress').length
  const percent = top.length === 0 ? 0 : Math.round(((done + active * 0.5) / top.length) * 100)

  return { done, total: top.length, percent, unit: 'tasks' }
}

// ------------------------------------------------------------ activity, files

export const pushActivity = (list: readonly Activity[], entry: Activity): Activity[] =>
  [...list, { ...entry, text: clip(entry.text, 90) }].slice(-30)

export const hitFile = (list: readonly FileHit[], path: string): FileHit[] => {
  const found = list.find(one => one.path === path)
  const rest = list.filter(one => one.path !== path)

  return [...rest, { path, edits: (found?.edits ?? 0) + 1 }].slice(-60)
}

export const hotFiles = (list: readonly FileHit[], limit: number): FileHit[] =>
  [...list].sort((a, b) => b.edits - a.edits).slice(0, limit)

export const shortPath = (path: string): string => {
  const parts = path.split(/[\\/]+/).filter(part => part !== '')

  return parts.slice(-2).join('/')
}
