import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, UiOpenResult } from 'claude-code'

import type {
  AgentRun,
  AgentRunStatus,
  CheckKind,
  LiveSession,
  Proc,
  RateLimit,
  StallReason,
  Task,
  Turn,
  Ui,
  Usage,
  ViewName,
} from '../types'
import { WRAP_UP, askOf } from './ask'
import { CHECK_LABEL, checksOf, noteEdit, outcomeOf, recordChecks, stateOf } from './checks'
import { GIT_DIFF, GIT_STATUS, areaOfPath, noteTouch, parseGit, taskOfEdit } from './codemap'
import { CHANGE_MS, liveKeeper, liveSessionOf } from './live'
import type { LiveKeeper } from './live'
import {
  ASKING,
  SIZES,
  SIZING_RUBRIC,
  about,
  addWait,
  asHistory,
  asProject,
  asTracks,
  bumpFamily,
  carryTasks,
  clip,
  createTask,
  endProc,
  expectedFor,
  fileUrl,
  firstQuestion,
  forecastText,
  forecastsOf,
  heuristicSize,
  hitFile,
  isBlocking,
  isLive,
  limitName,
  limitToast,
  matchTask,
  mergeProject,
  mergeTodos,
  mergeTracks,
  newProject,
  patchTask,
  pick,
  projectName,
  pushActivity,
  recordLimit,
  recordTasks,
  reconcileProcs,
  shouldAskModel,
  SMART_ZONE,
  smartZoneOf,
  stampDone,
  suggestSkills,
  taskStats,
  under,
  upsertProc,
  zoneCrossing,
  zoneLimit,
  zoneNote,
  zoneOf,
  zoneOwing,
  zoneToast,
} from './logic'
import type { EstimateMode, SavedTasks } from './logic'
import { EMPTY_ARCHIVE, asArchive, offBoard, syncArchive } from './archive'
import { asProjectLog, projectHeadline, projectLines, sessionRecord, upsertSession } from './projectlog'
import { REPORT_FILE, reportOf } from './report'
import { PAGE_FILES, PAGE_REFRESH_SECONDS, cityPage } from './page'
import { VIEWS, familyOf } from './theme'
import { dropStaleVerdicts, isVerifier, judge, judgeByChecks, taskToJudge, verdictOf } from './verify'
import { flowOf, stalledOf, workKind } from './flow'
import { raise, sessionName, stallText, zoneText } from './notify'
import { NO_PROGRESS, agentEnded, callBegan, callEnded, callOf, checkRan, progressed } from './stall'
import { GH_TIMEOUT, asTracker, isDue, readTracker } from './frontier'
import { band, pane, stripElements, summary } from './views'
import type { Actions, Model, StripModel } from './views'

const PANE = 'polis'
const TITLE = 'Polis'
const PROJECT_TOOL = 'mcp__polis__project'

// The room the pane asks for where a surface lets a plugin say: enough for
// the city at a readable size while the conversation keeps about half the
// window. A request, not a grant: the person's own size wins, and a pane
// left narrow gets the narrow layout instead.
const ROOM = { rows: 46, columns: 68 } as const

const IDLE: Turn = {
  id: null,
  isWorking: false,
  startedAt: 0,
  endedAt: 0,
  expected: null,
  tokens: 0,
  outTokens: 0,
  cacheRead: 0,
  tools: 0,
  steps: 0,
  agents: 0,
  hasWarned: false,
}

const UNMEASURED: Usage = {
  contextTokens: 0,
  contextWindow: 0,
  contextPercent: 0,
  rateLimits: [],
  costUsd: 0,
  sessionTokens: 0,
  mainFamilies: {},
  zoneLimit: SMART_ZONE,
  zoneAnnounced: 'inside',
  zoneOwed: 'inside',
}

const tasks = atom({ plugin: 'polis', key: 'tasks' } as const, [])
const agents = atom({ plugin: 'polis', key: 'agents' } as const, [])
const procs = atom({ plugin: 'polis', key: 'procs' } as const, [])
const turn = atom({ plugin: 'polis', key: 'turn' } as const, IDLE)
const usage = atom({ plugin: 'polis', key: 'usage' } as const, UNMEASURED)
const history = atom({ plugin: 'polis', key: 'history' } as const, [])
const project = atom({ plugin: 'polis', key: 'project' } as const, null)
const skills = atom({ plugin: 'polis', key: 'skills' } as const, {
  available: [],
  used: {},
  suggested: [],
})
const ui = atom({ plugin: 'polis', key: 'ui' } as const, {
  view: 'overview',
  isBandHidden: false,
  hasOpened: false,
  cityView: 'current',
})
const activity = atom({ plugin: 'polis', key: 'activity' } as const, [])
const files = atom({ plugin: 'polis', key: 'files' } as const, [])
const waits = atom({ plugin: 'polis', key: 'waits' } as const, [])
const limits = atom({ plugin: 'polis', key: 'limits' } as const, [])
const checks = atom({ plugin: 'polis', key: 'checks' } as const, [])
const git = atom({ plugin: 'polis', key: 'git' } as const, null)
const log = atom({ plugin: 'polis', key: 'log' } as const, null)
const archive = atom({ plugin: 'polis', key: 'archive' } as const, null)
const tick = atom({ plugin: 'polis', key: 'tick' } as const, 0)
const others = atom({ plugin: 'polis', key: 'others' } as const, [])
const flow = atom({ plugin: 'polis', key: 'flow' } as const, null)
const tracker = atom({ plugin: 'polis', key: 'tracker' } as const, null)
const progress = atom({ plugin: 'polis', key: 'progress' } as const, NO_PROGRESS)

const GUIDANCE = {
  id: 'polis:guidance',
  scope: 'session',
  text: [
    'The person watches a live project dashboard (Polis). For work of three or more steps,',
    'record the steps with the task tool before starting, mark each one in progress as you',
    'begin it and completed as soon as it is verified. When creating a task, set',
    '`metadata.area` to the repository directory or package it mainly touches (for example',
    "api, web, docs) and, for a sub-task, `metadata.parent` to its parent task's id. Where this session has no task",
    `tool, record and update the same steps through the \`tasks\` of the ${PROJECT_TOOL} tool`,
    `instead. For project-level work, record the project's milestones with ${PROJECT_TOOL}`,
    'once the plan is known, and update them whenever a milestone starts or completes.',
  ].join(' '),
} as const

const PROJECT_SPEC = {
  name: 'project',
  description: [
    "Records this project's plan on the person's Polis dashboard: its milestones and the",
    'current phase. Call it once the plan for project-level work is known, and again when a',
    'milestone starts or completes. Milestones are matched by `id`: send only the ones that',
    'changed. The record is kept across sessions for this project folder. In a session with',
    'no task tool of its own, `tasks` records the steps of the work at hand the same way:',
    'send each task once with its subject and area, then again by `id` as its status changes.',
  ].join(' '),
  inputSchema: {
    type: 'object',
    properties: {
      name: { type: 'string', description: "The project's display name." },
      phase: { type: 'string', description: 'A few words on what is happening now.' },
      milestones: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'A short stable slug.' },
            title: { type: 'string' },
            status: { type: 'string', enum: ['planned', 'active', 'done'] },
          },
          required: ['id'],
        },
      },
      tasks: {
        type: 'array',
        description: 'Only where the session has no task tool: the steps of the current work.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'A short stable slug.' },
            subject: { type: 'string' },
            status: { type: 'string', enum: ['pending', 'in_progress', 'completed', 'deleted'] },
            area: {
              type: 'string',
              description: 'The repository directory or package it mainly touches: api, web, docs.',
            },
            parent: { type: 'string', description: 'The id of the task this is a sub-task of.' },
            owner: { type: 'string', description: 'The name of the agent working on it.' },
            blockedBy: { type: 'array', items: { type: 'string' } },
            activeForm: { type: 'string', description: 'Shown while in progress: "Running tests".' },
          },
          required: ['id'],
        },
      },
    },
  },
  isDeferred: false,
} as const

const WORKER_PROMPT = [
  'You are a worker in an orchestrated run. You are given one self-contained',
  'task with the files or area it covers and what done looks like.',
  'Do exactly that task and stay inside its scope: another worker may be',
  'editing other files at the same time.',
  'End with a short report: what you changed (paths), how you checked it,',
  'and anything you could not finish or that looked wrong.',
].join(' ')

