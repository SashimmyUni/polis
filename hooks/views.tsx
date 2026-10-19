import type { Elements, RenderElement } from 'claude-code'

import type {
  Activity,
  AgentRun,
  Archive,
  Check,
  FamilyCounts,
  FileHit,
  GitState,
  LimitTrack,
  LiveSession,
  Proc,
  Project,
  ProjectLog,
  Range,
  SessionRecord,
  Skills,
  Task,
  ToolFamily,
  Turn,
  TurnRecord,
  Ui,
  Usage,
  ViewName,
  Wait,
  ZoneLevel,
} from '../types'
import { CHECK_KINDS, checkLines, checksLine, stateOf } from './checks'
import type { CheckState } from './checks'
import { cityAlt, layoutFor, quartersOf, renderCity } from './city'
import { areasOfFiles, gitLine } from './codemap'
import { avatarAlt, avatarSvg } from './icons'
import {
  SIZE_LABEL,
  agentTree,
  bar,
  clip,
  compact,
  districtsOf,
  elapsed,
  forecastText,
  forecastsOf,
  gaugeOf,
  hotFiles,
  isBlocked,
  isBlocking,
  isLive,
  limitAlert,
  limitName,
  openBlockers,
  progressOf,
  sessionState,
  shortPath,
  sizeStats,
  taskStats,
  taskTree,
  topFamilies,
  topWait,
  waitMark,
  waitText,
  zoneOf,
} from './logic'
import type { LimitForecast } from './logic'
import { needsYouMark } from './live'
import { projectHeadline, projectLines } from './projectlog'
import { C, FAMILY_COLOR, FAMILY_GLYPH, FAMILY_LABEL, VIEWS, lookOf } from './theme'
import { STANDING, standingOf, standings, verdictNote } from './verify'

export type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type SvgEl = Elements['desktop']['Svg']

export type Model = {
  now: number
  columns: number
  /** The shape of the room the city is drawn into, width over height, where known. */
  aspect: number | undefined
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
  /** The readings of each limit window, for its pace and forecast. */
  limits: LimitTrack[]
  /** What Claude is waiting on the person for. */
  waits: Wait[]
  /** The last run of each kind of check. */
  checks: Check[]
  git: GitState | null
  /** Every session of the project, this one among them. */
  log: ProjectLog | null
  /** This session's id: the live one in the log. Empty until it is known. */
  sessionId: string
  /** The repository root, else the working directory. Empty until it is known. */
  root: string
  /** True when the person turned the city's motion off. */
  isStill: boolean
  /** The project's archive less what is on the board: what the full city adds. */
  archived: Archive | null
  /** The next step the flow calls for, in full and as its first move. Nothing sets it yet. */
  nextStep?: { text: string; short: string }
  /** The project's other live sessions. */
  others?: LiveSession[]
}

export type Actions = {
  setView: (view: ViewName) => void
  toggleCity: () => void
  openCity: () => void
  hideBand: () => void
  orchestrate: () => void
  clearFinished: () => void
  stopTurn: () => void
}


const clamp = (value: number, low: number, high: number): number =>
  Math.max(low, Math.min(high, value))

const TASK_MARK = {
  completed: { glyph: '✔', color: C.done },
  in_progress: { glyph: '▶', color: C.run },
  pending: { glyph: '○', color: C.muted },
} as const

const RUN_MARK = {
  starting: { glyph: '◌', color: C.muted },
  running: { glyph: '●', color: C.run },
  done: { glyph: '✔', color: C.done },
  failed: { glyph: '✘', color: C.fail },
} as const

const STATE_COLOR = { under: C.done, within: C.run, over: C.fail } as const

// The context reading: quiet in the smart zone, amber at the caution, red past the limit.
const ZONE_COLOR: Record<ZoneLevel, string> = { inside: C.muted, caution: C.run, out: C.fail }

const CHECK_COLOR = { passed: C.done, failed: C.fail, stale: C.run } as const

// Done and checked, done on Claude's word alone, and done but refuted.
const STANDING_COLOR = { open: C.muted, unchecked: C.muted, verified: C.done, refuted: C.fail } as const

// Under this many columns a row cannot hold a label, a bar and a figure side
// by side. The desktop app docks the pane about twenty wide when the
// conversation shares its window with other panes.
const NARROW = 44

const isNarrow = (m: Model): boolean => m.columns < NARROW

// Long text wraps where the pane is narrow and is cut where it is wide.
const fit = (m: Model): 'wrap' | 'truncate-end' => (isNarrow(m) ? 'wrap' : 'truncate-end')

// How a bar is drawn in this pane: beside its label, or under it.
type Room = { bar: number; isStacked: boolean }

const roomOf = (m: Model): Room =>
  isNarrow(m)
    ? { bar: clamp(m.columns - 1, 6, 40), isStacked: true }
    : { bar: clamp(m.columns - 40, 8, 28), isStacked: false }

const heading = (el: El, m: Model, text: string, note = ''): RenderElement => {
  const { Box, Text } = el

  return (
    <Box flexDirection={isNarrow(m) ? 'column' : 'row'} gap={isNarrow(m) ? 0 : 1} marginTop={1}>
      <Text color={C.agent} bold>
        {text}
      </Text>
      {note !== '' && (
        <Text color={C.muted} wrap="wrap">
          {note}
        </Text>
      )}
    </Box>
  )
}

const empty = (el: El, text: string): RenderElement => {
  const { Text } = el

  return <Text color={C.muted}>{text}</Text>
}

