import type { AgentNode, AgentRun, AgentRunStatus, ProjectLog, SessionRecord, Task } from '../types'
import { clip, compact } from './logic'

// A pure module: the per-project log of sessions, kept in the store and read
// back by every later session. Nothing here touches the engine.

export type { AgentNode, ProjectLog, SessionRecord } from '../types'

export type ProjectTotals = {
  sessions: number
  /** Agents spawned by a main loop. */
  agents: number
  /** Agents spawned by another agent, at any depth. */
  subAgents: number
  turns: number
  tokens: number
  costUsd: number
  tasksDone: number
}

export const MAX_SESSIONS = 40

// Sessions older than the newest few keep their top-level agents only, so the
// stored log stays small however long the project runs.
const FULL_SESSIONS = 10

// Bounds on what a saved log may hold: it is read back untrusted.
const MAX_DEPTH = 8
const MAX_SIBLINGS = 60

// ---------------------------------------------------------------- agent tree

const nodeOf = (run: AgentRun): AgentNode => ({
  key: run.key,
  type: run.type,
  label: run.label,
  ...(run.name === undefined ? {} : { name: run.name }),
  status: run.status,
  tokens: run.tokens,
  tools: run.tools,
  startedAt: run.startedAt,
  ...(run.endedAt === undefined ? {} : { endedAt: run.endedAt }),
  children: [],
})

// The runs nested by who spawned them, oldest first at every level. A run
// whose parent is absent, unknown or itself is top-level; a run caught in a
// cycle of parents is taken as top-level at the point the walk meets it, so
// that no run is lost and none is shown twice.
export const agentTree = (agents: readonly AgentRun[]): AgentNode[] => {
  const runs = [...agents].sort((a, b) => a.startedAt - b.startedAt)
  const ids = new Set(runs.map(run => run.agentId))
  const seen = new Set<AgentRun>()
  const grow = (run: AgentRun): AgentNode => {
    seen.add(run)
    const node = nodeOf(run)
    if (run.agentId !== undefined) {
      for (const child of runs) {
        if (child.parentAgentId === run.agentId && !seen.has(child)) node.children.push(grow(child))
      }
    }

    return node
  }
  const roots: AgentNode[] = []
  for (const run of runs) {
    const parent = run.parentAgentId
    if (parent === undefined || parent === run.agentId || !ids.has(parent)) roots.push(grow(run))
  }
  // What no top-level run reached sits in a cycle of parents.
  for (const run of runs) {
    if (!seen.has(run)) roots.push(grow(run))
  }

  return roots
}

export const sessionRecord = (input: {
  id: string
  startedAt: number
  now: number
  title: string
  turns: number
  tokens: number
  costUsd: number
  tasks: readonly Task[]
  filesEdited: number
  agents: readonly AgentRun[]
}): SessionRecord => ({
  id: input.id,
  startedAt: input.startedAt,
  lastActive: input.now,
  title: clip(input.title, 80),
  turns: input.turns,
  tokens: input.tokens,
  costUsd: input.costUsd,
  tasksDone: input.tasks.filter(task => task.status === 'completed').length,
  tasksTotal: input.tasks.length,
  filesEdited: input.filesEdited,
  agents: agentTree(input.agents),
})

// ----------------------------------------------------------------------- log

export const emptyLog = (root: string): ProjectLog => ({ root, sessions: [] })

const STATUSES: readonly AgentRunStatus[] = ['starting', 'running', 'done', 'failed']

const bagOf = (value: unknown): { [key: string]: unknown } | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as { [key: string]: unknown })
    : undefined

const count = (value: unknown): number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0

const text = (value: unknown): string => (typeof value === 'string' ? value : '')

// One saved agent, held to the node's shape; a node without a key or a known
// status is dropped, and so is everything below it.
const asNode = (raw: unknown, depth: number): AgentNode | undefined => {
  const bag = bagOf(raw)
  const status = STATUSES.find(one => one === bag?.status)
  if (bag === undefined || typeof bag.key !== 'string' || status === undefined) return undefined
  const endedAt = count(bag.endedAt)

  return {
    key: bag.key,
    type: clip(text(bag.type), 60),
    label: clip(text(bag.label), 120),
    ...(typeof bag.name === 'string' && bag.name !== '' ? { name: clip(bag.name, 60) } : {}),
    status,
    tokens: count(bag.tokens),
    tools: count(bag.tools),
    startedAt: count(bag.startedAt),
    ...(endedAt === 0 ? {} : { endedAt }),
    children: asNodes(bag.children, depth + 1),
  }
}

