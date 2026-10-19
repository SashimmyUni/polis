export type TaskStatus = 'pending' | 'in_progress' | 'completed'

export type Task = {
  id: string
  subject: string
  status: TaskStatus
  activeForm?: string
  /** The work area the task belongs to: its district on the map. */
  area: string
  /** The task this one is a sub-task of. */
  parentId?: string
  owner?: string
  /** The subagent loop that recorded it; absent for the main loop's. */
  agentId?: string
  blockedBy: string[]
  source: 'task' | 'todo'
  /** Where the area came from: a tag the model gave, the code edited, or the title. */
  areaFrom?: 'tag' | 'code' | 'title'
  /** Edits made for the task, by code area. */
  touched?: { [area: string]: number }
  /** What a verifier or a test run said of the finished work. */
  verdict?: Verdict
  /** When it was first saved as completed: what a later session keeps it by. */
  doneAt?: number
  /** The earlier session that recorded it; absent for this session's own. */
  sessionId?: string
}

export type Verdict = { state: 'passed' | 'failed'; by: 'verifier' | 'checks'; at: number }

export type CheckKind = 'test' | 'lint' | 'types' | 'build'

/** The last run of one kind of check. */
export type Check = {
  kind: CheckKind
  hasPassed: boolean
  /** When it finished. */
  at: number
  ms: number
  command: string
  /** Files edited since it ran. */
  editsSince: number
}

/** The working tree as git last told it. */
export type GitState = {
  branch: string
  ahead: number
  behind: number
  /** Tracked files with uncommitted changes (changed, renamed, unmerged). */
  files: number
  /** Inserted lines. */
  added: number
  /** Deleted lines. */
  removed: number
  untracked: number
  at: number
}

export type ToolFamily =
  | 'search'
  | 'read'
  | 'edit'
  | 'shell'
  | 'web'
  | 'mcp'
  | 'skill'
  | 'delegate'
  | 'plan'
  | 'other'

export type FamilyCounts = { [family: string]: number }

export type AgentRunStatus = 'starting' | 'running' | 'done' | 'failed'

export type AgentRun = {
  key: string
  agentId?: string
  parentAgentId?: string
  label: string
  type: string
  name?: string
  model?: string
  status: AgentRunStatus
  tools: number
  /** Tool calls by family: what the agent is equipped with on its icon. */
  families: FamilyCounts
  lastTool?: string
  /** The task the agent is working on, when one could be matched. */
  taskId?: string
  tokens: number
  startedAt: number
  endedAt?: number
}

/** One agent of a session, with the sub-agents it spawned under it. */
export type AgentNode = {
  key: string
  type: string
  label: string
  name?: string
  status: AgentRunStatus
  tokens: number
  tools: number
  startedAt: number
  endedAt?: number
  children: AgentNode[]
}

/** What is kept of one session of the project. */
export type SessionRecord = {
  id: string
  startedAt: number
  lastActive: number
  /** What the session was about: its first prompt, clipped. */
  title: string
  turns: number
  tokens: number
  costUsd: number
  tasksDone: number
  tasksTotal: number
  filesEdited: number
  /** The main loop's agents, each with its sub-agents nested. */
  agents: AgentNode[]
}

/** One finished task as the project's archive keeps it. */
export type ArchiveEntry = {
  /** The id a later session carries it as: an earlier session's mark, a slash, its own id. */
  id: string
  subject: string
  area: string
  verdict?: 'passed' | 'failed'
  doneAt: number
  sessionId: string
}

/** Every task the project has finished: the newest in full, the rest as counts per district. */
export type Archive = { entries: ArchiveEntry[]; folded: { [area: string]: number } }

/** Every session of the project, as the store keeps them. */
export type ProjectLog = { root: string; sessions: SessionRecord[] }

export type ProcKind = 'shell' | 'monitor' | 'workflow' | 'cron' | 'agent' | 'other'

export type ProcStatus = 'running' | 'done' | 'stopped'

export type Proc = {
  id: string
  kind: ProcKind
  label: string
  status: ProcStatus
  startedAt: number
  endedAt?: number
}

export type Size = 'S' | 'M' | 'L' | 'XL'

export type Range = { low: number; high: number }

export type Expected = {
  size: Size
  source: 'heuristic' | 'model'
  tokens: Range
  ms: Range
  tools: Range
  /** How many past turns of this size the ranges were drawn from. */
  samples: number
}

export type Turn = {
  id: string | null
  isWorking: boolean
  startedAt: number
  endedAt: number
  expected: Expected | null
  /** Tokens processed this turn: uncached input, cache writes and output. */
  tokens: number
  outTokens: number
  cacheRead: number
  tools: number
  steps: number
  agents: number
  hasWarned: boolean
}