const VERIFIER_PROMPT = [
  'You are the verifier in an orchestrated run. You are given a claim about',
  'finished work. Check it against the actual files and by running the',
  'relevant tests or commands; never take the claim on trust and never edit',
  'files. Answer PASS or FAIL first, then the evidence: commands run, their',
  'output, and each defect with its path and line.',
].join(' ')

const orchestrationBrief = (goal: string): string =>
  [
    'Act as the orchestrator for the goal below. I am asking for subagents here: use them.',
    '',
    `1. Plan. Break the goal into 3 to 8 tasks and record every one with the task tool before any work starts, each with \`metadata.area\` (where this session has no task tool, through the \`tasks\` of ${PROJECT_TOOL}, each with its \`area\`). Note which tasks depend on each other.`,
    '2. Delegate. Start every independent task as its own Agent call, all in one message so they run in parallel. Give each a self-contained brief: the task, the files or area, what done looks like. Use `polis:worker` for implementation, `Explore` for read-only searching, `polis:verifier` for checking. Keep tiny or strictly sequential tasks for yourself, and never let two agents write the same files.',
    '3. Track. Mark a task in progress as it starts and completed only once it is verified.',
    '4. Verify. Treat each agent report as a claim: read the diff or run the tests before accepting it, and send failed work back with what was wrong.',
    '5. Report. Finish with what was done, what failed and what is left.',
    '',
    `Goal: ${goal}`,
  ].join('\n')

// The tools whose result can name work left running, or work stopped.
const BACKGROUND = new Set([
  'Bash',
  'PowerShell',
  'Monitor',
  'Workflow',
  'CronCreate',
  'CronDelete',
  'TaskStop',
])

// The tools whose command line may run a check, and the ones that change a file.
const SHELLS = new Set(['Bash', 'PowerShell'])
const EDITS = new Set(['Edit', 'Write', 'NotebookEdit'])

// Limits are the account's, shared by every session of every project: their
// readings are kept under one key, whatever the project.
const LIMITS_KEY = 'limits'

// What is known of the session itself, for its record in the project's log.
// Tokens are counted from where the session began: a /clear goes on in the
// same process, whose count does not start over.
type Here = {
  id: string
  root: string
  startedAt: number
  title: string
  turns: number
  tokensKept: number
  tokensFrom: number
}

const NOWHERE: Here = {
  id: '',
  root: '',
  startedAt: 0,
  title: '',
  turns: 0,
  tokensKept: 0,
  tokensFrom: 0,
}

const say = ($: EngineInterface, where: string, error: unknown): void => {
  $.ui.log(`polis: ${where}: ${String(error)}`)
}

// The phase a flow skill or command starts; one off the table leaves the
// phase as it was.
const startPhase = async ($: EngineInterface, name: string): Promise<void> => {
  try {
    const started = flowOf(name)
    if (started === undefined) return
    await update($, flow, () => started)
    await refresh($, false)
  } catch (error) {
    say($, 'reading the phase', error)
  }
}

const note = async ($: EngineInterface, kind: string, text: string): Promise<void> => {
  const at = await $.clock.now()
  await update($, activity, list => pushActivity(list, { at, kind, text }))
}

const saveProject = async ($: EngineInterface): Promise<void> => {
  const record = await read($, project)
  if (record !== null) await $.store.set(`project:${record.root}`, record)
}

const openPane = ($: EngineInterface) => $.ui.open({ id: PANE, title: TITLE, ...ROOM })

// The room each surface last gave the band and the pane, kept in the store
// so a drawing that looks wrong somewhere can be explained from its numbers.
let rooms: { [site: string]: string } = {}
let hasNewRoom = false

const measure = (site: string, room: object): void => {
  const text = JSON.stringify(room)
  if (rooms[site] === text) return
  rooms = { ...rooms, [site]: text }
  hasNewRoom = true
}

// Whether any surface has asked for the band: the engine raises `AbovePrompt`
// on some surfaces only, and a session drawn on none of them has no band.
let isBandAsked = false

// The status line stands in for the band while the band is hidden, and where
// no surface draws one: the band's strip as plain text, every element kept,
// since the line has no width of its own. Where no surface draws the band or
// the pane (an editor's chat panel) this line is all there is to see.
const refresh = async ($: EngineInterface, shouldOpen: boolean): Promise<void> => {
  const state = await read($, ui)
  const model = await loadStrip($)
  const strip = stripElements(model)
  $.ui.status(
    (isBandAsked && !state.isBandHidden) || strip.length === 0
      ? undefined
      : strip.map(element => element.text).join(' · '),
  )
  if (!shouldOpen || state.hasOpened) return

  const stats = taskStats(model.tasks)
  if (stats.total > 0 || (await read($, agents)).length > 0) {
    await update($, ui, value => ({ ...value, hasOpened: true }))
    void openPane($).catch(() => undefined)
  }
}

// Only the stores the strip is made from: the status line follows every move
// of the context, so it reads no more than it shows.
const loadStrip = async ($: EngineInterface): Promise<StripModel> => ({
  now: await $.clock.now(),
  waits: await read($, waits),
  limits: await read($, limits),
  usage: await read($, usage),
  tasks: await read($, tasks),
  others: await read($, others),
  turn: await read($, turn),
  agents: await read($, agents),
  flow: await read($, flow),
  progress: await read($, progress),
})

// Why the work stalled, as the strip last said it: the clock draws again only
// when that changes, so the stall's age moves and a cleared stall leaves.
let stallSaid: string | undefined
let stallReason: StallReason | undefined

// This session as a notification names it; set once the mod registers.
let nameHere = (): string => sessionName('', '')

// Reads the stall rule now. A stall that begins (none before, or another
// reason) is the moment to tell the person.
const watchStall = async ($: EngineInterface): Promise<void> => {
  const model = await loadStrip($)
  const stall = stalledOf(model)
  const said = stall === undefined ? undefined : `${about(model.now - stall.since)}: ${stall.why}`
  if (said === stallSaid) return
  const hasBegun = stall !== undefined && stall.reason !== stallReason
  stallSaid = said
  stallReason = stall?.reason
  await refresh($, false)
  if (!hasBegun) return
  await note($, 'stall', `Stalled: ${stall.why}`)
  await raise($, stallText(nameHere(), stall.why))
}

// Work moved: a step, a tool call or an agent event.
const move = async ($: EngineInterface, change = progressed): Promise<void> => {
  const now = await $.clock.now()
  await update($, progress, value => change(value, now))
  await watchStall($)
}

const rootOf = async ($: EngineInterface): Promise<string> => {
  const repo = await $.session.repo().catch(() => null)

  return repo?.root ?? (await $.session.cwd())
}

// The session as it is now. A /clear goes on under a new id with no
// `session.start` raised for it: the first thing seen under the new id
// begins its record.
const whereabouts = async ($: EngineInterface, here: Here, now: number): Promise<Here> => {
  const id = await $.session.id().catch(() => here.id)
  const root = here.root === '' ? await rootOf($).catch(() => '') : here.root
  if (id === here.id) return root === here.root ? here : { ...here, root }

  return {
    ...NOWHERE,
    id,
    root,
    startedAt: now,
    tokensFrom: (await read($, usage)).sessionTokens,
  }
}

// A tool call that ended, however it ended, is waited on no longer.
const endWaits = async (
  $: EngineInterface,
  tool: string,
  agentId: string | undefined,
): Promise<void> => {
  const isOver = (wait: { tool?: string; agentId?: string }): boolean =>
    wait.tool === tool && wait.agentId === agentId
  if (!(await read($, waits)).some(isOver)) return
  await update($, waits, list => list.filter(wait => !isOver(wait)))
  await refresh($, false)
}

// Reopened work is no longer what was checked. Only the task whose status
// moved is looked at: a verifier may have judged another before it was done.
const reopen = (before: readonly Task[], after: readonly Task[]): Task[] =>
  after.map(task => {
    const was = before.find(one => one.id === task.id)

    return was?.status === 'completed' && task.status !== 'completed'
      ? (dropStaleVerdicts([task])[0] ?? task)
      : task
  })