const asNodes = (raw: unknown, depth: number): AgentNode[] => {
  if (!Array.isArray(raw) || depth > MAX_DEPTH) return []
  const nodes: AgentNode[] = []
  for (const one of raw.slice(0, MAX_SIBLINGS)) {
    const node = asNode(one, depth)
    if (node !== undefined) nodes.push(node)
  }

  return nodes
}

// One saved session; one with no id cannot be told from another and is dropped.
const asSession = (raw: unknown): SessionRecord | undefined => {
  const bag = bagOf(raw)
  if (bag === undefined || typeof bag.id !== 'string' || bag.id === '') return undefined

  return {
    id: bag.id,
    startedAt: count(bag.startedAt),
    lastActive: count(bag.lastActive),
    title: clip(text(bag.title), 80),
    turns: count(bag.turns),
    tokens: count(bag.tokens),
    costUsd: count(bag.costUsd),
    tasksDone: count(bag.tasksDone),
    tasksTotal: count(bag.tasksTotal),
    filesEdited: count(bag.filesEdited),
    agents: asNodes(bag.agents, 0),
  }
}

// Sessions in the order they began, the newest MAX_SESSIONS of them, and all
// but the newest few cut down to their top-level agents.
const settle = (sessions: readonly SessionRecord[]): SessionRecord[] => {
  const kept = [...sessions].sort((a, b) => a.startedAt - b.startedAt).slice(-MAX_SESSIONS)
  const old = kept.length - FULL_SESSIONS

  return kept.map((session, at) =>
    at < old
      ? { ...session, agents: session.agents.map(agent => ({ ...agent, children: [] })) }
      : session,
  )
}

// What the store handed back, held to the log's shape: damage is dropped piece
// by piece, and a log of another project, or none, starts the log over.
export const asProjectLog = (saved: unknown, root: string): ProjectLog => {
  const bag = bagOf(saved)
  if (bag === undefined || bag.root !== root || !Array.isArray(bag.sessions)) return emptyLog(root)
  const byId = new Map<string, SessionRecord>()
  for (const raw of bag.sessions) {
    const session = asSession(raw)
    if (session !== undefined) byId.set(session.id, session)
  }

  return { root, sessions: settle([...byId.values()]) }
}

// The session with this id replaced, or added; the input is left as it was.
export const upsertSession = (log: ProjectLog, record: SessionRecord): ProjectLog => ({
  root: log.root,
  sessions: settle([...log.sessions.filter(one => one.id !== record.id), record]),
})

// ------------------------------------------------------------------- totals

export const countAgents = (nodes: readonly AgentNode[]): { agents: number; subAgents: number } => {
  let subAgents = 0
  const below = (list: readonly AgentNode[]): void => {
    for (const node of list) {
      subAgents += 1
      below(node.children)
    }
  }
  for (const node of nodes) below(node.children)

  return { agents: nodes.length, subAgents }
}

export const totalsOf = (log: ProjectLog): ProjectTotals => {
  const totals: ProjectTotals = {
    sessions: log.sessions.length,
    agents: 0,
    subAgents: 0,
    turns: 0,
    tokens: 0,
    costUsd: 0,
    tasksDone: 0,
  }
  for (const session of log.sessions) {
    const { agents, subAgents } = countAgents(session.agents)
    totals.agents += agents
    totals.subAgents += subAgents
    totals.turns += session.turns
    totals.tokens += session.tokens
    totals.costUsd += session.costUsd
    totals.tasksDone += session.tasksDone
  }

  return totals
}

// -------------------------------------------------------------------- lines

// The marks of RUN_MARK in hooks/views.tsx, copied: that module is not for a
// pure one to import.
const RUN_MARK: Record<AgentRunStatus, string> = {
  starting: '◌',
  running: '●',
  done: '✔',
  failed: '✘',
}

// Most levels of agents shown under a session, and most top-level agents.
const SHOWN_LEVELS = 4
const SHOWN_AGENTS = 6

