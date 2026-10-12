// The two things that call for the person's attention: a usage limit on course
// to run out before it resets, and Claude waiting on them.
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  about,
  addWait,
  asTracks,
  forecastLimit,
  forecastText,
  forecastsOf,
  limitAlert,
  limitToast,
  mergeTracks,
  recordLimit,
  sessionState,
  topWait,
  waitMark,
} from '../hooks/logic'
import type { LimitTrack, RateLimit, Wait } from '../types'

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const T0 = Date.parse('2026-10-12T09:00:00Z')
const iso = (at: number): string => new Date(at).toISOString()

const limit = (percentUsed: number, resetsAt?: number, kind = 'five_hour'): RateLimit => ({
  kind,
  percentUsed,
  ...(resetsAt === undefined ? {} : { resetsAt: iso(resetsAt) }),
})

// Readings as [minutes after T0, percent used].
const track = (
  samples: readonly (readonly [number, number])[],
  resetsAt?: number,
  kind = 'five_hour',
): LimitTrack => ({
  kind,
  samples: samples.map(([minutes, percent]) => ({ at: T0 + minutes * MINUTE, percent })),
  hasWarned: false,
  ...(resetsAt === undefined ? {} : { resetsAt: iso(resetsAt) }),
})

test('a window burning faster than it resets is forecast to run out early', () => {
  // 40% to 52% in twenty minutes is 36 points an hour: the other 48 points
  // last eighty minutes, and the window resets in a hundred and sixty.
  const reset = T0 + 3 * HOUR
  const now = T0 + 20 * MINUTE
  const readings = track([[0, 40], [20, 52]], reset)
  const forecast = forecastLimit(limit(52, reset), readings, now)
  expect(forecast).toEqual({
    kind: 'five_hour',
    percentUsed: 52,
    resetsAt: reset,
    perHour: 36,
    exhaustsAt: T0 + 100 * MINUTE,
    outlook: 'short',
  })
  expect(forecastText(forecast, now)).toBe('full in about 1h20m at 36%/h, 1h20m before it resets')
  expect(limitAlert([forecast], now)).toBe('⚠ 5h limit out in 1h20m')
  expect(limitToast(forecast, now)).toBe(
    'The five-hour limit is on course to run out in about 1h20m, 1h20m before it resets',
  )

  // The same pace against a reset that comes first is no cause for alarm.
  const sooner = T0 + 90 * MINUTE
  const lasting = forecastLimit(limit(52, sooner), track([[0, 40], [20, 52]], sooner), now)
  expect(lasting.outlook).toBe('lasting')
  expect(forecastText(lasting, now)).toBe('at 36%/h it lasts until the reset')
  expect(limitAlert([lasting], now)).toBeUndefined()
})

test('a forecast claims no more than its readings support', () => {
  const reset = T0 + 3 * HOUR
  // One reading, or readings minutes apart, tell no pace.
  expect(forecastLimit(limit(40, reset), track([[0, 40]], reset), T0).outlook).toBe('learning')
  expect(forecastLimit(limit(40, reset), undefined, T0).outlook).toBe('learning')
  const hasty = forecastLimit(limit(43, reset), track([[0, 40], [5, 43]], reset), T0 + 5 * MINUTE)
  expect(hasty.outlook).toBe('learning')
  expect(hasty.exhaustsAt).toBeNull()
  expect(forecastText(hasty, T0)).toBe('pace not known yet: it takes a few readings')

  // With no reset time there is a time it fills, and nothing to hold it to.
  const open = forecastLimit(limit(52), track([[0, 40], [20, 52]]), T0 + 20 * MINUTE)
  expect(open.outlook).toBe('open')
  expect(forecastText(open, T0 + 20 * MINUTE)).toBe('full in about 1h20m at 36%/h · no reset time reported')
  expect(limitAlert([open], T0 + 20 * MINUTE)).toBeUndefined()

  // Readings of a window whose reset has passed say nothing of the next one.
  const stale = forecastLimit(limit(52, reset), track([[0, 40], [20, 52]], reset), reset + MINUTE)
  expect(stale.outlook).toBe('learning')
})