export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

/** One reading of a limit window: how full it was, and when. */
export type LimitSample = { at: number; percent: number }

/** The readings of one limit window, from which its pace is told. */
export type LimitTrack = {
  kind: string
  /** When the window these readings belong to resets, as the engine gave it. */
  resetsAt?: string
  samples: LimitSample[]
  /** Whether running out before the reset has been announced for this window. */
  hasWarned: boolean
}

/** Where the context stands against the smart zone. */
export type ZoneLevel = 'inside' | 'caution' | 'out'

export type Usage = {
  contextTokens: number
  contextWindow: number
  contextPercent: number
  rateLimits: RateLimit[]
  costUsd: number
  sessionTokens: number
  mainFamilies: FamilyCounts
  /** The smart-zone limit in tokens, for the window last measured. */
  zoneLimit: number
  /** The highest smart-zone level announced since context last fell below the caution. */
  zoneAnnounced: ZoneLevel
  /** The highest crossing Claude has not yet been told of; 'inside' when none is owed. */
  zoneOwed: ZoneLevel
}

export type WaitKind = 'permission' | 'question' | 'plan' | 'input' | 'asked' | 'turn'

/** Something Claude is waiting on the person for. */
export type Wait = {
  kind: WaitKind
  at: number
  /** The tool whose call waits, for a permission, a question or a plan. */
  tool?: string
  /** The subagent loop that asked; absent for the main loop. */
  agentId?: string
  detail?: string
  /** How many questions a turn that ended asking put to the person. */
  count?: number
}

export type TurnRecord = {
  size: Size
  tokens: number
  ms: number
  tools: number
  agents: number
  at: number
}

/** How a wayfinder ticket waits: on the person, on no one, or a task (unmarked). */
export type TicketMark = 'HITL' | 'AFK' | null

/** One open map of the issue tracker, as far as the Tasks view shows it. */
export type FrontierMap = {
  number: number
  name: string
  /** Its open, unblocked, unclaimed tickets, in the map's order. */
  open: { number: number; title: string; mark: TicketMark }[]
  /** Its open tickets someone has taken, with who has them. */
  claimed: { number: number; title: string; assignees: string[] }[]
}

/** The tracker's frontier as last read through `gh`, kept per project root. */
export type Tracker = {
  /** When the maps were last read whole. */
  at: number
  /** When a read was last tried: the next waits five minutes from it. */
  triedAt: number
  /** True when the last try failed and `maps` is the read before it. */
  isFailed: boolean
  maps: FrontierMap[]
}

export type MilestoneStatus = 'planned' | 'active' | 'done'

export type Milestone = { id: string; title: string; status: MilestoneStatus }

export type Project = {
  root: string
  name: string
  phase: string
  milestones: Milestone[]
  sessions: number
  lastSessionId: string
  turns: number
  tokens: number
  tasksDone: number
  lastActive: number
}

export type SkillInfo = { name: string; description: string; source: string }

export type Skills = {
  available: SkillInfo[]
  used: { [name: string]: number }
  suggested: string[]
}

export type ViewName = 'overview' | 'project' | 'city' | 'tasks' | 'agents' | 'resources' | 'skills'

/** Which city the City view draws: the board's, or the board's with the archive. */
export type CityView = 'current' | 'full'

export type Ui = { view: ViewName; isBandHidden: boolean; hasOpened: boolean; cityView: CityView }

export type Activity = { at: number; kind: string; text: string }

export type FileHit = { path: string; edits: number }

declare module 'claude-code' {
  interface McpToolInputs {
    mcp__polis__project: {
      name?: string
      phase?: string
      milestones?: { id: string; title?: string; status?: MilestoneStatus }[]
      tasks?: {
        id: string
        subject?: string
        status?: TaskStatus | 'deleted'
        area?: string
        parent?: string
        owner?: string
        blockedBy?: string[]
        activeForm?: string
      }[]
    }
  }
  interface PluginState {
    polis: {
      tasks: Task[]
      agents: AgentRun[]
      procs: Proc[]
      turn: Turn
      usage: Usage
      history: TurnRecord[]
      project: Project | null
      skills: Skills
      ui: Ui
      activity: Activity[]
      files: FileHit[]
      waits: Wait[]
      limits: LimitTrack[]
      checks: Check[]
      git: GitState | null
      log: ProjectLog | null
      archive: Archive | null
      tick: number
      tracker: Tracker | null
    }
  }
}