const ago = (ms: number): string => {
  const minutes = Math.floor(Math.max(0, ms) / 60_000)
  if (minutes < 1) return 'now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)

  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

const dollars = (usd: number): string => `$${usd.toFixed(2)}`

const plural = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

// A line cut to the width; the indent is part of it, so the cut is made here
// and not by `clip`, which would trim the indent away.
const fit = (line: string, columns: number): string =>
  line.length <= columns ? line : `${line.slice(0, Math.max(1, columns - 1))}…`

const sessionLine = (session: SessionRecord, isLive: boolean, now: number, columns: number): string => {
  const head = `${isLive ? '●' : '○'} ${ago(now - session.lastActive)}`
  const full = [
    plural(session.turns, 'turn'),
    `${compact(session.tokens)} tokens`,
    dollars(session.costUsd),
    `${session.tasksDone}/${session.tasksTotal} tasks`,
  ].join(' · ')
  const short = [
    `${session.turns}t`,
    compact(session.tokens),
    dollars(session.costUsd),
    `${session.tasksDone}/${session.tasksTotal}`,
  ].join(' · ')
  // The figures have the right of way; the title takes what is left, and in a
  // narrow pane the figures lose their words before the title is lost.
  const room = (figures: string): number => columns - head.length - 5 - figures.length
  const figures = room(full) >= 14 ? full : short
  const title = session.title === '' ? 'untitled session' : session.title

  return fit(`${head}  ${clip(title, Math.max(8, room(figures)))} — ${figures}`, columns)
}

const hiddenCount = (nodes: readonly AgentNode[]): number => {
  const { agents, subAgents } = countAgents(nodes)

  return agents + subAgents
}

const agentLine = (node: AgentNode, level: number, columns: number): string => {
  const indent = ' '.repeat(level * 2)
  const lead = node.name === undefined ? node.type : `${node.name} (${node.type})`
  const figures = `${compact(node.tokens)} tok · ${plural(node.tools, 'tool')}`
  const room = columns - indent.length - 4 - lead.length - 2 - figures.length - 3
  const label = clip(node.label, Math.max(4, room))
  const words = label === '' ? lead : `${lead}: ${label}`

  return fit(`${indent}└ ${RUN_MARK[node.status]} ${words} · ${figures}`, columns)
}

const agentLines = (nodes: readonly AgentNode[], level: number, columns: number): string[] => {
  const indent = ' '.repeat(level * 2)
  if (level > SHOWN_LEVELS) {
    return nodes.length === 0 ? [] : [fit(`${indent}└ … ${hiddenCount(nodes)} more below`, columns)]
  }
  // Of too many agents the heaviest are shown, in the order they began.
  const shown =
    level === 1 && nodes.length > SHOWN_AGENTS
      ? new Set([...nodes].sort((a, b) => b.tokens - a.tokens).slice(0, SHOWN_AGENTS))
      : undefined
  const lines: string[] = []
  for (const node of nodes) {
    if (shown !== undefined && !shown.has(node)) continue
    lines.push(agentLine(node, level, columns), ...agentLines(node.children, level + 1, columns))
  }
  if (shown !== undefined) lines.push(fit(`${indent}└ … ${nodes.length - shown.size} more agents`, columns))

  return lines
}

// The whole project as lines for a terminal: the newest session first, each
// with its agents under it, and the sub-agents under theirs.
export const projectLines = (
  log: ProjectLog,
  options: { now: number; liveId?: string; columns: number; maxSessions?: number },
): string[] => {
  const columns = Math.max(20, Math.floor(options.columns))
  const limit = Math.max(0, Math.floor(options.maxSessions ?? 8))
  const newest = [...log.sessions].sort((a, b) => b.startedAt - a.startedAt)
  const lines: string[] = []
  for (const session of newest.slice(0, limit)) {
    lines.push(
      sessionLine(session, session.id === options.liveId, options.now, columns),
      ...agentLines(session.agents, 1, columns),
    )
  }
  const hidden = newest.length - limit
  if (hidden > 0) lines.push(fit(`… and ${hidden} earlier session${hidden === 1 ? '' : 's'}`, columns))

  return lines
}

// 12 sessions · 31 agents · 9 sub-agents · 4.2M tokens · $18.40
export const projectHeadline = (log: ProjectLog): string => {
  const totals = totalsOf(log)

  return [
    plural(totals.sessions, 'session'),
    plural(totals.agents, 'agent'),
    plural(totals.subAgents, 'sub-agent'),
    `${compact(totals.tokens)} tokens`,
    dollars(totals.costUsd),
  ].join(' · ')
}
