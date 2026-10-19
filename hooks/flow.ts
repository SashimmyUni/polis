// The flow: the phase of the work, read from the flow skills Claude invokes,
// with its kind (HITL work keeps the person close, AFK work runs without
// them) and the next step the flow calls for. Then the attention element: the
// strip's first element, what the person should know before anything else.
import { needsYouMark } from './live'
import { about, isLive, taskStats, topNeed, waitText } from './logic'
import { stallOf } from './stall'
import type { AgentRun, Flow, FlowKind, LiveSession, Progress, Stall, Task, Turn, Wait } from '../types'

type Row = readonly [skills: readonly string[], phase: string, kind: FlowKind, next: string, first?: string]

const TABLE: readonly Row[] = [
  [['grilling', 'grill-me', 'grill-with-docs', 'domain-modeling'], 'grilling', 'HITL', '/to-spec'],
  [['prototype'], 'prototyping', 'HITL', 'back to grilling'],
  [['wayfinder'], 'wayfinding', 'HITL', "the map's next ticket"],
  [['to-spec'], 'writing the spec', 'HITL', '/to-tickets'],
  [['to-tickets', 'to-ticket'], 'cutting tickets', 'AFK', '/clear, then /implement', '/clear'],
  [['implement', 'implement-spec', 'tdd'], 'implementing', 'AFK', '/code-review'],
  [['research'], 'researching', 'AFK', 'back to the ticket that asked'],
  [['code-review'], 'reviewing', 'AFK', 'merge or fix'],
  [['diagnosing-bugs'], 'diagnosing', 'AFK', '/code-review'],
  // Polis's own command, read as the person types it.
  [['orchestrate'], 'orchestrating', 'AFK', 'review the reports'],
]

// The phase a skill or slash command starts, by its name after any plugin
// prefix; nothing for a skill off the table.
export const flowOf = (name: string): Flow | undefined => {
  const bare = name.replace(/^\//, '').split(':').at(-1) ?? ''
  const row = TABLE.find(([skills]) => skills.includes(bare))
  if (row === undefined) return undefined
  const [, phase, kind, next, first] = row

  return { phase, kind, next, first: first ?? next }
}

// Off the flow, a turn this long that has put nothing to the person is work
// the person can leave.
export const AFK_AFTER_MS = 2 * 60_000

// What the attention element is made from.
export type AttentionInput = {
  now: number
  waits: readonly Wait[]
  turn: Pick<Turn, 'isWorking' | 'startedAt' | 'hasNeededYou'>
  agents: readonly AgentRun[]
  tasks: readonly Task[]
  flow: Flow | null
  /** The project's other live sessions: their needs join this session's. */
  others?: readonly LiveSession[]
  /** Whether the work moves; without it, work is never stalled. */
  progress?: Progress
}

// The kind of the work running now: the phase's while Claude works, else AFK
// while an agent runs or the turn has gone two minutes without needing the
// person; nothing while idle.
export const workKind = (m: AttentionInput): FlowKind | undefined => {
  if (!m.turn.isWorking) return undefined
  if (m.flow !== null) return m.flow.kind
  const isLong = !m.turn.hasNeededYou && m.now - m.turn.startedAt >= AFK_AFTER_MS

  return m.agents.some(isLive) || isLong ? 'AFK' : undefined
}

const ownNeed = (waits: readonly Wait[]): string | undefined => {
  const need = topNeed(waits)

  return need === undefined ? undefined : waitText(need)
}

// Why this session's work is stalled: only AFK work while the turn runs and
// nothing waits on the person here is ever stalled.
export const stalledOf = (m: AttentionInput): Stall | undefined => {
  if (m.progress === undefined || ownNeed(m.waits) !== undefined) return undefined
  if (workKind(m) !== 'AFK') return undefined

  return stallOf(m.progress, m.now)
}

// The strip's first element, chosen in its order: needs you (here, or in
// another live session of the project), then stalled work, then HITL work,
// then AFK work; nothing while idle. `needs` never drops off a narrow strip.
export type Attention = { tone: 'needs' | 'stalled' | 'work'; text: string }

export const attentionOf = (m: AttentionInput): Attention | undefined => {
  const needs = needsYouMark(ownNeed(m.waits), m.others ?? [])
  if (needs !== undefined) return { tone: 'needs', text: needs }
  const stall = stalledOf(m)
  if (stall !== undefined) return { tone: 'stalled', text: `⚠ stalled ${about(m.now - stall.since)}: ${stall.why}` }
  const kind = workKind(m)
  if (kind === undefined) return undefined
  if (kind === 'HITL') return { tone: 'work', text: `◆ HITL: ${m.flow?.phase ?? 'working'}` }
  const agents = m.agents.filter(isLive).length
  const stats = taskStats(m.tasks)
  const parts = [
    `◇ AFK: ${m.flow?.phase ?? 'working'}`,
    ...(agents === 0 ? [] : [`${agents} agent${agents === 1 ? '' : 's'}`]),
    ...(stats.total === 0 ? [] : [`${stats.done}/${stats.total}`]),
  ]

  return { tone: 'work', text: parts.join(' · ') }
}

// The next step as the strip shows it, in full and as its first move.
export const nextStepOf = (flow: Flow | null): { text: string; short?: string } | undefined => {
  if (flow === null) return undefined
  const text = `next: ${flow.next}`

  return flow.first === flow.next ? { text } : { text, short: `next: ${flow.first}` }
}
