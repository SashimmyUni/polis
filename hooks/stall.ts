// Stalled work: the signs that work has stopped moving, kept as events come
// in, and the rule that reads them at a moment. Whether the work is AFK work
// at all is the attention element's to say (see flow.ts).
import { CHECK_LABEL } from './checks'
import { about } from './logic'
import type { CheckKind, Progress, Stall } from '../types'

// Thresholds are fixed: there is no option for them.
export const SILENT_FOR_MS = 5 * 60_000
export const RUNNING_FOR_MS = 15 * 60_000
export const IN_A_ROW = 3

export const NO_PROGRESS: Progress = { at: 0, inFlight: [], failing: [], calls: [] }

// A call as the same call is told: its tool and its input, less what the
// engine adds to every call.
const ENVELOPE = new Set(['tool', 'tool_use_id', 'agentId', 'requestMeta'])

export const callOf = (e: { tool: string } & Record<string, unknown>): string =>
  JSON.stringify([e.tool, Object.entries(e).filter(([key]) => !ENVELOPE.has(key))])

// A step, a tool call or an agent event: work moved.
export const progressed = (progress: Progress, now: number): Progress => ({ ...progress, at: now })

// Calls that run an agent: in flight for as long as the agent works, which
// shows its own progress, so they are never a call that hangs.
const RUNS_AN_AGENT = new Set(['Agent', 'Task'])

// What a tool call is: its tool_use_id, its tool, the agent making it ('' for
// the main loop) and the call itself (callOf).
export type CallStart = { id: string; tool: string; agentId: string; call: string }

// A tool call began: work moved, the call is in flight until it ends, and the
// agent's row of the same call grows by one or starts anew.
export const callBegan = (progress: Progress, start: CallStart, now: number): Progress => {
  const last = progress.calls.find(one => one.agentId === start.agentId)
  const row =
    last !== undefined && last.call === start.call
      ? { ...last, count: last.count + 1 }
      : { agentId: start.agentId, call: start.call, count: 1, since: now }

  const inFlight = progress.inFlight.filter(call => call.id !== start.id)

  return {
    ...progress,
    at: now,
    inFlight: RUNS_AN_AGENT.has(start.tool) ? inFlight : [...inFlight, { id: start.id, tool: start.tool, at: now }],
    calls: [...progress.calls.filter(one => one.agentId !== start.agentId), row],
  }
}

// An agent ended: work moved, and its calls are over.
export const agentEnded = (progress: Progress, agentId: string, now: number): Progress => ({
  ...progress,
  at: now,
  calls: progress.calls.filter(one => one.agentId !== agentId),
})

// A tool call ended, however it ended: work moved.
export const callEnded = (progress: Progress, id: string, now: number): Progress => ({
  ...progress,
  at: now,
  inFlight: progress.inFlight.filter(call => call.id !== id),
})

// A run of checks ended: a pass ends its kind's run of failures, a failure
// adds one to it.
export const checkRan = (progress: Progress, kinds: readonly CheckKind[], hasPassed: boolean, now: number): Progress => {
  const others = progress.failing.filter(run => !kinds.includes(run.kind))
  if (hasPassed) return { ...progress, failing: others }
  const runs = kinds.map(kind => {
    const run = progress.failing.find(one => one.kind === kind)

    return run === undefined ? { kind, count: 1, since: now } : { ...run, count: run.count + 1 }
  })

  return { ...progress, failing: [...others, ...runs] }
}

// The rule at a moment: why the work is stalled and since when it stopped
// moving, or nothing while it moves. A call in flight is not silence, but
// it hides no failing check or repeated call: those stand until cleared.
export const stallOf = (progress: Progress, now: number): Stall | undefined => {
  const [oldest] = [...progress.inFlight].sort((one, two) => one.at - two.at)
  if (oldest !== undefined && now - oldest.at >= RUNNING_FOR_MS) {
    return { reason: 'running', why: `${oldest.tool} running ${about(now - oldest.at)}`, since: oldest.at }
  }
  const [failing] = progress.failing.filter(run => run.count >= IN_A_ROW).sort((one, two) => one.since - two.since)
  if (failing !== undefined) {
    return { reason: 'failing', why: `${CHECK_LABEL[failing.kind]} failed ${failing.count}×`, since: failing.since }
  }
  const [repeating] = progress.calls.filter(row => row.count >= IN_A_ROW).sort((one, two) => one.since - two.since)
  if (repeating !== undefined) return { reason: 'repeating', why: `same call ${repeating.count}×`, since: repeating.since }
  if (oldest === undefined && now - progress.at >= SILENT_FOR_MS) return { reason: 'silent', why: 'no progress', since: progress.at }

  return undefined
}
