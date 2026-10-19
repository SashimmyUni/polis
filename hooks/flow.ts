// The flow: the phase of the work, read from the flow skills Claude invokes,
// with its kind (HITL work keeps the person close, AFK work runs without
// them) and the next step the flow calls for. Then the attention element: the
// strip's first element, what the person should know before anything else.
import { isBlocking, isLive, taskStats, topWait, waitMark } from './logic'
import type { AgentRun, Flow, FlowKind, Task, Turn, Wait } from '../types'

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

// Off the flow, a turn this long with nothing asked is work the person can leave.
export const AFK_AFTER_MS = 2 * 60_000

// What the attention element is made from.
export type AttentionInput = {
  now: number
  waits: readonly Wait[]
  turn: Pick<Turn, 'isWorking' | 'startedAt'>
  agents: readonly AgentRun[]
  tasks: readonly Task[]
  flow: Flow | null
}

// The kind of the work running now: the phase's while Claude works, else AFK
// while an agent runs or the turn has gone two minutes; nothing while idle.
export const workKind = (m: AttentionInput): FlowKind | undefined => {
  if (!m.turn.isWorking) return undefined
  if (m.flow !== null) return m.flow.kind
  const isLong = m.now - m.turn.startedAt >= AFK_AFTER_MS

  return m.agents.some(isLive) || isLong ? 'AFK' : undefined
}

// The strip's first element, chosen in its order: needs you, then HITL work,
// then AFK work; nothing while idle. Later kinds (stalled work, other
// sessions' needs) join this one choice. `needs` never drops off a narrow strip.
export type Attention = { tone: 'needs' | 'work'; text: string }

export const attentionOf = (m: AttentionInput): Attention | undefined => {
  const top = topWait(m.waits)
  if (top !== undefined && isBlocking(top)) return { tone: 'needs', text: waitMark(top) }
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