const meter = (
  el: El,
  label: string,
  share: number,
  color: string,
  room: Room,
  note: string,
): RenderElement => {
  const { Box, Text } = el
  const [full, rest] = bar(Math.min(1, share), 1, room.bar)
  if (room.isStacked) {
    return (
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={C.muted}>{label}</Text>
          <Text color={C.text} wrap="wrap">
            {note}
          </Text>
        </Box>
        <Box flexDirection="row">
          <Text color={color}>{full}</Text>
          <Text color={C.faint}>{rest}</Text>
        </Box>
      </Box>
    )
  }

  return (
    <Box flexDirection="row" gap={1}>
      <Text color={C.muted}>{label.padEnd(8)}</Text>
      <Text color={color}>{full}</Text>
      <Text color={C.faint}>{rest}</Text>
      <Text color={C.text} wrap="truncate-end">
        {note}
      </Text>
    </Box>
  )
}

const gauge = (
  el: El,
  label: string,
  actual: number,
  range: Range,
  show: (value: number) => string,
  room: Room,
): RenderElement => {
  const { share, state } = gaugeOf(actual, range)

  return meter(
    el,
    label,
    share,
    STATE_COLOR[state],
    room,
    `${show(actual)} of ${show(range.low)}–${show(range.high)}`,
  )
}

// A short label and what it stands for, laid out as the bars are: beside one
// another, or the text under its label where the pane is narrow.
const labelled = (
  el: El,
  m: Model,
  label: string,
  text: string,
  color: string = C.text,
): RenderElement => {
  const { Box, Text } = el

  return (
    <Box flexDirection={isNarrow(m) ? 'column' : 'row'} gap={isNarrow(m) ? 0 : 1}>
      <Text color={C.muted}>{isNarrow(m) ? label : label.padEnd(8)}</Text>
      <Text color={color} wrap={fit(m)}>
        {text}
      </Text>
    </Box>
  )
}

// The wait that holds work up until the person acts, if there is one.
const blockerOf = (m: Pick<Model, 'waits'>): Wait | undefined => {
  const top = topWait(m.waits)

  return top !== undefined && isBlocking(top) ? top : undefined
}

// The agent a wait was raised by, in a few words; nothing for the main loop.
const askerOf = (m: Model, wait: Wait): string => {
  if (wait.agentId === undefined) return ''
  const run = m.agents.find(one => one.agentId === wait.agentId)

  return run === undefined ? 'asked by an agent' : `asked by ${clip(run.name ?? run.label, 24)}`
}

// permission for Bash · asked by writer · waiting 2m05s
const waitLine = (m: Model, wait: Wait): string =>
  [waitText(wait), askerOf(m, wait), `waiting ${elapsed(m.now - wait.at)}`]
    .filter(part => part !== '')
    .join(' · ')

// 2 verified · 1 not checked · 1 failed its check: only what there is some of.
const standingText = (tasks: readonly Task[]): string => {
  const { verified, unchecked, refuted } = standings(tasks)

  return [
    verified > 0 ? `${verified} verified` : '',
    unchecked > 0 ? `${unchecked} not checked` : '',
    refuted > 0 ? `${refuted} failed ${refuted === 1 ? 'its check' : 'their checks'}` : '',
  ]
    .filter(part => part !== '')
    .join(' · ')
}

const forecastsFor = (m: Pick<Model, 'usage' | 'limits' | 'now'>): LimitForecast[] =>
  forecastsOf(m.usage.rateLimits, m.limits, m.now)

const isShort = (forecast: LimitForecast): boolean =>
  forecast.outlook === 'short' || forecast.outlook === 'spent'

// The checks that have run, in the order they are shown in.
const checksRun = (m: Model): Check[] =>
  CHECK_KINDS.flatMap(kind => m.checks.filter(check => check.kind === kind).slice(0, 1))

// The checks taken as one: the worst of them.
const checksWorst = (checks: readonly Check[]): CheckState => {
  const states = checks.map(stateOf)

  return states.includes('failed') ? 'failed' : states.includes('stale') ? 'stale' : 'passed'
}

const checksColor = (checks: readonly Check[]): string => CHECK_COLOR[checksWorst(checks)]

// The log's record of this session, once one is written.
const liveRecord = (m: Model): SessionRecord | undefined =>
  m.sessionId === '' ? undefined : m.log?.sessions.find(session => session.id === m.sessionId)

// The sessions of the log other than the live one.
const earlierLog = (m: Model): ProjectLog => ({
  root: m.log?.root ?? m.root,
  sessions: (m.log?.sessions ?? []).filter(session => session.id !== m.sessionId),
})

// The log's lines, drawn: a session stands out from the agents under it, and
// the live one from the rest. The lines come cut to the pane's width.
const logLines = (el: El, m: Model, log: ProjectLog, maxSessions: number): RenderElement[] => {
  const { Text } = el
  const lines = projectLines(log, {
    now: m.now,
    liveId: m.sessionId,
    columns: m.columns,
    maxSessions,
  })

  return lines.map(line => {
    const isLiveSession = line.startsWith('●')
    const isSession = isLiveSession || line.startsWith('○')

    return (
      <Text
        color={isLiveSession ? C.text : isSession ? C.muted : C.faint}
        bold={isLiveSession}
        wrap="truncate-end"
      >
        {line}
      </Text>
    )
  })
}

const equipment = (el: El, families: FamilyCounts, limit: number): RenderElement[] => {
  const { Text } = el

  return topFamilies(families, limit).map((family: ToolFamily) => (
    <Text color={FAMILY_COLOR[family]}>{FAMILY_GLYPH[family]}</Text>
  ))
}

const turnTime = (m: Model): number =>
  m.turn.isWorking ? m.now - m.turn.startedAt : m.turn.endedAt - m.turn.startedAt