test('the pace is the last half hour of a five-hour window, and a pause ends it', () => {
  const reset = T0 + 5 * HOUR
  // Ten points in the first hour, ten more in the next twenty minutes: the
  // half hour that ends now began at 20% and gained ten.
  const readings = track([[0, 10], [60, 20], [80, 30]], reset)
  const now = T0 + 90 * MINUTE
  const forecast = forecastLimit(limit(30, reset), readings, now)
  expect(forecast.perHour).toBe(20)
  expect(forecast.exhaustsAt).toBe(now + 3.5 * HOUR)
  expect(forecast.outlook).toBe('lasting')

  // Two hours on with no rise, nothing is on course to run out.
  const later = forecastLimit(limit(30, reset), readings, T0 + 200 * MINUTE)
  expect(later.outlook).toBe('steady')
  expect(forecastText(later, T0 + 200 * MINUTE)).toBe('no rise lately: not on course to run out')
})

test('a seven-day window is paced by its last day, and a full window says when it resets', () => {
  const reset = T0 + 172 * HOUR
  // An hour of readings is too little to pace a week by.
  const brief = track([[-60, 30], [0, 32]], reset, 'seven_day')
  expect(forecastLimit(limit(32, reset, 'seven_day'), brief, T0).outlook).toBe('learning')

  // Twelve points in the day that ends now is half a point an hour: 68 more
  // take 136 hours, and the window resets a day and a half after that.
  const days = track([[-30 * 60, 20], [-20 * 60, 26], [0, 32]], reset, 'seven_day')
  const week = forecastLimit(limit(32, reset, 'seven_day'), days, T0)
  expect(week.perHour).toBe(0.5)
  expect(week.outlook).toBe('short')
  expect(forecastText(week, T0)).toBe('full in about 5d16h at 0.5%/h, 1d12h before it resets')

  const spent = forecastLimit(limit(100, T0 + 160 * MINUTE), undefined, T0)
  expect(spent.outlook).toBe('spent')
  expect(forecastText(spent, T0)).toBe('limit reached · resets in 2h40m')
  // A full window is named before one that is only on course to fill.
  expect(limitAlert([week, spent], T0)).toBe('⚠ 5h limit reached')
  expect(limitAlert([week], T0)).toBe('⚠ 7d limit out in 5d16h')
  expect(about(30_000)).toBe('1m')
  expect(about(10_000)).toBe('under 1m')
})

test('readings are kept by window: a level once, a new window from the start', () => {
  const reset = T0 + 3 * HOUR
  const first = recordLimit(undefined, limit(40, reset), T0)
  expect(first).toEqual({
    kind: 'five_hour',
    resetsAt: iso(reset),
    samples: [{ at: T0, percent: 40 }],
    hasWarned: false,
  })
  // The same level read again is the level it already holds.
  expect(recordLimit(first, limit(40, reset), T0 + MINUTE).samples).toHaveLength(1)
  const risen = recordLimit({ ...first, hasWarned: true }, limit(41, reset), T0 + 2 * MINUTE)
  expect(risen.samples).toEqual([
    { at: T0, percent: 40 },
    { at: T0 + 2 * MINUTE, percent: 41 },
  ])
  // A warning given stands for the rest of its window, and no longer.
  expect(risen.hasWarned).toBe(true)
  const next = recordLimit(risen, limit(3, reset + 5 * HOUR), reset + MINUTE)
  expect(next.samples).toEqual([{ at: reset + MINUTE, percent: 3 }])
  expect(next.hasWarned).toBe(false)
  expect(next.resetsAt).toBe(iso(reset + 5 * HOUR))

  // Where no reset time says so, a fall in the figure is the new window.
  const bare = recordLimit(recordLimit(undefined, limit(60), T0), limit(61), T0 + MINUTE)
  expect(bare.samples).toHaveLength(2)
  expect(recordLimit(bare, limit(2), T0 + 2 * MINUTE).samples).toEqual([{ at: T0 + 2 * MINUTE, percent: 2 }])

  // Readings older than the lookback go, but for the newest of them.
  const old = track([[0, 10], [10, 12], [50, 14]], reset)
  expect(recordLimit(old, limit(15, reset), T0 + 60 * MINUTE).samples).toEqual([
    { at: T0 + 10 * MINUTE, percent: 12 },
    { at: T0 + 50 * MINUTE, percent: 14 },
    { at: T0 + 60 * MINUTE, percent: 15 },
  ])
})