// One more reading of the limit windows, joined with what parallel sessions
// read, and one toast for a window on course to run out before it resets.
const trackLimits = async ($: EngineInterface, readings: readonly RateLimit[]): Promise<void> => {
  const now = await $.clock.now()
  const base = mergeTracks(await read($, limits), asTracks(await $.store.get(LIMITS_KEY)))
  let tracks = [
    ...readings.map(limit =>
      recordLimit(
        base.find(track => track.kind === limit.kind),
        limit,
        now,
      ),
    ),
    ...base.filter(track => !readings.some(limit => limit.kind === track.kind)),
  ]
  for (const forecast of forecastsOf(readings, tracks, now)) {
    const track = tracks.find(one => one.kind === forecast.kind)
    if (forecast.outlook !== 'short' || track === undefined || track.hasWarned) continue
    tracks = tracks.map(one => (one === track ? { ...one, hasWarned: true } : one))
    $.ui.toast(limitToast(forecast, now))
  }
  const kept = tracks
  await update($, limits, () => kept)
  await $.store.set(LIMITS_KEY, kept)
}

// The working tree, asked of git itself. Any failure leaves what was known.
const readGit = async ($: EngineInterface, root: string): Promise<void> => {
  if (root === '') return
  try {
    const init = { cwd: root, timeoutMs: 5000 }
    const status = await $.process.run(GIT_STATUS, init)
    if (status.exitCode !== 0) return
    // A repository with no commit yet has no HEAD to compare with: no lines counted.
    const diff = await $.process.run(GIT_DIFF, init)
    const next = parseGit(status.stdout, diff.exitCode === 0 ? diff.stdout : '', await $.clock.now())
    if (next !== null) await update($, git, () => next)
  } catch {
    // Not a repository, no git, or a slow one.
  }
}

// The wayfinder frontier, asked of `gh` at most every five minutes, the time
// kept with it so that parallel sessions of the project share the wait.
let isReadingTracker = false

const readFrontier = async ($: EngineInterface, root: string): Promise<void> => {
  if (root === '' || isReadingTracker) return
  isReadingTracker = true
  try {
    const key = `tracker:${root}`
    const now = await $.clock.now()
    const held = await read($, tracker)
    const last = asTracker(await $.store.get(key)) ?? held
    if (!isDue(last, now)) {
      if (held === null && last !== null) await update($, tracker, () => last)
      return
    }
    const next = await readTracker(argv => $.process.run(argv, { cwd: root, timeoutMs: GH_TIMEOUT }), last, now)
    await update($, tracker, () => next)
    await $.store.set(key, next)
  } catch {
    // The store refused it: the frontier stays as it was.
  } finally {
    isReadingTracker = false
  }
}

// The project's archive brought in line with the board. The stored archive
// is read again just before, so that a parallel session's work is not lost.
const saveArchive = async ($: EngineInterface, here: Here, board: readonly Task[]): Promise<void> => {
  if (here.root === '' || here.id === '') return
  const key = `archive:${here.root}`
  const stored = asArchive(await $.store.get(key))
  const next = syncArchive(stored, board, here.id)
  await update($, archive, () => next)
  if (next !== stored) await $.store.set(key, next)
}

// The board as the sessions that follow will find it.
const saveTasks = async ($: EngineInterface, here: Here): Promise<void> => {
  if (here.root === '') return
  const at = await $.clock.now()
  const list = await update($, tasks, value => stampDone(value, at))
  const saved: SavedTasks = { sessionId: here.id, at, tasks: list }
  await $.store.set(`tasks:${here.root}`, saved)
  await saveArchive($, here, list)
}

// This session's record, written into the project's log. The stored log is
// read again just before, so that a parallel session's record is not lost.
const saveSession = async ($: EngineInterface, here: Here, isOver: boolean): Promise<void> => {
  if (here.id === '' || here.root === '') return
  const now = await $.clock.now()
  // A finished session never shows a live agent.
  const runs = isOver
    ? await update($, agents, list =>
        list.map(run => (isLive(run) ? { ...run, status: 'done' as const, endedAt: now } : run)),
      )
    : await read($, agents)
  const measured = await read($, usage)
  const record = sessionRecord({
    id: here.id,
    startedAt: here.startedAt,
    now,
    title: here.title,
    turns: here.turns,
    tokens: here.tokensKept + Math.max(0, measured.sessionTokens - here.tokensFrom),
    costUsd: measured.costUsd,
    // The tasks of earlier sessions are counted in their own records.
    tasks: (await read($, tasks)).filter(task => task.sessionId === undefined),
    filesEdited: (await read($, files)).length,
    agents: runs,
  })
  const key = `log:${here.root}`
  const next = upsertSession(asProjectLog(await $.store.get(key), here.root), record)
  await update($, log, () => next)
  await $.store.set(key, next)
}

// A verifier's final message, read for its answer and set on the task it was about.
const settleVerdict = async ($: EngineInterface, agentId: string, message: string): Promise<void> => {
  const run = (await read($, agents)).find(one => one.agentId === agentId)
  if (run === undefined || !isVerifier(run.type)) return
  const list = await read($, tasks)
  const state = verdictOf(message)
  const taskId = taskToJudge(list, run)
  const task = list.find(one => one.id === taskId)
  if (state === undefined || taskId === undefined || task === undefined) return
  // The same answer reaches the mod twice: as the end of the agent's turn and as its stop.
  const held = task.verdict
  if (held?.by === 'verifier' && held.state === state && held.at >= run.startedAt) return
  const at = await $.clock.now()
  await update($, tasks, value => judge(value, taskId, state, 'verifier', at))
  await note($, 'task', `Verifier ${state === 'passed' ? 'passed' : 'failed'}: ${task.subject}`)
}

// The session as Markdown, for a pull request or a stand-up note.
const reportText = async ($: EngineInterface, here: Here): Promise<string> => {
  const now = await $.clock.now()
  const measured = await read($, usage)

  return reportOf({
    now,
    project: await read($, project),
    ...(here.root === '' ? {} : { root: here.root }),
    tasks: await read($, tasks),
    agents: await read($, agents),
    files: await read($, files),
    usage: measured,
    turns: here.turns,
    checks: (await read($, checks)).map(check => ({
      kind: CHECK_LABEL[check.kind],
      state: stateOf(check),
      command: check.command,
      at: check.at,
    })),
    git: await read($, git),
    limits: forecastsOf(measured.rateLimits, await read($, limits), now).map(forecast => ({
      label: `${limitName(forecast.kind)} limit`,
      percentUsed: forecast.percentUsed,
      note: forecastText(forecast, now),
    })),
  })
}

const countDone = async ($: EngineInterface, gained: number): Promise<void> => {
  if (gained <= 0) return
  await update($, project, record =>
    record === null ? record : { ...record, tasksDone: record.tasksDone + gained },
  )
  await saveProject($)
}

const clearFinished = async ($: EngineInterface): Promise<void> => {
  await update($, tasks, list => list.filter(task => task.status !== 'completed'))
  await update($, agents, list => list.filter(isLive))
  await update($, procs, list => list.filter(proc => proc.status === 'running'))
  await refresh($, false)
}

const stopTurn = async ($: EngineInterface): Promise<void> => {
  const { id, isWorking } = await read($, turn)
  if (isWorking && id !== null) await $.turn.abort({ turnId: id })
}

const openAt = async ($: EngineInterface, view: ViewName | undefined): Promise<UiOpenResult> => {
  // A pane that was closed opens on the current city, as does one whose
  // state the engine cannot tell.
  const isOpen = await $.ui.panes().then(
    open => open.some(one => one.id === PANE),
    () => false,
  )
  await update($, ui, value => ({
    ...value,
    isBandHidden: false,
    hasOpened: true,
    view: view ?? value.view,
    cityView: isOpen ? value.cityView : 'current',
  }))

  return openPane($)
}

const actionsOf = ($: EngineInterface): Actions => ({
  setView: view => update($, ui, value => ({ ...value, view })),
  toggleCity: () =>
    // Typed as Ui so the type check does not widen cityView to string.
    update($, ui, (value): Ui => ({ ...value, cityView: value.cityView === 'full' ? 'current' : 'full' })),
  openCity: () => openAt($, 'city'),
  hideBand: async () => {
    await update($, ui, value => ({ ...value, isBandHidden: true }))
    await refresh($, false)
  },
  // A surface with a composer of its own takes no fill: say what to type.
  orchestrate: async () => {
    const filled = await $.prompt.fill({ text: '/orchestrate ', mode: 'replace' })
    if (!filled.isFilled) $.ui.toast('Type /orchestrate <goal> to plan it and run it with agents')
  },
  clearFinished: () => clearFinished($),
  stopTurn: () => stopTurn($),
})

// The session a model is loaded for; `here`, where known, gives this
// session's own live record beside the others'.
type ModelSession = Pick<Model, 'sessionId' | 'root' | 'isStill'> & { here?: Here }