const promptBlock = (el: El, m: Model, room: Room): RenderElement[] => {
  const { Box, Text } = el
  const { turn } = m
  const { expected } = turn
  if (expected === null) {
    return [heading(el, m, 'THIS PROMPT'), empty(el, 'No prompt yet this session.')]
  }
  const basis =
    expected.samples >= 5 ? `${expected.samples} past turns` : 'starting defaults'

  return [
    heading(
      el,
      m,
      turn.isWorking ? 'THIS PROMPT' : 'LAST PROMPT',
      `${SIZE_LABEL[expected.size]} · sized by ${expected.source} · range from ${basis}`,
    ),
    gauge(el, 'tokens', turn.tokens, expected.tokens, compact, room),
    gauge(el, 'time', turnTime(m), expected.ms, elapsed, room),
    gauge(el, 'tools', turn.tools, expected.tools, String, room),
    <Box flexDirection="row" gap={1}>
      <Text color={C.muted} wrap="wrap">
        {turn.steps} requests · {compact(turn.outTokens)} written · {compact(turn.cacheRead)}{' '}
        from cache · {turn.agents} agent{turn.agents === 1 ? '' : 's'}
      </Text>
    </Box>,
  ]
}

// ---------------------------------------------------------------------- strip

// One element of the strip the band, City's top strip and the status line all
// show. Of what does not fit a width, the elements with the highest `rank` go
// first: cut to their `short` form where they have one, and left out where
// that is not enough. Rank 0 is never left out.
export type StripElement = { text: string; color: string; rank: number; isBold?: boolean; short?: string }

// The part of the model the strip is made from: all the status line reads.
export type StripModel = Pick<Model, 'now' | 'waits' | 'limits' | 'usage' | 'tasks' | 'nextStep' | 'others'>

// The strip, in its one order: what needs the person, the limit warning while
// it fires, the next step where one is known, the smart zone and tasks done.
// Empty where there is nothing to say.
export const stripElements = (m: StripModel): StripElement[] => {
  const blocker = blockerOf(m)
  const alert = limitAlert(forecastsFor(m), m.now)
  const context = m.usage.contextTokens
  const zone = zoneOf(context, m.usage.zoneLimit)
  const stats = taskStats(m.tasks)
  const strip: StripElement[] = []
  // Other live sessions are counted beside this one's wait, or named alone.
  const needs = needsYouMark(blocker === undefined ? undefined : waitText(blocker), m.others ?? [])
  if (needs !== undefined) strip.push({ text: needs, color: C.fail, rank: 0, isBold: true })
  if (alert !== undefined) strip.push({ text: alert, color: C.fail, rank: 1 })
  if (m.nextStep !== undefined) {
    strip.push({ text: m.nextStep.text, color: C.text, rank: 2, short: m.nextStep.short })
  }
  if (context > 0) {
    const reading = `ctx ${compact(context)}`
    strip.push(
      zone === 'out'
        ? { text: `${reading} · out of the smart zone`, color: ZONE_COLOR[zone], rank: 3, short: reading }
        : { text: reading, color: ZONE_COLOR[zone], rank: 3 },
    )
  }
  if (stats.total > 0) strip.push({ text: `${stats.done}/${stats.total} tasks`, color: C.muted, rank: 4 })

  return strip
}

// ---------------------------------------------------------------------- band

// The cells the band's two buttons take, with the gaps before them.
const BAND_BUTTONS = 16

// The elements that fit one row of the width, in the order they were given.
// Needs you (rank 0) is never left out: it is cut where even it alone is too
// wide.
const fitStrip = (strip: readonly StripElement[], columns: number): StripElement[] => {
  let kept = [...strip]
  const width = (): number => kept.reduce((sum, element) => sum + element.text.length + 1, BAND_BUTTONS)
  while (kept.length > 0 && width() > columns) {
    const last = Math.max(...kept.map(element => element.rank))
    if (kept.some(element => element.rank === last && element.short !== undefined)) {
      kept = kept.map(({ short, ...element }) =>
        element.rank === last && short !== undefined ? { ...element, text: short } : { ...element, short },
      )
    } else if (last === 0) {
      break
    } else {
      kept = kept.filter(element => element.rank !== last)
    }
  }

  return kept
}

// One element of the strip as text: cut at the edge on the band, wrapped in
// City's strip.
const stripText = (el: El, element: StripElement, wrap: 'truncate-end' | 'wrap'): RenderElement => {
  const { Text } = el

  return (
    <Text color={element.color} bold={element.isBold === true} wrap={wrap}>
      {element.text}
    </Text>
  )
}

// The strip on one row that never wraps, then City and Hide.
export const band = (el: El, m: Model, a: Actions): RenderElement => {
  const { Box, Button } = el

  return (
    <Box flexDirection="row" gap={1}>
      {fitStrip(stripElements(m), m.columns).map(element => stripText(el, element, 'truncate-end'))}
      <Button key="city" label="City" variant="primary" onPress={a.openCity} />
      <Button key="hide" label="Hide" dimColor onPress={a.hideBand} />
    </Box>
  )
}

// --------------------------------------------------------------------- views

// What holds work up until the person acts: what it is, what for, how long.
const needsYou = (el: El, m: Model, blocking: readonly Wait[]): RenderElement[] => {
  const { Box, Text } = el

  return blocking.slice(0, 3).map((wait, index) => (
    <Box flexDirection="column" marginTop={index === 0 ? 1 : 0}>
      <Box flexDirection={isNarrow(m) ? 'column' : 'row'} gap={isNarrow(m) ? 0 : 1}>
        <Text color={C.fail} bold>
          ▲ NEEDS YOU
        </Text>
        <Text color={C.fail} wrap={fit(m)}>
          {waitLine(m, wait)}
        </Text>
      </Box>
      {/* A connector's name is in the line above already. */}
      {wait.detail !== undefined && wait.kind !== 'input' && (
        <Box marginLeft={2}>
          <Text color={C.muted} wrap={fit(m)}>
            {wait.detail}
          </Text>
        </Box>
      )}
    </Box>
  ))
}

