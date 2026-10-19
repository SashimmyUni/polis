// The wayfinder frontier: the open maps of the project's GitHub issues and,
// for each, the tickets that can be taken next and those already taken, read
// through `gh`. Polis only reads the tracker; it never claims or closes.
import type { FrontierMap, TicketMark, Tracker } from '../types'

/** A read waits this long after the last try, failed or not. */
export const TRACKER_EVERY = 5 * 60_000

/** Each `gh` call gets this long. */
export const GH_TIMEOUT = 10_000

export const MAPS_ARGV = [
  'gh',
  'issue',
  'list',
  '--label',
  'wayfinder:map',
  '--state',
  'open',
  '--json',
  'number,title',
  '--limit',
  '50',
] as const

// The sub-issues cut down to what the view needs: `gh` fills `{owner}/{repo}`
// from the repository the command runs in.
const TICKETS_JQ =
  '[.[] | {number, title, state, labels: [.labels[].name], assignees: [.assignees[].login], blockedBy: .issue_dependencies_summary.blocked_by}]'

export const ticketsArgv = (map: number): string[] => [
  'gh',
  'api',
  `repos/{owner}/{repo}/issues/${map}/sub_issues?per_page=100`,
  '--jq',
  TICKETS_JQ,
]

type Ticket = {
  number: number
  title: string
  state: string
  labels: string[]
  assignees: string[]
  blockedBy: number
}

const parse = (stdout: string): unknown[] | null => {
  try {
    const value: unknown = JSON.parse(stdout)

    return Array.isArray(value) ? value : null
  } catch {
    return null
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((one): one is string => typeof one === 'string') : []

/** The open maps `gh issue list` printed, or null when it printed something else. */
export const parseMaps = (stdout: string): { number: number; title: string }[] | null => {
  const list = parse(stdout)
  if (list === null) return null

  return list.flatMap(one =>
    isObject(one) && typeof one.number === 'number' && typeof one.title === 'string'
      ? [{ number: one.number, title: one.title }]
      : [],
  )
}

/** A map's sub-issues as the `--jq` filter printed them, or null. */
export const parseTickets = (stdout: string): Ticket[] | null => {
  const list = parse(stdout)
  if (list === null) return null

  return list.flatMap(one =>
    isObject(one) && typeof one.number === 'number' && typeof one.title === 'string'
      ? [
          {
            number: one.number,
            title: one.title,
            state: typeof one.state === 'string' ? one.state : 'open',
            labels: strings(one.labels),
            assignees: strings(one.assignees),
            blockedBy: typeof one.blockedBy === 'number' ? one.blockedBy : 0,
          },
        ]
      : [],
  )
}

/** HITL for the tickets that wait on the person, AFK for research, none for a task. */
export const markOf = (labels: readonly string[]): TicketMark => {
  if (labels.includes('wayfinder:grilling') || labels.includes('wayfinder:prototype')) return 'HITL'
  if (labels.includes('wayfinder:research')) return 'AFK'

  return null
}

/** A map's frontier and its claimed tickets, from its sub-issues. */
export const frontierOf = (map: { number: number; title: string }, tickets: readonly Ticket[]): FrontierMap => {
  const open = tickets.filter(one => one.state === 'open')

  return {
    number: map.number,
    name: map.title.replace(/^map:\s*/i, ''),
    open: open
      .filter(one => one.assignees.length === 0 && one.blockedBy === 0)
      .map(one => ({ number: one.number, title: one.title, mark: markOf(one.labels) })),
    claimed: open
      .filter(one => one.assignees.length > 0)
      .map(one => ({ number: one.number, title: one.title, assignees: one.assignees })),
  }
}

/** The HITL tickets waiting for the person across the maps. */
export const hitlWaiting = (maps: readonly FrontierMap[]): number =>
  maps.reduce((sum, map) => sum + map.open.filter(one => one.mark === 'HITL').length, 0)

/** Whether a read is due: never read, or the last try five minutes back. */
export const isDue = (tracker: Tracker | null, now: number): boolean =>
  tracker === null || now - tracker.triedAt >= TRACKER_EVERY

/** A tracker as the store kept it, or null when it holds none. */
export const asTracker = (value: unknown): Tracker | null => {
  if (!isObject(value) || !Array.isArray(value.maps)) return null
  const { at, triedAt, isFailed } = value
  if (typeof at !== 'number' || typeof triedAt !== 'number') return null

  return { at, triedAt, isFailed: isFailed === true, maps: value.maps as FrontierMap[] }
}

type Run = (argv: readonly string[]) => Promise<{ exitCode: number; stdout: string }>

/**
 * One read of the tracker: the open maps, then each map's tickets. Any
 * failure (no `gh`, not signed in, no GitHub remote, a timeout, output that
 * is not what was asked) keeps the last read, marked failed; with none, the
 * tracker stays empty.
 */
export const readTracker = async (run: Run, last: Tracker | null, now: number): Promise<Tracker> => {
  const failed: Tracker = { at: last?.at ?? now, triedAt: now, isFailed: last !== null, maps: last?.maps ?? [] }
  try {
    const listed = await run(MAPS_ARGV)
    const maps = listed.exitCode === 0 ? parseMaps(listed.stdout) : null
    if (maps === null) return failed
    const read: FrontierMap[] = []
    for (const map of maps) {
      const answered = await run(ticketsArgv(map.number))
      const tickets = answered.exitCode === 0 ? parseTickets(answered.stdout) : null
      if (tickets === null) return failed
      read.push(frontierOf(map, tickets))
    }

    return { at: now, triedAt: now, isFailed: false, maps: read }
  } catch {
    return failed
  }
}
