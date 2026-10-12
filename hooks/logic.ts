import type {
  Activity,
  AgentRun,
  Expected,
  FamilyCounts,
  FileHit,
  Milestone,
  MilestoneStatus,
  Proc,
  ProcKind,
  Project,
  Range,
  Size,
  SkillInfo,
  Task,
  TaskStatus,
  ToolFamily,
  TurnRecord,
} from '../types'

// ---------------------------------------------------------------- formatting

export const elapsed = (ms: number): string => {
  const seconds = Math.max(0, Math.round(ms / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m${String(seconds % 60).padStart(2, '0')}s`

  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`
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
  const kept = list.filter(task => !(task.source === 'todo' && (task.agentId ?? 'main') === loop))
  const fresh = todos.map((todo, index): Task => ({
    id: `todo:${loop}:${index}`,
    subject: todo.content,
    status: todo.status,
    area: inferArea(todo.content),
    blockedBy: [],
    source: 'todo',
    ...(todo.activeForm === undefined ? {} : { activeForm: todo.activeForm }),
    ...(agentId === undefined ? {} : { agentId }),
    ...(parentId === undefined ? {} : { parentId }),
  }))

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
  const task: Task = {
    id: draft.id,
    subject: draft.subject,
    status: 'pending',
    // A sub-task with no area of its own lives in its parent's district.
    area:
      field(draft.metadata, 'area') === undefined && parent !== undefined
        ? parent.area
        : areaOf(draft.metadata, draft.subject),
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
      ...(area === undefined ? {} : { area: area.toLowerCase().slice(0, 24) }),
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