test('readings kept by another session join the ones held', () => {
  const reset = T0 + 3 * HOUR
  expect(asTracks('nonsense')).toEqual([])
  expect(asTracks([{ kind: 'five_hour' }, null, 7])).toEqual([])
  const kept = asTracks([
    {
      kind: 'five_hour',
      resetsAt: iso(reset),
      samples: [{ at: T0, percent: 40 }, { at: 'soon', percent: 41 }, null],
      hasWarned: true,
      more: 'ignored',
    },
  ])
  expect(kept).toEqual([
    { kind: 'five_hour', resetsAt: iso(reset), samples: [{ at: T0, percent: 40 }], hasWarned: true },
  ])

  // The same window: one line of readings, and the warning counts for both.
  const held = [track([[10, 45], [20, 52]], reset)]
  expect(mergeTracks(held, kept)).toEqual([
    {
      kind: 'five_hour',
      resetsAt: iso(reset),
      samples: [
        { at: T0, percent: 40 },
        { at: T0 + 10 * MINUTE, percent: 45 },
        { at: T0 + 20 * MINUTE, percent: 52 },
      ],
      hasWarned: true,
    },
  ])
  // Another window of the kind: the one read last stands, alone.
  const newer = [track([[400, 2]], reset + 5 * HOUR)]
  expect(mergeTracks(newer, kept)).toEqual(newer)
  expect(mergeTracks(kept, newer)).toEqual(newer)
  expect(mergeTracks([], kept)).toEqual(kept)
  // Each window is forecast from its own readings: seven points in ten
  // minutes fills the five-hour one early, and the week has none yet.
  const both = [limit(52, reset), limit(9, reset, 'seven_day')]
  expect(forecastsOf(both, held, T0 + 20 * MINUTE).map(one => one.outlook)).toEqual(['short', 'learning'])
})

test('what holds work up comes before a turn handed back', () => {
  const turn: Wait = { kind: 'turn', at: 1 }
  const bash: Wait = { kind: 'permission', at: 2, tool: 'Bash', detail: 'npm test' }
  const edit: Wait = { kind: 'permission', at: 3, tool: 'Edit', agentId: 'agent-1' }
  let list = addWait(addWait(addWait([], turn), bash), edit)
  expect(topWait(list)).toEqual(bash)
  expect(waitMark(bash)).toBe('▲ needs you: permission for Bash')
  expect(waitMark(turn)).toBe('◇ your turn')
  expect(waitMark({ kind: 'turn', at: 1, detail: 'stopped on an error' })).toBe('◇ stopped on an error')
  expect(waitMark({ kind: 'question', at: 1, tool: 'AskUserQuestion' })).toBe('▲ needs you: a question for you')
  expect(waitMark({ kind: 'plan', at: 1, tool: 'ExitPlanMode' })).toBe('▲ needs you: a plan to approve')
  expect(waitMark({ kind: 'input', at: 1, detail: 'github' })).toBe('▲ needs you: input for github')

  // The same loop asking again for the same tool is one wait, the later one.
  list = addWait(list, { ...bash, at: 9, detail: 'npm run build' })
  expect(list).toHaveLength(3)
  expect(list.filter(wait => wait.tool === 'Bash')).toEqual([{ ...bash, at: 9, detail: 'npm run build' }])

  expect(sessionState(true, list)).toBe('needs you')
  expect(sessionState(true, [])).toBe('working')
  expect(sessionState(false, [turn])).toBe('your turn')
  expect(sessionState(false, [])).toBe('idle')
  expect(topWait([turn])).toEqual(turn)
  expect(topWait([])).toBeUndefined()
})
