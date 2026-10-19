// Live sessions: every running session of a project keeps one record under
// its own key, and reads the others'. The store is shared by every running
// session of the mod: a value one sets, another gets on its next read
// (checked with two concurrent sessions).
import type { AgentRun, Flow, FlowKind, LiveSession, Task, Usage, Wait } from '../types'
import { clip, isLive, sessionState, taskStats, topNeed, waitText } from './logic'

// The part of the engine's store the records need. The seam where a store of
// files would go in its place.
export type LiveStore = {
  get: (key: string) => Promise<unknown>
  set: (key: string, value: unknown) => Promise<void>
  delete: (key: string) => Promise<void>
  keys: () => Promise<string[]>
}

// A record older than this is a session that ended without saying so.
export const SILENT_MS = 120_000
// A changed record is written no more often than this; an unchanged one this
// often, so that the others know it is still there.
export const CHANGE_MS = 2000
export const HEARTBEAT_MS = 30_000

const prefixOf =(root: string): string => `live:${root}:`

// A session's own key: no two sessions share one.
export const liveKey = (root: string, sessionId: string): string => `${prefixOf(root)}${sessionId}`

const asLive = (value: unknown): LiveSession | undefined => {
  const record = value as Partial<LiveSession> | null
  if (typeof record !== 'object' || record === null) return undefined
  if (typeof record.sessionId !== 'string' || typeof record.updatedAt !== 'number') return undefined

  return record as LiveSession
}

// What a session last wrote: under which key, what (less the time), and when.
type Written = { key: string; body: string; at: number }

// One session's side of the records: its own, written on change and as a
// heartbeat, and the others', read.
export type LiveKeeper = ReturnType<typeof liveKeeper>

export const liveKeeper = (store: LiveStore) => {
  let last: Written | undefined

  return {
    // Writes the session's record when it changed and the last write is
    // CHANGE_MS old, or when the heartbeat is due; says whether it wrote.
    write: async (record: LiveSession, now: number): Promise<boolean> => {
      const key = liveKey(record.root, record.sessionId)
      const body = JSON.stringify({ ...record, updatedAt: 0 })
      if (last !== undefined && last.key === key) {
        const since = now - last.at
        if (since < (body === last.body ? HEARTBEAT_MS : CHANGE_MS)) return false
      }
      await store.set(key, { ...record, updatedAt: now })
      last = { key, body, at: now }

      return true
    },

    // The other live sessions of the project. A record silent for longer than
    // a session's heartbeat allows is one whose session died: it goes.
    others: async (root: string, sessionId: string, now: number): Promise<LiveSession[]> => {
      const own = liveKey(root, sessionId)
      const found: LiveSession[] = []
      for (const key of await store.keys()) {
        if (!key.startsWith(prefixOf(root)) || key === own) continue
        const record = asLive(await store.get(key))
        if (record === undefined) continue
        if (now - record.updatedAt > SILENT_MS) await store.delete(key)
        else found.push(record)
      }

      return found
    },

    end: async (root: string, sessionId: string): Promise<void> => {
      if (last?.key === liveKey(root, sessionId)) last = undefined
      await store.delete(liveKey(root, sessionId))
    },
  }
}

// The other sessions waiting on the person, the one waiting longest first.
const waitingOn = (others: readonly LiveSession[]): (LiveSession & { wait: { text: string; at: number } })[] =>
  others
    .filter((one): one is LiveSession & { wait: { text: string; at: number } } =>
      one.state === 'needs you' && one.wait !== null,
    )
    .sort((one, two) => one.wait.at - two.wait.at)

const elsewhere = (count: number): string =>
  count === 1 ? ' · +1 in another session' : count > 1 ? ` · +${count} in other sessions` : ''

// Needs you as the strip shows it: what this session waits on the person for,
// and how many other sessions do too; or, when only others do, the one
// waiting longest by name. Nothing when no session needs the person.
export const needsYouMark = (own: string | undefined, others: readonly LiveSession[]): string | undefined => {
  const waiting = waitingOn(others)
  if (own !== undefined) return `▲ needs you: ${own}${elsewhere(waiting.length)}`
  const [first, ...rest] = waiting
  if (first === undefined) return undefined
  const where = first.title === '' ? 'another session' : `"${clip(first.title, 40)}"`

  return `▲ needs you in ${where}: ${first.wait.text}${elsewhere(rest.length)}`
}

// What a session's own record is made from.
export type LiveParts = {
  sessionId: string
  root: string
  title: string
  isWorking: boolean
  waits: readonly Wait[]
  tasks: readonly Task[]
  agents: readonly AgentRun[]
  usage: Pick<Usage, 'contextTokens' | 'zoneLimit' | 'costUsd'>
  tokens: number
  /** The flow as the last flow skill set it; null off the flow. */
  flow: Flow | null
  /** The kind of the work running now, as live signals give it off the flow. */
  workKind?: FlowKind
  /** Why the session's work is stalled, in words; empty or left out while it is not. */
  stall?: string
  now: number
}

// This session's record as the others read it. Phase, kind and next step
// come from the flow; off it, phase and next step are empty and the kind is
// what live signals give.
export const liveSessionOf = (parts: LiveParts): LiveSession => {
  const need = topNeed(parts.waits)
  const stats = taskStats(parts.tasks)

  return {
    sessionId: parts.sessionId,
    root: parts.root,
    title: parts.title,
    state: sessionState(parts.isWorking, parts.waits),
    wait: need === undefined ? null : { text: waitText(need), at: need.at },
    phase: parts.flow?.phase ?? '',
    kind: parts.flow?.kind ?? parts.workKind ?? '',
    nextStep: parts.flow?.next ?? '',
    task: parts.tasks.find(task => task.status === 'in_progress')?.subject ?? '',
    agents: parts.agents.filter(isLive).length,
    tasksDone: stats.done,
    tasksTotal: stats.total,
    contextTokens: parts.usage.contextTokens,
    zoneLimit: parts.usage.zoneLimit,
    tokens: parts.tokens,
    costUsd: parts.usage.costUsd,
    stall: parts.stall ?? '',
    updatedAt: parts.now,
  }
}
