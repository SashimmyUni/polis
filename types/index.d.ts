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

export type Usage = {
  contextTokens: number
  contextWindow: number
  contextPercent: number
  rateLimits: RateLimit[]
  costUsd: number
  sessionTokens: number
  mainFamilies: FamilyCounts
  hasWarnedContext: boolean
}

export type TurnRecord = {
  size: Size
  tokens: number
  ms: number
  tools: number
  agents: number
  at: number
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

export type ViewName = 'overview' | 'city' | 'tasks' | 'agents' | 'resources' | 'skills'

export type Ui = { view: ViewName; isBandHidden: boolean; hasOpened: boolean }

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
      tick: number
    }
  }
}