// Whose figure is whose: the whole project's from its log, beside this
// session's own.
const scopes = (el: El, m: Model): RenderElement[] => {
  const { project, log, usage } = m
  const record = liveRecord(m)
  const whole =
    log !== null && log.sessions.length > 0
      ? projectHeadline(log)
      : project === null
        ? ''
        : `${project.sessions} session${project.sessions === 1 ? '' : 's'} · ${project.turns} turns · ${compact(project.tokens)} tokens so far`
  const mine = [
    record === undefined ? '' : `${record.turns} turn${record.turns === 1 ? '' : 's'}`,
    `${m.agents.length} agent${m.agents.length === 1 ? '' : 's'}`,
    `${compact(usage.sessionTokens)} tokens`,
    `$${usage.costUsd.toFixed(2)}`,
  ]
    .filter(part => part !== '')
    .join(' · ')

  return [
    ...(whole === '' ? [] : [labelled(el, m, 'project', whole, C.muted)]),
    labelled(el, m, 'session', mine, C.muted),
  ]
}

const overview = (el: El, m: Model, a: Actions): RenderElement[] => {
  const { Box, Text, Button } = el
  const room = roomOf(m)
  const stats = taskStats(m.tasks)
  const progress = progressOf(m.project, m.tasks)
  const milestones = m.project?.milestones ?? []
  const live = m.agents.filter(isLive)
  const running = m.procs.filter(proc => proc.status === 'running')
  const active = m.tasks.filter(task => task.status === 'in_progress')
  const MARK = { done: TASK_MARK.completed, active: TASK_MARK.in_progress, planned: TASK_MARK.pending }
  const blocking = m.waits.filter(isBlocking)
  const checked = standingText(m.tasks)
  const ran = checksRun(m)
  const areas = m.root === '' ? [] : areasOfFiles(m.files, m.root)

  return [
    ...needsYou(el, m, blocking),

    heading(el, m, 'PROJECT'),
    ...scopes(el, m),
    meter(el, 'progress', progress.percent / 100, C.done, room, `${progress.percent}% · ${progress.done}/${progress.total} ${progress.unit}`),
    ...milestones.slice(0, 8).map(one => (
      <Box flexDirection="row" gap={1}>
        <Text color={MARK[one.status].color}>{MARK[one.status].glyph}</Text>
        <Text color={one.status === 'done' ? C.muted : C.text} bold={one.status === 'active'} wrap={fit(m)}>
          {one.title}
        </Text>
      </Box>
    )),
    ...(milestones.length === 0
      ? [empty(el, 'No milestones recorded yet: progress follows this session’s tasks.')]
      : []),

    ...promptBlock(el, m, room),

    heading(el, m, 'TASKS', `${stats.done} done · ${stats.active} active · ${stats.waiting} waiting`),
    ...active.slice(0, 3).map(task => (
      <Box flexDirection="row" gap={1}>
        <Text color={C.run}>▶</Text>
        <Text color={C.text} wrap={fit(m)}>
          {task.activeForm ?? task.subject}
        </Text>
      </Box>
    )),
    ...(stats.total === 0 ? [empty(el, 'No tasks yet.')] : []),
    ...(checked === '' ? [] : [labelled(el, m, 'of done', checked, C.muted)]),

    ...(ran.length === 0
      ? []
      : [
          heading(el, m, 'CHECKS'),
          ...ran.map(check => (
            <Text color={CHECK_COLOR[stateOf(check)]} wrap={fit(m)}>
              {checkLines([check], m.now)[0] ?? ''}
            </Text>
          )),
        ]),

    ...(m.git === null ? [] : [heading(el, m, 'GIT', gitLine(m.git))]),

    heading(el, m, 'AGENTS', `${live.length} working · ${m.agents.length} this session`),
    ...live.slice(0, 5).map(run => (
      <Box flexDirection="row" gap={1}>
        <Text color={lookOf(run.type).color}>{lookOf(run.type).glyph}</Text>
        <Text color={C.text} wrap={fit(m)}>
          {clip(run.label, 40)}
        </Text>
        {equipment(el, run.families, 3)}
        <Text color={C.muted}>{elapsed(m.now - run.startedAt)}</Text>
      </Box>
    )),

    heading(el, m, 'PROCESSES', `${running.length} running`),
    ...running.slice(0, 4).map(proc => (
      <Box flexDirection="row" gap={1}>
        <Text color={C.proc}>◈</Text>
        <Text color={C.muted}>{proc.kind}</Text>
        <Text color={C.text} wrap={fit(m)}>
          {proc.label}
        </Text>
      </Box>
    )),

    heading(el, m, 'ACTIVITY'),
    ...m.activity
      .slice(-5)
      .reverse()
      .map(entry => (
        <Box flexDirection="row" gap={1}>
          <Text color={C.faint}>{elapsed(m.now - entry.at).padStart(6)}</Text>
          <Text color={C.muted} wrap={fit(m)}>
            {entry.text}
          </Text>
        </Box>
      )),
    ...(m.activity.length === 0 ? [empty(el, 'Nothing has happened yet.')] : []),

    ...(m.files.length === 0
      ? []
      : [
          heading(
            el,
            m,
            'HOT FILES',
            areas
              .slice(0, 4)
              .map(one => `${one.area} ${one.edits}×`)
              .join(' · '),
          ),
          ...hotFiles(m.files, 4).map(hit => (
            <Box flexDirection="row" gap={1}>
              <Text color={C.run}>{String(hit.edits).padStart(3)}×</Text>
              <Text color={C.muted} wrap="truncate-start">
                {shortPath(hit.path)}
              </Text>
            </Box>
          )),
        ]),

    <Box flexDirection="row" gap={1} marginTop={1} flexWrap="wrap">
      <Button key="orchestrate" label="Orchestrate" hotkey="o" onPress={a.orchestrate} />
      <Button key="clear" label="Clear finished" hotkey="c" onPress={a.clearFinished} />
      {m.turn.isWorking && <Button key="stop" label="Stop turn" hotkey="s" onPress={a.stopTurn} />}
    </Box>,
  ]
}