const load = async (
  $: EngineInterface,
  { here: at, ...session }: ModelSession,
  columns: number,
  aspect?: number,
): Promise<Model> => {
  await read($, tick)
  const record = await read($, project)
  const board = await read($, tasks)
  const now = await $.clock.now()
  const live = await read($, others)

  return {
    now,
    columns,
    aspect,
    ...session,
    ...(at === undefined || at.id === '' || live.length === 0 ? {} : { thisSession: await liveOf($, at, now) }),
    // A session whose start was not seen is placed by its project's record.
    root: session.root === '' ? (record?.root ?? '') : session.root,
    limits: await read($, limits),
    waits: await read($, waits),
    checks: await read($, checks),
    git: await read($, git),
    log: await read($, log),
    tasks: board,
    archived: offBoard((await read($, archive)) ?? EMPTY_ARCHIVE, board, session.sessionId),
    agents: await read($, agents),
    procs: await read($, procs),
    turn: await read($, turn),
    usage: await read($, usage),
    history: await read($, history),
    project: record,
    skills: await read($, skills),
    ui: await read($, ui),
    activity: await read($, activity),
    files: await read($, files),
    others: live,
    flow: await read($, flow),
    tracker: await read($, tracker),
    progress: await read($, progress),
  }
}

// This session's live record, kept in the store the other running sessions
// read, and its reading of theirs; set once the session has started.
let keeper: LiveKeeper | undefined

const keepLive = async ($: EngineInterface, here: Here): Promise<void> => {
  if (keeper === undefined || here.id === '' || here.root === '') return
  const now = await $.clock.now()
  await keeper.write(await liveOf($, here, now), now)
}

// This session's live record as it stands: what the others read of it.
const liveOf = async ($: EngineInterface, here: Here, now: number): Promise<LiveSession> => {
  const measured = await read($, usage)
  const stall = stalledOf(await loadStrip($))

  return liveSessionOf({
    sessionId: here.id,
    root: here.root,
    title: here.title,
    isWorking: (await read($, turn)).isWorking,
    waits: await read($, waits),
    tasks: await read($, tasks),
    agents: await read($, agents),
    usage: measured,
    tokens: here.tokensKept + Math.max(0, measured.sessionTokens - here.tokensFrom),
    flow: await read($, flow),
    stall: stall?.why ?? '',
    now,
  })
}

// What the others' records say without their times: a heartbeat alone is no
// reason to draw again.
const saidBy = (list: readonly LiveSession[]): string =>
  JSON.stringify(list.map(one => ({ ...one, updatedAt: 0 })))

const readLive = async ($: EngineInterface, here: Here): Promise<void> => {
  if (keeper === undefined || here.root === '') return
  const found = await keeper.others(here.root, here.id, await $.clock.now())
  if (saidBy(found) === saidBy(await read($, others))) return
  await update($, others, () => found)
  await refresh($, false)
}

// The pages on disk: what was last written to each, and whether a failure
// to write them has been said already.
let written = new Map<string, string>()
let hasSaidPage = false

// Writes the two cities, current and full, where a browser left open finds
// them, each only when its picture changed: an idle session writes nothing.
// Asked for outright (a session starting, `/city page`), it writes whatever
// stands there, so a file since deleted comes back.
const writePage = async (
  $: EngineInterface,
  session: Pick<Model, 'sessionId' | 'root' | 'isStill'>,
  root: string,
  isAsked: boolean,
): Promise<{ current: string; full: string }> => {
  const model = await load($, session, 80)
  const name =
    model.project !== null && model.project.name !== '' ? model.project.name : projectName(root)
  const paths = {
    current: under(root, '.polis', PAGE_FILES.current),
    full: under(root, '.polis', PAGE_FILES.full),
  }
  const texts = [
    [paths.current, cityPage(model, name)],
    [paths.full, cityPage({ ...model, archive: model.archived ?? EMPTY_ARCHIVE }, name)],
  ] as const
  // The folder keeps itself out of `git status`.
  const ignore = under(root, '.polis', '.gitignore')
  if ((isAsked || !written.has(paths.current)) && !(await $.fs.exists(ignore))) {
    await $.fs.write(ignore, '*\n')
  }
  for (const [path, text] of texts) {
    if (!isAsked && written.get(path) === text) continue
    await $.fs.write(path, text)
    written.set(path, text)
  }

  return paths
}

// The mod's own write, at the start and on its timer: a folder that cannot
// be written is said once, not every two seconds.
const keepPage = async (
  $: EngineInterface,
  session: Pick<Model, 'sessionId' | 'root' | 'isStill'>,
  root: string,
  isAsked: boolean,
): Promise<void> => {
  try {
    await writePage($, session, root, isAsked)
    hasSaidPage = false
  } catch (error) {
    if (!hasSaidPage) say($, 'writing the page on disk', error)
    hasSaidPage = true
  }
}

