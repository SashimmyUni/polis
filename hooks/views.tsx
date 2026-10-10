import type { Elements, RenderElement } from 'claude-code'

import type {
  Activity,
  AgentRun,
  FamilyCounts,
  FileHit,
  Proc,
  Project,
  Range,
  Skills,
  Task,
  ToolFamily,
  Turn,
  TurnRecord,
  Ui,
  Usage,
  ViewName,
} from '../types'
import { cityAlt, renderCity } from './city'
import { avatarAlt, avatarSvg } from './icons'
import {
  SIZE_LABEL,
  agentTree,
  bar,
  clip,
  compact,
  districtsOf,
  elapsed,
  gaugeOf,
  hotFiles,
  isBlocked,
  isLive,
  openBlockers,
  progressOf,
  shortPath,
  sizeStats,
  taskStats,
  taskTree,
  topFamilies,
} from './logic'
import { C, FAMILY_COLOR, FAMILY_GLYPH, FAMILY_LABEL, VIEWS, lookOf } from './theme'

export type El = Pick<Elements['terminal'], 'Box' | 'Text' | 'Button'>

export type SvgEl = Elements['desktop']['Svg']

export type Model = {
  now: number
  columns: number
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
}

export type Actions = {
  setView: (view: ViewName) => void
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

// ---------------------------------------------------------------------- band

export const band = (el: El, m: Model, a: Actions): RenderElement => {
  const { Box, Text, Button } = el
  const stats = taskStats(m.tasks)
  const progress = progressOf(m.project, m.tasks)
  const live = m.agents.filter(isLive)
  const [full, rest] = bar(progress.percent, 100, clamp(m.columns - 84, 6, 14))
  const current = m.tasks.find(task => task.status === 'in_progress')
  const { expected } = m.turn
  const state = expected === null ? 'under' : gaugeOf(m.turn.tokens, expected.tokens).state
  const context = m.usage.contextPercent
  const contextColor = context >= 80 ? C.fail : context >= 60 ? C.run : C.muted

  return (
    <Box flexDirection="row" gap={1} flexWrap="wrap">
      <Text color={C.agent} bold>
        ◆ {clip(m.project?.name ?? 'Polis', 18)}
      </Text>
      {progress.total > 0 && <Text color={C.done}>{full}</Text>}
      {progress.total > 0 && <Text color={C.faint}>{rest}</Text>}
      {progress.total > 0 && <Text color={C.text}>{progress.percent}%</Text>}
      {stats.total > 0 && (
        <Text color={C.muted}>
          {stats.done}/{stats.total} tasks
        </Text>
      )}
      {live.slice(0, 6).map(run => (
        <Text color={lookOf(run.type).color}>{lookOf(run.type).glyph}</Text>
      ))}
      {expected !== null && (
        <Text color={STATE_COLOR[state]}>
          ⚡{compact(m.turn.tokens)}/{compact(expected.tokens.high)}
        </Text>
      )}
      {context > 0 && <Text color={contextColor}>ctx {context}%</Text>}
      {current !== undefined && m.columns >= 70 && (
        <Text color={C.muted} wrap="truncate-end">
          {clip(current.activeForm ?? current.subject, 40)}
        </Text>
      )}
      <Button key="city" label="City" variant="primary" onPress={a.openCity} />
      <Button key="hide" label="Hide" dimColor onPress={a.hideBand} />
    </Box>
  )
}

// --------------------------------------------------------------------- views

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

  return [
    heading(el, m, 'PROJECT', m.project === null ? '' : `session ${m.project.sessions} · ${m.project.turns} turns · ${compact(m.project.tokens)} tokens so far`),
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
          heading(el, m, 'HOT FILES'),
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

const tasksView = (el: El, m: Model): RenderElement[] => {
  const { Box, Text } = el
  const rows = taskTree(m.tasks)
  const stats = taskStats(m.tasks)

  return [
    heading(el, m, 'TASKS', `${stats.done} done · ${stats.active} active · ${stats.waiting} waiting`),
    ...(rows.length === 0 ? [empty(el, 'No tasks yet.')] : []),
    ...rows.slice(0, 60).map(({ task, depth }) => {
      const blocked = isBlocked(task, m.tasks)

      return (
        <Box flexDirection="row" gap={1} marginLeft={depth * 2}>
          <Text color={blocked ? C.fail : TASK_MARK[task.status].color}>
            {depth > 0 ? '└ ' : ''}
            {blocked ? '⊘' : TASK_MARK[task.status].glyph}
          </Text>
          <Box flexDirection={isNarrow(m) ? 'column' : 'row'} gap={isNarrow(m) ? 0 : 1}>
            <Text
              color={task.status === 'completed' ? C.muted : C.text}
              bold={task.status === 'in_progress'}
              wrap={fit(m)}
            >
              {task.status === 'in_progress' ? (task.activeForm ?? task.subject) : task.subject}
            </Text>
            <Box flexDirection="row" gap={1}>
              <Text color={C.faint}>{task.area}</Text>
              {task.owner !== undefined && <Text color={C.agent}>@{task.owner}</Text>}
              {blocked && <Text color={C.fail}>waits on {openBlockers(task, m.tasks).join(', ')}</Text>}
            </Box>
          </Box>
        </Box>
      )
    }),
    ...(rows.length > 60 ? [empty(el, `+${rows.length - 60} more`)] : []),
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
      width={44}
      height={44}
    />
  )
}

const agentsView = (el: El, m: Model, Svg: SvgEl | undefined): RenderElement[] => {
  const { Box, Text } = el
  const rows = agentTree(m.agents.slice(-30))

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

// The city where no vector drawing is possible: one row per district.
const cityText = (el: El, m: Model): RenderElement[] => {
  const { Box, Text } = el
  const districts = districtsOf(m.tasks)
  const running = m.procs.filter(proc => proc.status === 'running').length
  const used = Object.keys(m.skills.used).length
  const [full, rest] = bar(m.usage.contextPercent, 100, 10)
  const BLOCK = { completed: '█', in_progress: '▓', pending: '░' } as const
  const homeless = m.agents.filter(run => isLive(run) && !m.tasks.some(task => task.id === run.taskId))

  return [
    heading(el, m, 'CITY'),
    <Box flexDirection="row" gap={1}>
      <Text color={C.agent}>◆ city hall</Text>
      <Text color={C.muted}>{m.turn.isWorking ? 'working' : 'idle'}</Text>
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
          {district.tasks.slice(0, 24).map(task => (
            <Text color={isBlocked(task, m.tasks) ? C.fail : TASK_MARK[task.status].color}>
              {BLOCK[task.status]}
            </Text>
          ))}
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
  ]
}

const cityView = (
  el: El,
  m: Model,
  Svg: SvgEl | undefined,
  canHover: boolean,
): RenderElement[] => {
  const { Box, Text } = el
  if (Svg === undefined) return cityText(el, m)

  return [
    <Box marginTop={1}>
      <Svg source={renderCity(m, isNarrow(m) ? 'column' : 'avenue')} alt={cityAlt(m)} isInteractive />
    </Box>,
    <Text color={C.muted} wrap="wrap">
      {isNarrow(m)
        ? 'Buildings are tasks; agents stand on what they work on.'
        : 'Buildings are tasks: a lot is planned, scaffolding is in progress, lit windows are done. Agents stand on what they work on, carrying the tools they use most.'}
      {canHover ? ' Hover anything for detail.' : ''}
    </Text>,
  ]
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
  const spent =
    expected === null
      ? 'This prompt: none yet'
      : `${m.turn.isWorking ? 'This' : 'Last'} prompt: ${compact(m.turn.tokens)} tokens of ` +
        `${compact(expected.tokens.low)}–${compact(expected.tokens.high)} expected · ` +
        `${m.turn.tools} tool calls · ${elapsed(turnTime(m))}`

  return [
    `Polis · ${m.project?.name ?? 'this project'}${phase}`,
    `Progress: ${progress.percent}% (${progress.done}/${progress.total} ${progress.unit})`,
    `Tasks: ${stats.done} done · ${stats.active} active · ${stats.waiting} waiting`,
    ...active.slice(0, 5).map(task => `  ▶ ${clip(task.activeForm ?? task.subject, 70)}`),
    `Agents: ${live.length} working · ${m.agents.length} this session`,
    ...live.slice(0, 5).map(run => `  ● ${run.type}: ${clip(run.label, 60)}`),
    spent,
    `Context: ${m.usage.contextPercent}% · session cost $${m.usage.costUsd.toFixed(2)}`,
    `Background: ${running.length} running`,
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
  canHover = true,
): RenderElement => {
  const { Box, Text, Button } = el
  const { view } = m.ui
  const body =
    view === 'city'
      ? cityView(el, m, Svg, canHover)
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