// A task's mark. A finished one's says whether anything checked it: ✔✔ once
// verified, ✔ on Claude's word alone, ✘ when its check failed.
const markOf = (task: Task, blocked: boolean): { glyph: string; color: string } => {
  if (blocked) return { glyph: '⊘', color: C.fail }
  const standing = standingOf(task)

  return standing === 'open'
    ? TASK_MARK[task.status]
    : { glyph: STANDING[standing].glyph, color: STANDING_COLOR[standing] }
}

const tasksView = (el: El, m: Model): RenderElement[] => {
  const { Box, Text } = el
  const rows = taskTree(m.tasks)
  const stats = taskStats(m.tasks)
  const checked = standingText(m.tasks)

  return [
    heading(el, m, 'TASKS', `${stats.done} done · ${stats.active} active · ${stats.waiting} waiting`),
    ...(rows.length === 0 ? [empty(el, 'No tasks yet.')] : []),
    ...(checked === '' ? [] : [labelled(el, m, 'of done', checked, C.muted)]),
    ...rows.slice(0, 60).map(({ task, depth }) => {
      const blocked = isBlocked(task, m.tasks)
      const mark = markOf(task, blocked)
      const standing = standingOf(task)
      // A task an earlier session left is this session's to see, dimmer.
      const isCarried = task.sessionId !== undefined
      const isDone = task.status === 'completed'

      return (
        <Box flexDirection="row" gap={1} marginLeft={depth * 2}>
          <Text color={mark.color}>
            {depth > 0 ? '└ ' : ''}
            {mark.glyph}
          </Text>
          <Box flexDirection={isNarrow(m) ? 'column' : 'row'} gap={isNarrow(m) ? 0 : 1}>
            <Text
              color={isDone ? (isCarried ? C.faint : C.muted) : isCarried ? C.muted : C.text}
              bold={task.status === 'in_progress'}
              wrap={fit(m)}
            >
              {task.status === 'in_progress' ? (task.activeForm ?? task.subject) : task.subject}
            </Text>
            <Box flexDirection="row" gap={1}>
              <Text color={C.faint}>{task.area}</Text>
              {task.areaFrom === 'code' && <Text color={C.proc}>code</Text>}
              {task.owner !== undefined && <Text color={C.agent}>@{task.owner}</Text>}
              {blocked && <Text color={C.fail}>waits on {openBlockers(task, m.tasks).join(', ')}</Text>}
              {isCarried && <Text color={C.faint}>earlier session</Text>}
              {standing !== 'open' && !isNarrow(m) && (
                <Text color={standing === 'refuted' ? C.fail : C.faint}>{verdictNote(task)}</Text>
              )}
            </Box>
          </Box>
        </Box>
      )
    }),
    ...(rows.length > 60 ? [empty(el, `+${rows.length - 60} more`)] : []),
  ]
}

// The hotkey of the Project view: the views' keys follow their order.
const PROJECT_KEY = VIEWS.findIndex(one => one.name === 'project') + 1

// The whole project: its sessions, the agents of each, and their sub-agents.
const projectView = (el: El, m: Model): RenderElement[] => {
  const { Box, Text } = el
  const { log } = m
  const name = m.project?.name ?? 'this project'
  if (log === null || log.sessions.length === 0) {
    return [
      heading(el, m, 'PROJECT', name),
      empty(el, 'No sessions recorded yet: one is written as a session starts.'),
    ]
  }
  const others = log.sessions.filter(session => session.id !== m.sessionId).length

  return [
    heading(el, m, 'PROJECT', name),
    <Text color={C.text} wrap="wrap">
      {projectHeadline(log)}
    </Text>,
    <Box flexDirection="row" gap={2} flexWrap="wrap">
      <Text color={C.faint}>● this session</Text>
      <Text color={C.faint}>
        ○ {others} other{others === 1 ? '' : 's'}
      </Text>
      <Text color={C.faint}>└ agent, its sub-agents under it</Text>
    </Box>,
    heading(el, m, 'SESSIONS', 'newest first'),
    ...logLines(el, m, log, 8),
  ]
}

const equipmentLine = (el: El, families: FamilyCounts): RenderElement => {
  const { Box, Text } = el
  const top = topFamilies(families, 5)

  return (
    <Box flexDirection="row" gap={2} flexWrap="wrap">
      {top.length === 0 && <Text color={C.faint}>no tools used yet</Text>}
      {top.map(family => (
        <Text color={FAMILY_COLOR[family]}>
          {FAMILY_GLYPH[family]} {FAMILY_LABEL[family]} ×{families[family] ?? 0}
        </Text>
      ))}
    </Box>
  )
}

// An agent's icon: its avatar carrying its tools where the surface draws
// vectors, its glyph where it does not.
const portrait = (
  el: El,
  Svg: SvgEl | undefined,
  type: string,
  families: FamilyCounts,
  isWorking: boolean,
): RenderElement => {
  const { Text } = el
  const look = lookOf(type)
  if (Svg === undefined) return <Text color={look.color}>{look.glyph}</Text>

  return (
    <Svg
      source={avatarSvg(type, families, isWorking)}
      alt={avatarAlt(type, families)}
      width={56}
      height={56}
    />
  )
}