export const register: Register = (on, options) => {
  const mode: EstimateMode =
    options.estimate === 'history' || options.estimate === 'model' ? options.estimate : 'both'
  const hasGuidance = options.guidance !== false
  const shouldAutoOpen = options.autoOpen !== false
  const isStill = options.motion === false
  const hasPage = options.page !== false
  const smartZone = smartZoneOf(options.smartZone)
  // What the person has asked for lately, for the skill suggestions.
  let asked: string[] = []
  let here: Here = NOWHERE
  nameHere = () => sessionName(here.title, here.root)
  // What the main loop's wrap-up call asked the person this turn, if anything.
  let wrapUpAsk: string | undefined
  // The project the page on disk is written under, once a session has started.
  let pageRoot: string | null = null
  const session = (): ModelSession => ({
    sessionId: here.id,
    root: here.root,
    isStill,
    here,
  })

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'city',
      description:
        'Open the Polis project dashboard and city map, or answer with a session report or the whole project as text',
      argumentHint: '[overview|city|tasks|agents|resources|skills|report [save]|project|page]',
    })
    await $.command.register({
      name: 'orchestrate',
      description: 'Plan a goal into tasks and run them with parallel agents',
      argumentHint: '<goal>',
    })

    try {
      if (hasGuidance) await $.tool.register(PROJECT_SPEC)
      await $.agent.register({
        name: 'worker',
        description:
          'Carries out one self-contained task of an orchestrated run and reports what it changed',
        prompt: WORKER_PROMPT,
      })
      await $.agent.register({
        name: 'verifier',
        description:
          'Checks a claim about finished work against the files and tests, read-only, and answers PASS or FAIL with evidence',
        prompt: VERIFIER_PROMPT,
        tools: ['Read', 'Grep', 'Glob', 'Bash'],
      })
    } catch (error) {
      say($, 'registering its tool and agent types', error)
    }

    try {
      const now = await $.clock.now()
      const repo = await $.session.repo().catch(() => null)
      const root = repo?.root ?? e.cwd
      pageRoot = root
      const sessionId = await $.session.id()
      // A reload runs this again while the session goes on: what the session
      // already holds for this project is newer than what the store kept.
      const held = await read($, project)
      const saved =
        held !== null && held.root === root
          ? held
          : asProject(await $.store.get(`project:${root}`), root, now)
      const record =
        saved.lastSessionId === sessionId
          ? { ...saved, lastActive: now }
          : { ...saved, lastActive: now, lastSessionId: sessionId, sessions: saved.sessions + 1 }
      await update($, project, () => record)
      await saveProject($)
      const kept = await $.store.get('rooms')
      if (typeof kept === 'object' && kept !== null) {
        rooms = { ...(kept as { [site: string]: string }), ...rooms }
      }
      const past = asHistory(await $.store.get(`history:${root}`))
      await update($, history, list => (list.length > past.length ? list : past))

      const commands = await $.command.list()
      const available = commands
        .filter(command => command.source !== 'builtin' && command.plugin !== 'polis')
        .slice(0, 120)
        .map(command => ({
          name: command.name,
          description: clip(command.description, 160),
          source: command.plugin ?? command.source,
        }))
      await update($, skills, value => ({ ...value, available }))

      const measured = await $.session.usage()
      const counted = await update($, usage, value => ({
        ...value,
        contextTokens: measured.context.tokens ?? value.contextTokens,
        contextWindow: measured.context.window,
        contextPercent: measured.context.percent ?? value.contextPercent,
        costUsd: measured.cost?.usd ?? value.costUsd,
        zoneLimit: zoneLimit(measured.context.window, smartZone),
      }))

      // The whole project, not this session alone: the log of its sessions,
      // and the tasks the earlier ones left on the board.
      const tracks = asTracks(await $.store.get(LIMITS_KEY))
      await update($, limits, list => mergeTracks(list, tracks))
      const was = asProjectLog(await $.store.get(`log:${root}`), root).sessions.find(
        one => one.id === sessionId,
      )
      here = {
        id: sessionId,
        root,
        startedAt: was?.startedAt ?? now,
        title: was?.title ?? '',
        turns: was?.turns ?? 0,
        tokensKept: was?.tokens ?? 0,
        tokensFrom: counted.sessionTokens,
      }
      if ((await read($, tasks)).length === 0) {
        const carried = carryTasks(await $.store.get(`tasks:${root}`), sessionId, now)
        if (carried.length > 0) await update($, tasks, () => carried)
      }
      // The finished work already on the board starts the archive.
      await saveArchive($, here, await read($, tasks))
      await saveSession($, here, false)
      void readGit($, root)
      void readFrontier($, root)
      await refresh($, false)
    } catch (error) {
      say($, 'loading the project', error)
    }

    // The other running sessions of the project, and this one for them.
    try {
      keeper = liveKeeper({
        get: key => $.store.get(key),
        set: (key, value) => $.store.set(key, value),
        delete: key => $.store.delete(key),
        keys: () => $.store.keys(),
      })
      await keepLive($, here)
      await readLive($, here)
    } catch (error) {
      say($, 'reading the live sessions', error)
    }

    // A pane left open across a reload asks again for its room: an open sets
    // the size anew, and the person's own size still wins.
    try {
      const open = await $.ui.panes()
      if (open.some(one => one.id === PANE)) void openPane($).catch(() => undefined)
    } catch (error) {
      say($, 'reopening the pane', error)
    }

    // Elapsed times in the pane move only while something is running.
    $.clock.every(5000, () => {
      void (async () => {
        const { isWorking } = await read($, turn)
        const runs = await read($, agents)
        if (isWorking || runs.some(isLive)) await update($, tick, count => count + 1)
        // Off the flow, a long turn turns to AFK work on the clock alone.
        if (isWorking && (await read($, flow)) === null) await refresh($, false)
        // Silence and a call that never ends stall work on the clock alone.
        await watchStall($)
        if (hasNewRoom) {
          hasNewRoom = false
          await $.store.set('rooms', rooms)
        }
      })().catch(() => undefined)
    })

    // This session's record follows it within two seconds and beats every
    // thirty; the others' are read every five.
    $.clock.every(CHANGE_MS, () => {
      void keepLive($, here).catch(() => undefined)
    })
    $.clock.every(5000, () => {
      void readLive($, here).catch(() => undefined)
    })

    // The page is there from the start, then follows the board.
    if (hasPage && pageRoot !== null) {
      const root = pageRoot
      hasSaidPage = false
      await keepPage($, session(), root, true)
      $.clock.every(2000, () => {
        void keepPage($, session(), root, false)
      })
    }

    return next(e)
  })

  on('session.end', async ($, e, next) => {
    try {
      // The others stop counting this session at once.
      if (keeper !== undefined && here.id !== '' && here.root !== '') await keeper.end(here.root, here.id)
    } catch (error) {
      say($, 'ending the live record', error)
    }
    try {
      await saveSession($, here, true)
      await saveTasks($, here)
    } catch (error) {
      say($, 'session.end', error)
    }
    if (e.reason === 'clear') {
      // The conversation is over and the project is not: what is left to do
      // stays on the board, as an earlier session's.
      const now = await $.clock.now()
      const saved: SavedTasks = { sessionId: here.id, at: now, tasks: await read($, tasks) }
      await update($, tasks, () => carryTasks(saved, '', now))
      await update($, agents, () => [])
      await update($, procs, () => [])
      await update($, turn, () => IDLE)
      await update($, activity, () => [])
      await update($, files, () => [])
      await update($, waits, () => [])
      await update($, flow, () => null)
      await update($, progress, () => NO_PROGRESS)
      // The process goes on under an id not yet known.
      here = { ...NOWHERE, root: here.root }
      await refresh($, false)
    }

    return next(e)
  })

  // A slash command naming a flow skill starts its phase. With guidance on, a
  // smart-zone crossing reaches Claude once, beside the person's next prompt:
  // never through the system prompt (ADR 0001).
  on('prompt.submit', async ($, e, next) => {
    if (e.command !== undefined) await startPhase($, e.command.name)
    if (!hasGuidance) return next(e)
    try {
      const measured = await read($, usage)
      if (measured.zoneOwed !== 'inside') {
        const text = zoneNote(measured.zoneOwed, measured.contextTokens, measured.zoneLimit)
        await update($, usage, value => ({ ...value, zoneOwed: 'inside' as const }))

        return next({ ...e, context: [...(e.context ?? []), text] })
      }
    } catch (error) {
      say($, 'prompt.submit', error)
    }

    return next(e)
  })

  if (hasGuidance) {
    on('prompt.compose', async ($, e, next) => {
      const composed = await next(e)
      // Where nothing draws there is no dashboard to keep current.
      if (e.surfaces.length === 0) return composed

      return { sections: [...composed.sections, GUIDANCE] }
    })

    // The mod's own tool writes nothing but the mod's own record.
    on('tool.check', { tool: PROJECT_TOOL }, () => ({ decision: 'allow' }))

    on('tool.call', { tool: PROJECT_TOOL }, async ($, e) => {
      const now = await $.clock.now()
      const before = (await read($, project)) ?? newProject(await $.session.cwd(), now)
      const after = mergeProject(before, {
        name: e.name,
        phase: e.phase,
        milestones: e.milestones,
      })
      await update($, project, () => after)
      await saveProject($)
      const done = after.milestones.filter(one => one.status === 'done').length
      if (e.milestones !== undefined) {
        await note($, 'project', `Plan updated: ${done}/${after.milestones.length} milestones done`)
      }

      // The steps of the work at hand, where the host has no task tool to watch.
      let steps = ''
      if (e.tasks !== undefined) {
        const had = taskStats(await read($, tasks)).done
        const list = await update($, tasks, value => reopen(value, recordTasks(value, e.tasks)))
        const stats = taskStats(list)
        await countDone($, stats.done - had)
        // Whoever owns a task in progress stands at its building.
        await update($, agents, runs =>
          runs.map(run => {
            const mine = list.find(
              task => task.status === 'in_progress' && task.owner !== undefined && task.owner === run.name,
            )

            return isLive(run) && mine !== undefined ? { ...run, taskId: mine.id } : run
          }),
        )
        await refresh($, shouldAutoOpen)
        steps = ` Tasks: ${stats.done} done, ${stats.active} active, ${stats.waiting} waiting.`
      }

      return {
        result: `Recorded. ${after.name}: ${done} of ${after.milestones.length} milestones done${
          after.phase === '' ? '' : `; phase: ${after.phase}`
        }.${steps}`,
      }
    })
  }

  on('command.run', { command: 'city' }, async ($, e) => {
    const wanted = e.args.trim().toLowerCase()
    const [word = '', option = ''] = wanted.split(/\s+/)
    // The report and the project are text wherever they are asked for.
    if (word === 'report') {
      const text = await reportText($, here)
      if (option !== 'save') return { text }
      const path = `${(await $.session.cwd()).replace(/[\\/]+$/, '')}/${REPORT_FILE}`
      try {
        await $.fs.write(path, text)

        return { text: `Saved to ${path}\n\n${text}` }
      } catch (error) {
        return { text: `Could not save the report to ${path}: ${String(error)}\n\n${text}` }
      }
    }
    // Where a surface draws, the word opens the Project view like any other.
    if (word === 'project' && (await $.session.surfaces()).length === 0) {
      const now = await $.clock.now()
      try {
        here = await whereabouts($, here, now)
        await saveSession($, here, false)
      } catch (error) {
        say($, 'writing the session into the project log', error)
      }
      const kept = await read($, log)
      if (kept === null || kept.sessions.length === 0) {
        return { text: 'Polis has no record of this project yet: one is written as a session starts.' }
      }
      const name = (await read($, project))?.name ?? 'Project'
      const lines = projectLines(kept, { now, liveId: here.id, columns: 80 })

      return { text: [`${name} · ${projectHeadline(kept)}`, '', ...lines].join('\n') }
    }
    const view = VIEWS.find(one => one.name === wanted)?.name
    // The page on disk is opened in a browser, not in the pane.
    if (wanted === 'page') {
      if (!hasPage) {
        return { text: 'The page on disk is turned off. Set the `page` option to true to have Polis write it.' }
      }
      try {
        const root = pageRoot ?? (await read($, project))?.root ?? (await $.session.cwd())
        const paths = await writePage($, session(), root, true)

        return {
          text: [
            `The city is written to ${paths.current}`,
            fileUrl(paths.current),
            '',
            `The full city, with everything the project has finished, is written to ${paths.full}`,
            fileUrl(paths.full),
            '',
            'Each page links to the other in its header.',
            '',
            'To keep it open in VS Code beside the terminal, once:',
            '1. Open the Command Palette (Ctrl+Shift+P, or Cmd+Shift+P on a Mac).',
            '2. Run "Open Integrated Browser".',
            '3. Paste the file URL above into its address bar.',
            '',
            `Any browser opens it too. It reloads itself every ${PAGE_REFRESH_SECONDS} seconds, so leave the tab open.`,
          ].join('\n'),
        }
      } catch (error) {
        return { text: `Polis could not write the page on disk: ${String(error)}` }
      }
    }
    // Where no surface draws (an editor's chat panel, a headless run) the
    // dashboard is given as the command's own text.
    if ((await $.session.surfaces()).length === 0) {
      return { text: summary(await load($, session(), 80)) }
    }
    const opened = await openAt($, view ?? (wanted === '' ? 'city' : undefined))
    if (opened.isPlaced) return { text: 'Polis opened.' }
    const board = summary(await load($, session(), 80))

    return { text: `Polis is open but not drawn here yet: ${opened.reason}\n\n${board}` }
  })

  on('command.run', { command: 'orchestrate' }, async ($, e) => {
    const goal = e.args.trim()
    if (goal === '') {
      return { text: 'Usage: /orchestrate <goal>' }
    }
    await update($, ui, value => ({ ...value, hasOpened: true }))
    void openPane($).catch(() => undefined)
    await startPhase($, 'orchestrate')
    // A command.run hook holds the turn a submit would wait on: submit after it.
    $.clock.after(50, () => {
      void $.prompt
        .submit({ text: orchestrationBrief(goal), asUser: true })
        .catch(error => say($, 'submitting the brief', error))
    })

    return { text: `Orchestrating: ${goal}` }
  })

  on('turn.start', async ($, e, next) => {
    try {
      const now = await $.clock.now()
      const past = await read($, history)
      const size = heuristicSize(e.text)
      await update($, turn, () => ({
        ...IDLE,
        id: e.turnId,
        isWorking: true,
        startedAt: now,
        endedAt: now,
        expected: expectedFor(size, 'heuristic', past),
      }))
      // A new prompt starts the signs of progress afresh.
      await update($, progress, () => progressed(NO_PROGRESS, now))
      // The prompt is the person's answer to whatever the main loop waited on.
      const answered = (await read($, waits)).some(
        wait => wait.agentId === undefined && isBlocking(wait),
      )
      await update($, waits, list => list.filter(wait => wait.agentId !== undefined))
      wrapUpAsk = undefined
      // A needs you the prompt answered leaves the strip at once, and work
      // started may show HITL or AFK work.
      if (answered || (await read($, flow)) !== null) await refresh($, false)
      here = await whereabouts($, here, now)
      if (here.title === '') here = { ...here, title: clip(e.text, 80) }

      asked = [...asked, e.text.slice(0, 2000)].slice(-3)
      const subjects = (await read($, tasks)).map(task => task.subject)
      const corpus = [...asked, ...subjects].join(' ')
      await update($, skills, value => ({
        ...value,
        suggested: suggestSkills(value.available, value.used, corpus),
      }))

      if (shouldAskModel(mode, e.text, size) && (await $.session.surfaces()).length > 0) {
        const { turnId, text } = e
        // Sized on a timer, so the prompt never waits on the small model.
        $.clock.after(10, () => {
          void (async () => {
            const label = await $.model.classify(`${SIZING_RUBRIC}\n${text.slice(0, 4000)}`, SIZES)
            const picked = SIZES.find(one => one === label)
            if (picked === undefined) return
            const known = await read($, history)
            await update($, turn, value =>
              value.id === turnId
                ? { ...value, expected: expectedFor(picked, 'model', known) }
                : value,
            )
          })().catch(() => undefined)
        })
      }
    } catch (error) {
      say($, 'turn.start', error)
    }

    return next(e)
  })

  // Passes every request through untouched, then counts what it cost.
  on('turn.step', async function* ($, e, next) {
    const result = yield* next(e)
    try {
      await move($)
      const cost = result.usage
      if (cost !== null) {
        const work = cost.input_tokens + cost.cache_creation_input_tokens + cost.output_tokens
        const now = await update($, turn, value =>
          value.isWorking
            ? {
                ...value,
                tokens: value.tokens + work,
                outTokens: value.outTokens + cost.output_tokens,
                cacheRead: value.cacheRead + cost.cache_read_input_tokens,
                steps: value.steps + 1,
              }
            : value,
        )
        await update($, usage, value => ({ ...value, sessionTokens: value.sessionTokens + work }))
        const { agentId } = e
        if (agentId !== undefined) {
          await update($, agents, list =>
            list.map(run =>
              run.agentId === agentId ? { ...run, tokens: run.tokens + work } : run,
            ),
          )
        }
        if (
          now.isWorking &&
          !now.hasWarned &&
          now.expected !== null &&
          now.tokens > now.expected.tokens.high * 1.5
        ) {
          await update($, turn, value => ({ ...value, hasWarned: true }))
          $.ui.toast('This prompt is running well past its expected token range')
        }
      }
    } catch (error) {
      say($, 'turn.step', error)
    }

    return result
  })

  on('turn.complete', async ($, e, next) => {
    try {
      const now = await $.clock.now()
      const { agentId } = e
      if (agentId === undefined) {
        const ended = await update($, turn, value => ({ ...value, isWorking: false, endedAt: now }))
        // The turn is handed back: nothing of the main loop's waits on a tool
        // any more, and a turn that ended asking the person something needs them.
        const ask = e.reason === 'answer' ? askOf(e.answer, wrapUpAsk) : undefined
        wrapUpAsk = undefined
        await update($, waits, list =>
          addWait(
            list.filter(wait => wait.agentId !== undefined),
            ask === undefined
              ? { kind: 'turn', at: now }
              : {
                  kind: 'asked',
                  at: now,
                  count: ask.count,
                  ...(ask.detail === undefined ? {} : { detail: clip(ask.detail, 80) }),
                },
          ),
        )
        here = { ...here, turns: here.turns + 1 }
        if (ended.expected !== null && ended.tokens > 0 && e.reason === 'answer') {
          const record = {
            size: ended.expected.size,
            tokens: ended.tokens,
            ms: e.durationMs,
            tools: ended.tools,
            agents: ended.agents,
            at: now,
          }
          const past = await update($, history, list => [...list, record].slice(-300))
          const saved = await update($, project, value =>
            value === null
              ? value
              : {
                  ...value,
                  turns: value.turns + 1,
                  tokens: value.tokens + ended.tokens,
                  lastActive: now,
                },
          )
          if (saved !== null) {
            await $.store.set(`history:${saved.root}`, past)
            await saveProject($)
          }
        }
      } else {
        const status: AgentRunStatus = e.reason === 'answer' ? 'done' : 'failed'
        const runs = await read($, agents)
        const run = runs.find(one => one.agentId === agentId)
        await update($, agents, list =>
          list.map(one => (one.agentId === agentId ? { ...one, status, endedAt: now } : one)),
        )
        if (run !== undefined) {
          await note($, 'agent', `Agent ${status === 'done' ? 'finished' : 'failed'}: ${run.label}`)
          if (status === 'failed') $.ui.toast(`Agent failed: ${clip(run.label, 60)}`)
        }
        await update($, waits, list => list.filter(wait => wait.agentId !== agentId))
        if (status === 'done') await settleVerdict($, agentId, e.answer)
        await move($, (value, now) => agentEnded(value, agentId, now))
      }
      await refresh($, shouldAutoOpen)
    } catch (error) {
      say($, 'turn.complete', error)
    }
    // The project's record is brought up to date each time the turn comes back.
    if (e.agentId === undefined) {
      try {
        await saveTasks($, here)
        await saveSession($, here, false)
        void readGit($, here.root)
        void readFrontier($, here.root)
      } catch (error) {
        say($, 'saving the session', error)
      }
    }

    return next(e)
  })

  // The desktop app's wrap-up call in the main loop: its ask is put to the
  // person when the turn ends.
  on('tool.call', { tool: WRAP_UP }, async ($, e, next) => {
    if (e.agentId === undefined) wrapUpAsk = pick(e, 'ask')

    return next(e)
  })

  on('agent.spawn', async ($, e, next) => {
    let key = ''
    let startedAt = 0
    try {
      startedAt = await $.clock.now()
      key = `${e.tool_use_id}:${startedAt}`
      const label = e.description === '' ? e.subagentType : e.description
      const taskId = matchTask(`${e.name ?? ''} ${label}`, await read($, tasks))
      const run: AgentRun = {
        key,
        label,
        type: e.subagentType,
        status: 'starting',
        tools: 0,
        families: {},
        tokens: 0,
        startedAt,
        ...(e.name === undefined ? {} : { name: e.name }),
        ...(e.model === undefined ? {} : { model: e.model }),
        ...(e.parentAgentId === undefined ? {} : { parentAgentId: e.parentAgentId }),
        ...(taskId === undefined ? {} : { taskId }),
      }
      await update($, agents, list => [...list, run].slice(-60))
      await update($, turn, value =>
        value.isWorking ? { ...value, agents: value.agents + 1 } : value,
      )
      await note($, 'agent', `Agent started: ${label}`)
      await move($)
      await refresh($, shouldAutoOpen)
    } catch (error) {
      say($, 'agent.spawn', error)
    }

    const started = await next(e)
    try {
      await update($, agents, list =>
        list.map(one => {
          if (one.key !== key) return one
          if (started.deny !== undefined) {
            return { ...one, status: 'failed' as const, endedAt: startedAt }
          }

          return {
            ...one,
            status: one.status === 'starting' ? ('running' as const) : one.status,
            model: started.model,
            ...(started.agentId === undefined ? {} : { agentId: started.agentId }),
          }
        }),
      )
      await refresh($, false)
    } catch (error) {
      say($, 'agent.spawn', error)
    }

    return started
  })

  // Every tool call: an agent's heartbeat and equipment, the files edited,
  // and whatever the call left running in the background.
  on('tool.call', async ($, e, next) => {
    const tool = String(e.tool)
    // The dashboard's own bookkeeping tool is no part of anyone's equipment.
    if (tool === PROJECT_TOOL) return next(e)
    let began = 0
    let kinds: CheckKind[] = []
    try {
      const family = familyOf(tool)
      const { agentId } = e
      began = await $.clock.now()
      const start = { id: e.tool_use_id, tool, agentId: agentId ?? '', call: callOf({ ...e, tool }) }
      await move($, (value, now) => callBegan(value, start, now))
      if (SHELLS.has(tool)) kinds = checksOf(pick(e, 'command') ?? '')
      // A question or a plan waits on the person for as long as its call is in flight.
      const asking = Object.hasOwn(ASKING, tool) ? ASKING[tool] : undefined
      if (asking !== undefined) {
        const detail = asking === 'question' ? firstQuestion(e) : undefined
        await update($, waits, list =>
          addWait(list, {
            kind: asking,
            at: began,
            tool,
            ...(agentId === undefined ? {} : { agentId }),
            ...(detail === undefined ? {} : { detail: clip(detail, 80) }),
          }),
        )
        await refresh($, false)
      }
      if (agentId === undefined) {
        await update($, usage, value => ({
          ...value,
          mainFamilies: bumpFamily(value.mainFamilies, family),
        }))
      } else {
        await update($, agents, list =>
          list.map(run =>
            run.agentId === agentId
              ? {
                  ...run,
                  tools: run.tools + 1,
                  families: bumpFamily(run.families, family),
                  lastTool: tool,
                }
              : run,
          ),
        )
      }
      await update($, turn, value =>
        value.isWorking ? { ...value, tools: value.tools + 1 } : value,
      )
      if (family === 'edit') {
        const path = pick(e, 'file_path') ?? pick(e, 'notebook_path')
        if (path !== undefined) await update($, files, list => hitFile(list, path))
      }
    } catch (error) {
      say($, 'tool.call', error)
    }

    const ran = await next(e)
    try {
      const { agentId } = e
      await endWaits($, tool, agentId)
      await move($, (value, now) => callEnded(value, e.tool_use_id, now))
      const at = await $.clock.now()
      // A check is told by its command, its result by how the call ended.
      const hasPassed = kinds.length === 0 ? undefined : outcomeOf(ran, e)
      if (hasPassed !== undefined) {
        const before = await read($, checks)
        const command = clip(pick(e, 'command') ?? '', 200)
        await update($, checks, list => recordChecks(list, kinds, { hasPassed, at, ms: at - began, command }))
        await move($, (value, now) => checkRan(value, kinds, hasPassed, now))
        // One toast as a check starts failing, none for each run while it stays so.
        const broken = kinds.filter(
          kind => !hasPassed && before.find(check => check.kind === kind)?.hasPassed !== false,
        )
        if (broken.length > 0) {
          const names = broken.map(kind => CHECK_LABEL[kind]).join(', ')
          await note($, 'check', `Check failed: ${names}`)
          $.ui.toast(`Check failed: ${names}`)
        }
        // A passing test run speaks for the finished work nobody has judged.
        if (hasPassed && kinds.includes('test')) await update($, tasks, list => judgeByChecks(list, at))
        await refresh($, false)
      }
      if (ran.deny === undefined && ran.isError !== true && EDITS.has(tool)) {
        const stale = await update($, checks, noteEdit)
        // A task lives in the district of the code edited for it.
        const path = pick(e, 'file_path') ?? pick(e, 'notebook_path')
        if (here.root === '') here = { ...here, root: await rootOf($).catch(() => '') }
        const area = path === undefined || here.root === '' ? undefined : areaOfPath(path, here.root)
        const taskId = taskOfEdit(await read($, tasks), await read($, agents), agentId)
        if (area !== undefined && taskId !== undefined) {
          await update($, tasks, list => noteTouch(list, taskId, area))
        }
        if (stale.length > 0) await refresh($, false)
      }
    } catch (error) {
      say($, 'tool.call', error)
    }
    try {
      if (ran.deny === undefined && ran.isError !== true && BACKGROUND.has(tool)) {
        const at = await $.clock.now()
        const { result } = ran
        const started = (id: string, kind: Proc['kind'], label: string): Proc => ({
          id,
          kind,
          label: clip(label, 80),
          status: 'running',
          startedAt: at,
        })
        const shell = pick(result, 'backgroundTaskId')
        const taskId = pick(result, 'taskId')
        let proc: Proc | undefined
        if (shell !== undefined) {
          proc = started(shell, 'shell', pick(e, 'description') ?? pick(e, 'command') ?? tool)
        } else if (tool === 'Monitor' && taskId !== undefined) {
          proc = started(taskId, 'monitor', pick(e, 'description') ?? 'monitor')
        } else if (tool === 'Workflow' && taskId !== undefined) {
          proc = started(taskId, 'workflow', pick(result, 'workflowName') ?? 'workflow')
        } else if (tool === 'CronCreate') {
          const id = pick(result, 'id')
          if (id !== undefined) {
            proc = started(
              id,
              'cron',
              `${pick(result, 'humanSchedule') ?? ''} · ${pick(e, 'prompt') ?? ''}`,
            )
          }
        }
        if (proc !== undefined) {
          const added = proc
          await update($, procs, list => upsertProc(list, added))
          await note($, 'process', `Started ${added.kind}: ${added.label}`)
        }
        const stopped =
          tool === 'TaskStop' ? pick(result, 'task_id') : tool === 'CronDelete' ? pick(result, 'id') : undefined
        if (stopped !== undefined) {
          await update($, procs, list => endProc(list, stopped, 'stopped', at))
        }
      }
    } catch (error) {
      say($, 'tool.call', error)
    }

    return ran
  })

  // A flow skill invoked in the main loop, or typed as a slash command,
  // starts its phase; one off the table leaves the phase as it was.
  on('tool.call', { tool: 'Skill' }, async ($, e, next) => {
    if (e.agentId === undefined) await startPhase($, e.skill)

    return next(e)
  })

  on('tool.call', { tool: 'TodoWrite' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      if (ran.deny === undefined && ran.isError !== true) {
        const { agentId } = e
        const owner = (await read($, agents)).find(run => run.agentId === agentId)
        const before = taskStats(await read($, tasks)).done
        const after = await update($, tasks, list =>
          mergeTodos(list, e.todos, agentId, agentId === undefined ? undefined : owner?.taskId),
        )
        await countDone($, taskStats(after).done - before)
        await refresh($, shouldAutoOpen)
      }
    } catch (error) {
      say($, 'TodoWrite', error)
    }

    return ran
  })

  on('tool.call', { tool: 'TaskCreate' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      if (ran.deny === undefined && ran.isError !== true) {
        const { agentId } = e
        const owner = (await read($, agents)).find(run => run.agentId === agentId)
        const parentId = agentId === undefined ? undefined : owner?.taskId
        const draft = {
          id: ran.result.task.id,
          subject: e.subject,
          metadata: e.metadata,
          ...(e.activeForm === undefined ? {} : { activeForm: e.activeForm }),
          ...(agentId === undefined ? {} : { agentId }),
          ...(parentId === undefined ? {} : { parentId }),
        }
        await update($, tasks, list => createTask(list, draft))
        await refresh($, shouldAutoOpen)
      }
    } catch (error) {
      say($, 'TaskCreate', error)
    }

    return ran
  })

  on('tool.call', { tool: 'TaskUpdate' }, async ($, e, next) => {
    const ran = await next(e)
    try {
      if (ran.deny === undefined && ran.isError !== true && ran.result.success) {
        const { agentId, taskId, status, owner } = e
        const before = (await read($, tasks)).find(task => task.id === taskId)
        await update($, tasks, list => reopen(list, patchTask(list, e)))
        if (status === 'completed' && before !== undefined && before.status !== 'completed') {
          await note($, 'task', `Task done: ${before.subject}`)
          await countDone($, 1)
        }
        // Whoever takes a task up stands at its building.
        if (status === 'in_progress' || owner !== undefined) {
          await update($, agents, list =>
            list.map(run =>
              isLive(run) &&
              ((agentId !== undefined && run.agentId === agentId && status === 'in_progress') ||
                (owner !== undefined && run.name === owner))
                ? { ...run, taskId }
                : run,
            ),
          )
        }
        await refresh($, shouldAutoOpen)
      }
    } catch (error) {
      say($, 'TaskUpdate', error)
    }

    return ran
  })

  on('skill.prompt', async ($, e, next) => {
    try {
      const { skill } = e
      await update($, skills, value => ({
        ...value,
        used: { ...value.used, [skill]: (value.used[skill] ?? 0) + 1 },
        suggested: value.suggested.filter(name => name !== skill),
      }))
      await note($, 'skill', `Skill used: ${skill}`)
    } catch (error) {
      say($, 'skill.prompt', error)
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    try {
      const before = await read($, usage)
      const tokens = e.context.tokens ?? before.contextTokens
      const limit = zoneLimit(e.context.window, smartZone)
      // One toast per climb past a level; falling below the caution re-arms them.
      const level = zoneOf(tokens, limit)
      const { announced, crossed } = zoneCrossing(before.zoneAnnounced, level)
      await update($, usage, value => ({
        ...value,
        contextTokens: tokens,
        contextWindow: e.context.window,
        contextPercent: e.context.percent ?? value.contextPercent,
        rateLimits: e.rateLimits.map(limit => ({
          kind: limit.kind,
          percentUsed: limit.percentUsed,
          ...(limit.resetsAt === undefined ? {} : { resetsAt: limit.resetsAt }),
        })),
        costUsd: e.cost?.usd ?? value.costUsd,
        zoneLimit: limit,
        zoneAnnounced: announced,
        zoneOwed: zoneOwing(value.zoneOwed, level, crossed),
      }))
      if (crossed !== undefined) {
        $.ui.toast(zoneToast(crossed, tokens, limit))
        await note($, 'context', crossed === 'out' ? 'Out of the smart zone' : 'Smart-zone caution')
        // Leaving the zone while the person is away is worth calling them back for.
        if (crossed === 'out' && workKind(await loadStrip($)) === 'AFK') {
          await raise($, zoneText(nameHere(), tokens, limit))
        }
      }
      const known = await read($, limits)
      const hasLimits = e.rateLimits.length > 0 && (e.changed.includes('rateLimits') || known.length === 0)
      if (hasLimits) await trackLimits($, (await read($, usage)).rateLimits)
      // The status line carries the context reading, so it follows every move.
      if (hasLimits || tokens !== before.contextTokens) await refresh($, false)
    } catch (error) {
      say($, 'session.measure', error)
    }

    return next(e)
  })

  // A tool call held for the person's leave is the plainest "needs you" there is.
  on('classic.PermissionRequest', async ($, e, next) => {
    try {
      const at = await $.clock.now()
      const tool = e.tool_name
      // A question or a plan asked through the permission prompt is still that.
      const kind = (Object.hasOwn(ASKING, tool) ? ASKING[tool] : undefined) ?? 'permission'
      const detail = kind === 'question' ? firstQuestion(e.tool_input) : undefined
      const agentId = e.agent_id
      await update($, waits, list =>
        addWait(list, {
          kind,
          at,
          tool,
          ...(agentId === undefined ? {} : { agentId }),
          ...(detail === undefined ? {} : { detail: clip(detail, 80) }),
        }),
      )
      await refresh($, false)
    } catch (error) {
      say($, 'classic.PermissionRequest', error)
    }

    return next(e)
  })

  on('classic.PermissionDenied', async ($, e, next) => {
    await endWaits($, e.tool_name, e.agent_id).catch(error => say($, 'classic.PermissionDenied', error))

    return next(e)
  })

  on('classic.PostToolUse', async ($, e, next) => {
    await endWaits($, e.tool_name, e.agent_id).catch(error => say($, 'classic.PostToolUse', error))

    return next(e)
  })

  on('classic.PostToolUseFailure', async ($, e, next) => {
    await endWaits($, e.tool_name, e.agent_id).catch(error =>
      say($, 'classic.PostToolUseFailure', error),
    )

    return next(e)
  })

  on('classic.SubagentStop', async ($, e, next) => {
    try {
      const message = e.last_assistant_message
      if (message !== undefined) await settleVerdict($, e.agent_id, message)
    } catch (error) {
      say($, 'classic.SubagentStop', error)
    }

    return next(e)
  })

  // At each stop the engine says what is still in flight: the truth to hold to.
  on('classic.Stop', async ($, e, next) => {
    try {
      const at = await $.clock.now()
      // A stop that names no background list says nothing about what runs.
      const background = e.background_tasks
      const crons = e.session_crons ?? []
      if (background !== undefined) {
        await update($, procs, list => reconcileProcs(list, background, crons, at))
      }
      // An agent whose end was missed is settled by what the engine lists.
      const listed = await $.agent.list()
      await update($, agents, list =>
        list.map(run => {
          const info = listed.find(one => one.id === run.agentId)
          if (!isLive(run) || info === undefined) return run
          if (info.status === 'completed') return { ...run, status: 'done' as const, endedAt: at }
          if (info.status === 'failed' || info.status === 'killed') {
            return { ...run, status: 'failed' as const, endedAt: at }
          }

          return run
        }),
      )
    } catch (error) {
      say($, 'classic.Stop', error)
    }

    return next(e)
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    isBandAsked = true
    measure(`${e.surface}:band`, {
      bodyColumns: e.props.bodyColumns,
      maxRows: e.props.maxRows,
      viewport: e.viewport ?? null,
    })
    const state = await read($, ui)
    if (e.props.hasSurvey || state.isBandHidden) return next(e)

    return band($.ui.resolve(e), await load($, session(), e.props.bodyColumns), actionsOf($))
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    measure(`${e.surface}:pane`, {
      bodyColumns: e.props.bodyColumns,
      bodyRows: e.props.scroll.bodyRows,
      placement: e.props.placement,
      viewport: e.viewport ?? null,
    })
    // The shape of the room under the pane's own two rows, for the city: a
    // remote surface's cells are its code font's, about 0.42 as wide as tall.
    const down = e.props.scroll.bodyRows - 3
    const aspect = down > 4 ? Math.min(4.5, Math.max(0.4, (e.props.bodyColumns * 0.42) / down)) : undefined
    const model = await load($, session(), e.props.bodyColumns, aspect)
    // The terminal draws no vector graphics: it gets the city and icons as text.
    const Svg = e.surface === 'terminal' ? undefined : $.ui.resolve(e).Svg

    return pane($.ui.resolve(e), model, actionsOf($), Svg)
  })
}