const agentsView = (el: El, m: Model, Svg: SvgEl | undefined): RenderElement[] => {
  const { Box, Text } = el
  const rows = agentTree(m.agents.slice(-30))
  const earlier = earlierLog(m)

  return [
    heading(el, m, 'AGENTS', `${m.agents.filter(isLive).length} working · ${m.agents.length} this session`),
    <Box flexDirection="row" gap={1}>
      {portrait(el, Svg, 'main', m.usage.mainFamilies, m.turn.isWorking)}
      <Box flexDirection="column">
        <Box flexDirection="row" gap={1}>
          <Text color={C.text} bold>
            Main session
          </Text>
          <Text color={C.muted}>{m.turn.isWorking ? 'working' : 'idle'} · city hall</Text>
        </Box>
        {equipmentLine(el, m.usage.mainFamilies)}
      </Box>
    </Box>,
    ...rows.map(({ run, depth }) => {
      const task = m.tasks.find(one => one.id === run.taskId)

      return (
        <Box flexDirection="row" gap={1} marginLeft={depth * 2} marginTop={1}>
          {depth > 0 && <Text color={C.faint}>└</Text>}
          {portrait(el, Svg, run.type, run.families, isLive(run))}
          <Box flexDirection="column">
            <Box flexDirection="row" gap={1}>
              <Text color={isLive(run) ? C.text : C.muted} bold={isLive(run)} wrap={fit(m)}>
                {run.name === undefined ? run.label : `${run.name}: ${run.label}`}
              </Text>
              <Text color={RUN_MARK[run.status].color}>{RUN_MARK[run.status].glyph}</Text>
            </Box>
            <Text color={C.muted} wrap={fit(m)}>
              {run.type} · {run.status} · {elapsed((run.endedAt ?? m.now) - run.startedAt)} ·{' '}
              {compact(run.tokens)} tokens · {run.tools} tool{run.tools === 1 ? '' : 's'}
              {isLive(run) && run.lastTool !== undefined ? ` · ${run.lastTool}` : ''}
            </Text>
            {equipmentLine(el, run.families)}
            {task !== undefined && (
              <Text color={C.faint} wrap={fit(m)}>
                → {task.subject}
              </Text>
            )}
          </Box>
        </Box>
      )
    }),

    ...(earlier.sessions.length === 0
      ? []
      : [
          heading(
            el,
            m,
            'EARLIER SESSIONS',
            `${earlier.sessions.length} in this project · all of them in Project (${PROJECT_KEY})`,
          ),
          ...logLines(el, m, earlier, 3),
        ]),
  ]
}

const resourcesView = (el: El, m: Model): RenderElement[] => {
  const { Box, Text } = el
  const room = roomOf(m)
  const { usage } = m
  const spenders = [...m.agents].sort((a, b) => b.tokens - a.tokens).slice(0, 5)
  const most = Math.max(1, usage.sessionTokens)
  const contextColor = usage.contextPercent >= 80 ? C.fail : usage.contextPercent >= 60 ? C.run : C.done

  return [
    ...promptBlock(el, m, room),

    heading(el, m, 'CONTEXT WINDOW'),
    meter(
      el,
      'filled',
      usage.contextPercent / 100,
      contextColor,
      room,
      `${usage.contextPercent}% · ${compact(usage.contextTokens)} of ${compact(usage.contextWindow)}`,
    ),

    heading(el, m, 'LIMITS AND COST'),
    ...usage.rateLimits.map(limit => {
      const resets = limit.resetsAt === undefined ? NaN : Date.parse(limit.resetsAt) - m.now
      const note = Number.isFinite(resets) && resets > 0 ? ` · resets in ${elapsed(resets)}` : ''

      return meter(
        el,
        limit.kind.replace('_', ' ').slice(0, 8),
        limit.percentUsed / 100,
        limit.percentUsed >= 90 ? C.fail : limit.percentUsed >= 70 ? C.run : C.done,
        room,
        `${limit.percentUsed}%${note}`,
      )
    }),
    // Where each window is heading at its pace: one on course to run out
    // before it resets, or full already, stands out.
    ...forecastsFor(m).map(forecast =>
      labelled(
        el,
        m,
        limitName(forecast.kind, true),
        forecastText(forecast, m.now),
        isShort(forecast) ? C.fail : C.muted,
      ),
    ),
    <Text color={C.muted} wrap="wrap">
      session cost ${usage.costUsd.toFixed(2)} · {compact(usage.sessionTokens)} tokens processed
    </Text>,

    heading(el, m, 'TOKENS BY AGENT'),
    ...(spenders.length === 0 ? [empty(el, 'No agents yet: everything so far is the main session.')] : []),
    ...spenders.map(run =>
      meter(el, clip(run.type, 8), run.tokens / most, lookOf(run.type).color, room, `${compact(run.tokens)} · ${clip(run.label, 30)}`),
    ),

    heading(el, m, 'WHAT PROMPTS USUALLY COST HERE'),
    ...sizeStats(m.history).map(stat => (
      <Box flexDirection="row" gap={1}>
        <Text color={C.text}>{stat.size.padEnd(2)}</Text>
        <Text color={C.muted}>
          {stat.count === 0
            ? 'no turns yet'
            : `${stat.count} turn${stat.count === 1 ? '' : 's'} · typically ${compact(stat.tokens)} tokens, ${elapsed(stat.ms)}`}
        </Text>
      </Box>
    )),
  ]
}

const skillsView = (el: El, m: Model): RenderElement[] => {
  const { Box, Text } = el
  const { skills } = m
  const used = Object.entries(skills.used).sort((a, b) => b[1] - a[1])
  const describe = (name: string): string =>
    skills.available.find(skill => skill.name === name)?.description ?? ''

  return [
    heading(el, m, 'USED THIS SESSION'),
    ...(used.length === 0 ? [empty(el, 'No skills used yet.')] : []),
    ...used.map(([name, count]) => (
      <Box flexDirection="row" gap={1}>
        <Text color={C.skill}>✦ {name}</Text>
        <Text color={C.muted}>×{count}</Text>
      </Box>
    )),

    heading(el, m, 'SUGGESTED FOR THIS WORK'),
    ...(skills.suggested.length === 0 ? [empty(el, 'Nothing stands out yet.')] : []),
    ...skills.suggested.map(name => (
      <Box flexDirection="column">
        <Text color={C.run}>✧ /{name}</Text>
        <Box marginLeft={2}>
          <Text color={C.muted} wrap={fit(m)}>
            {clip(describe(name), 110)}
          </Text>
        </Box>
      </Box>
    )),

    heading(el, m, 'AVAILABLE', `${skills.available.length}`),
    ...skills.available.slice(0, 40).map(skill => (
      <Box flexDirection="row" gap={1}>
        <Text color={skills.used[skill.name] === undefined ? C.text : C.skill}>/{skill.name}</Text>
        <Text color={C.faint} wrap="truncate-end">
          {isNarrow(m) ? '' : clip(skill.description, 70)}
        </Text>
      </Box>
    )),
  ]
}

// The city the City view draws: the full one adds the archive.
const shownCity = (m: Model): Model & { archive?: Archive } =>
  m.ui.cityView === 'full' ? { ...m, archive: m.archived ?? { entries: [], folded: {} } } : m

// The city where no vector drawing is possible: one row per district, and in
// the full city its archived work in dim blocks after it, the rest counted.
const cityText = (el: El, m: Model): RenderElement[] => {
  const { Box, Text } = el
  const districts = quartersOf(shownCity(m))
  const running = m.procs.filter(proc => proc.status === 'running').length
  const used = Object.keys(m.skills.used).length
  const [full, rest] = bar(m.usage.contextPercent, 100, 10)
  const BLOCK = { completed: '█', in_progress: '▓', pending: '░' } as const
  // A finished building stands whole once verified, half built while nothing
  // has checked it, and crossed out when its check failed.
  const BUILT = { open: '', verified: '█', unchecked: '▄', refuted: '✘' } as const
  const top = topWait(m.waits)
  const ran = checksLine(m.checks)
  const isAnyDone = m.tasks.some(task => task.status === 'completed')
  const homeless = m.agents.filter(run => isLive(run) && !m.tasks.some(task => task.id === run.taskId))

  return [
    heading(el, m, 'CITY'),
    <Box flexDirection="row" gap={1}>
      <Text color={C.agent}>◆ city hall</Text>
      <Text color={C.muted}>{sessionState(m.turn.isWorking, m.waits)}</Text>
      {homeless.map(run => (
        <Text color={lookOf(run.type).color}>{lookOf(run.type).glyph}</Text>
      ))}
    </Box>,
    ...(districts.length === 0 ? [empty(el, 'No districts yet: they appear with the first tasks.')] : []),
    ...districts.slice(0, 12).map(district => {
      const done = district.tasks.filter(task => task.status === 'completed').length
      const here = m.agents.filter(
        run => isLive(run) && district.tasks.some(task => task.id === run.taskId),
      )

      return (
        <Box flexDirection="row" gap={1}>
          <Text color={C.text}>{district.area.padEnd(10).slice(0, 10)}</Text>
          {district.tasks.slice(0, 24).map(task => {
            const standing = standingOf(task)

            return (
              <Text color={markOf(task, isBlocked(task, m.tasks)).color}>
                {standing === 'open' ? BLOCK[task.status] : BUILT[standing]}
              </Text>
            )
          })}
          {district.archived.map(() => (
            <Text color={C.faint}>█</Text>
          ))}
          {district.oldTown > 0 && <Text color={C.faint}>+{district.oldTown}</Text>}
          <Text color={C.muted}>
            {done}/{district.tasks.length}
          </Text>
          {here.map(run => (
            <Text color={lookOf(run.type).color}>{lookOf(run.type).glyph}</Text>
          ))}
        </Box>
      )
    }),
    <Box flexDirection="row" gap={1} marginTop={1}>
      <Text color={C.run}>⚡ power</Text>
      <Text color={C.run}>{full}</Text>
      <Text color={C.faint}>{rest}</Text>
      <Text color={C.muted}>context {m.usage.contextPercent}%</Text>
    </Box>,
    <Box flexDirection="row" gap={2}>
      <Text color={C.proc}>◈ works: {running} running</Text>
      <Text color={C.skill}>✦ library: {used} skills used</Text>
    </Box>,
    <Text color={ran === '' ? C.muted : checksColor(m.checks)} wrap="wrap">
      {`▣ checks: ${ran === '' ? 'none run yet' : ran}`}
    </Text>,
    ...(top === undefined
      ? []
      : [
          <Text color={isBlocking(top) ? C.fail : C.muted} bold={isBlocking(top)} wrap="wrap">
            {isBlocking(top) ? `${waitMark(top)} · waiting ${elapsed(m.now - top.at)}` : waitMark(top)}
          </Text>,
        ]),
    ...(isAnyDone
      ? [
          <Text color={C.faint} wrap="wrap">
            █ verified · ▄ done, not checked · ✘ failed its check · ▓ in progress · ░ waiting
          </Text>,
        ]
      : []),
  ]
}

// City's top strip: the band's whole strip, which the pane has room for, so
// nothing is dropped; it wraps where the pane is narrow, one element to a line
// in the narrow layout. Nothing at all when the strip is empty.
const cityStrip = (el: El, m: Model): RenderElement[] => {
  const { Box } = el
  const strip = stripElements(m)
  if (strip.length === 0) return []

  return [
    <Box key="strip" flexDirection={isNarrow(m) ? 'column' : 'row'} flexWrap="wrap" columnGap={1}>
      {strip.map(element => stripText(el, element, 'wrap'))}
    </Box>,
  ]
}

// The strip above the drawing. The picture takes the rest of the room: what it
// has to say is written on the city itself, so nothing is set under it.
const cityView = (el: El, m: Model, a: Actions, Svg: SvgEl | undefined): RenderElement[] => {
  const { Button } = el
  const isFull = m.ui.cityView === 'full'
  const toggle = (
    <Button key="city-view" label={isFull ? 'Current city' : 'Full city'} hotkey="f" onPress={a.toggleCity} />
  )
  if (Svg === undefined) return [...cityStrip(el, m), toggle, ...cityText(el, m)]
  const { aspect } = m
  const city = shownCity(m)
  const layout = isNarrow(m) ? 'column' : aspect === undefined ? 'avenue' : layoutFor(city, aspect)

  return [...cityStrip(el, m), toggle, <Svg source={renderCity(city, layout, aspect)} alt={cityAlt(m)} isInteractive />]
}

// ------------------------------------------------------------------- summary

// The dashboard as plain text, for where no surface can draw it.
export const summary = (m: Model): string => {
  const stats = taskStats(m.tasks)
  const progress = progressOf(m.project, m.tasks)
  const live = m.agents.filter(isLive)
  const running = m.procs.filter(proc => proc.status === 'running')
  const active = m.tasks.filter(task => task.status === 'in_progress')
  const { expected } = m.turn
  const phase = m.project === null || m.project.phase === '' ? '' : ` · ${m.project.phase}`
  const blocker = blockerOf(m)
  const checked = standingText(m.tasks)
  const ran = checksLine(m.checks)
  const forecasts = forecastsFor(m)
  // The window to name when none is running short: the fullest one.
  const nearest = [...forecasts].sort((a, b) => b.percentUsed - a.percentUsed)[0]
  const limit =
    limitAlert(forecasts, m.now) ??
    (nearest === undefined
      ? undefined
      : `${limitName(nearest.kind, true)} ${nearest.percentUsed}% · ${forecastText(nearest, m.now)}`)
  const log = m.log !== null && m.log.sessions.length > 0 ? m.log : null
  const spent =
    expected === null
      ? 'This prompt: none yet'
      : `${m.turn.isWorking ? 'This' : 'Last'} prompt: ${compact(m.turn.tokens)} tokens of ` +
        `${compact(expected.tokens.low)}–${compact(expected.tokens.high)} expected · ` +
        `${m.turn.tools} tool calls · ${elapsed(turnTime(m))}`

  return [
    `Polis · ${m.project?.name ?? 'this project'}${phase}`,
    ...(blocker === undefined ? [] : [`▲ Needs you: ${waitLine(m, blocker)}`]),
    `Progress: ${progress.percent}% (${progress.done}/${progress.total} ${progress.unit})`,
    `Tasks: ${stats.done} done · ${stats.active} active · ${stats.waiting} waiting` +
      (checked === '' ? '' : ` (${checked})`),
    ...active.slice(0, 5).map(task => `  ▶ ${clip(task.activeForm ?? task.subject, 70)}`),
    `Agents: ${live.length} working · ${m.agents.length} this session`,
    ...live.slice(0, 5).map(run => `  ● ${run.type}: ${clip(run.label, 60)}`),
    ...(ran === '' ? [] : [`Checks: ${ran}`]),
    ...(m.git === null ? [] : [`Git: ${gitLine(m.git)}`]),
    spent,
    `Context: ${m.usage.contextPercent}% · session cost $${m.usage.costUsd.toFixed(2)}`,
    ...(limit === undefined ? [] : [`Limits: ${limit}`]),
    `Background: ${running.length} running`,
    ...(log === null ? [] : [`Project: ${projectHeadline(log)}`]),
  ].join('\n')
}

// ---------------------------------------------------------------------- pane

// `Svg` is the surface's vector element, absent where it draws none: the
// city and the agents' icons are then text.
export const pane = (
  el: El,
  m: Model,
  a: Actions,
  Svg: SvgEl | undefined,
): RenderElement => {
  const { Box, Text, Button } = el
  const { view } = m.ui
  const body =
    view === 'city'
      ? cityView(el, m, a, Svg)
      : view === 'project'
        ? projectView(el, m)
        : view === 'tasks'
        ? tasksView(el, m)
        : view === 'agents'
          ? agentsView(el, m, Svg)
          : view === 'resources'
            ? resourcesView(el, m)
            : view === 'skills'
              ? skillsView(el, m)
              : overview(el, m, a)

  return (
    <Box flexDirection="column">
      <Box flexDirection="row" gap={1}>
        <Text color={C.agent} bold>
          ◆ POLIS
        </Text>
        <Text color={C.text} bold>
          {clip(m.project?.name ?? '', 28)}
        </Text>
        <Text color={C.muted} wrap="truncate-end">
          {m.project?.phase ?? ''}
        </Text>
      </Box>
      <Box flexDirection="row" gap={1} flexWrap="wrap">
        {VIEWS.map((one, index) => (
          <Button
            key={`view-${one.name}`}
            label={one.label}
            hotkey={String(index + 1)}
            variant={one.name === view ? 'primary' : 'secondary'}
            onPress={() => a.setView(one.name)}
          />
        ))}
      </Box>
      {body}
    </Box>
  )
}
