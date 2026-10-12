import type { AgentRun, FileHit, Project, Task, Usage } from '../types'
import { clip, compact, hotFiles, taskStats, taskTree } from './logic'

export type ReportInput = {
  now: number
  project: Project | null
  /** The repository root, so paths print relative to it. */
  root?: string
  tasks: (Omit<Task, 'verdict'> & { verdict?: { state: 'passed' | 'failed'; by: string } })[]
  agents: AgentRun[]
  files: FileHit[]
  usage: Usage
  /** Prompts answered this session, when known. */
  turns?: number
  checks?: { kind: string; state: 'passed' | 'failed' | 'stale'; command: string; at: number }[]
  git?: { branch: string; files: number; added: number; removed: number; untracked: number } | null
  limits?: { label: string; percentUsed: number; note?: string }[]
}

// The name a saved report goes by.
export const REPORT_FILE: string = 'polis-report.md'

type Git = NonNullable<ReportInput['git']>
type Check = NonNullable<ReportInput['checks']>[number]
type Verdict = NonNullable<ReportInput['tasks'][number]['verdict']>
type Row = ReturnType<typeof taskTree>[number]
type Shelves = { done: Row[]; active: Row[]; waiting: Row[] }

// A report is short enough to paste: the files it lists stop here.
const MAX_FILES = 15

// ---------------------------------------------------------------- formatting

const count = (n: number, noun: string): string => `${n} ${noun}${n === 1 ? '' : 's'}`

// UTC, as the date in `now` is: the same report reads the same anywhere.
const dayOf = (at: number): string => {
  const date = new Date(at)

  return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10)
}

// How long before the report, as a person says it. `elapsed` counts a
// duration to the second, which is too exact for "when did the tests run".
const ago = (ms: number): string => {
  const seconds = Math.max(0, Math.floor(ms / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)

  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`
}

// A path as a pull request shows it: from the root, forward slashes. A
// Windows root ignores case, as the file system does.
const relativeTo = (path: string, root: string | undefined): string => {
  const flat = path.replace(/\\/g, '/')
  const base = (root ?? '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (base === '') return flat
  const head = flat.slice(0, base.length + 1)
  const same = /^[a-z]:/i.test(base)
    ? head.toLowerCase() === `${base}/`.toLowerCase()
    : head === `${base}/`

  return same ? flat.slice(base.length + 1) : flat
}

// A pipe would end a table cell early.
const cell = (text: string): string => text.replace(/\|/g, '\\|')

// Code in backticks, so `[id].tsx` and `my_file.ts` print as written.
const code = (text: string): string => `\`${text.replace(/`/g, "'")}\``

const dollars = (usd: number): string => `$${usd.toFixed(2)}`

// ------------------------------------------------------------------- header

const changeOf = (git: Git): string => {
  const parts: string[] = []
  if (git.files > 0) parts.push(`${count(git.files, 'file')} changed, +${git.added} -${git.removed}`)
  if (git.untracked > 0) parts.push(`${git.untracked} untracked`)

  return parts.length === 0 ? 'clean' : parts.join(', ')
}

const headerOf = (input: ReportInput): string[] => {
  const { project } = input
  const git = input.git ?? null
  const name = project === null ? '' : clip(project.name, 60)
  const phase = project === null ? '' : clip(project.phase, 60)
  const branch = git === null ? '' : git.branch === '' ? 'detached HEAD' : `branch ${git.branch}`
  const facts = [dayOf(input.now), phase, git === null ? '' : `${branch} (${changeOf(git)})`].filter(
    fact => fact !== '',
  )

  return [
    name === '' ? '# Session report' : `# ${name} — session report`,
    ...(facts.length === 0 ? [] : ['', facts.join(' · ')]),
  ]
}

// -------------------------------------------------------------------- tasks

// Each top-level task with its sub-tasks, filed by the top-level task's state:
// a sub-task is read in its parent's company.
const shelve = (rows: readonly Row[]): Shelves => {
  const shelves: Shelves = { done: [], active: [], waiting: [] }
  let shelf = shelves.waiting
  for (const row of rows) {
    if (row.depth === 0) {
      shelf =
        row.task.status === 'completed'
          ? shelves.done
          : row.task.status === 'in_progress'
            ? shelves.active
            : shelves.waiting
    }
    shelf.push(row)
  }

  return shelves
}

// A top-level task is a checkbox only under Done; a sub-task always shows its
// own state, so a half-finished task reads as what is left of it.
const taskLine = (row: Row, verdict: Verdict | undefined, isChecklist: boolean): string => {
  const { task, depth } = row
  const mark = depth > 0 || isChecklist ? (task.status === 'completed' ? '[x] ' : '[ ] ') : ''
  const area = task.area === '' ? '' : ` (${task.area})`
  const note =
    verdict === undefined ? '' : verdict.state === 'passed' ? ' — verified' : ' — failed its check'

  return `${'  '.repeat(depth)}- ${mark}${clip(task.subject, 100)}${area}${note}`
}

// ------------------------------------------------------------------- checks

// The latest run of each kind: a check that ran twice is told by its second run.
const latestChecks = (checks: readonly Check[]): Check[] => {
  const latest = new Map<string, Check>()
  for (const check of checks) {
    const before = latest.get(check.kind)
    if (before === undefined || check.at >= before.at) latest.set(check.kind, check)
  }

  return [...latest.values()]
}

const checksTable = (checks: readonly Check[], now: number): string[] =>
  checks.length === 0
    ? []
    : [
        '| Check | Result | Command | When |',
        '| --- | --- | --- | --- |',
        ...checks.map(
          check =>
            `| ${cell(check.kind)} | ${check.state} | ` +
            `${check.command === '' ? '' : code(cell(clip(check.command, 60)))} | ${ago(now - check.at)} |`,
        ),
      ]

// ------------------------------------------------------------------- report

const block = (title: string, lines: readonly string[]): string[] =>
  lines.length === 0 ? [] : [`## ${title}`, '', ...lines]

const summaryOf = (
  input: ReportInput,
  roots: readonly Task[],
  verdicts: ReadonlyMap<string, Verdict | undefined>,
  checks: readonly Check[],
): string[] => {
  const stats = taskStats(roots)
  const states = roots
    .filter(task => task.status === 'completed')
    .map(task => verdicts.get(task.id)?.state)
  const verified = states.filter(state => state === 'passed').length
  const failed = states.filter(state => state === 'failed').length
  const outcome = [
    ...(verified > 0 ? [`${verified} verified`] : []),
    ...(failed > 0 ? [`${failed} ${failed === 1 ? 'failed its check' : 'failed their check'}`] : []),
  ]
  const tasks = [
    `${stats.done} of ${stats.total} done${outcome.length === 0 ? '' : ` (${outcome.join(', ')})`}`,
    ...(stats.active > 0 ? [`${stats.active} in progress`] : []),
    ...(stats.waiting > 0 ? [`${stats.waiting} waiting`] : []),
  ]
  const edits = input.files.reduce((sum, file) => sum + file.edits, 0)
  const cost = [
    dollars(input.usage.costUsd),
    `${compact(input.usage.sessionTokens)} tokens`,
    input.agents.length === 0 ? 'no agents' : count(input.agents.length, 'agent'),
    ...(input.turns === undefined ? [] : [count(input.turns, 'prompt')]),
  ]

  return [
    ...(stats.total === 0 ? [] : [`- Tasks: ${tasks.join(' · ')}`]),
    ...(input.files.length === 0
      ? []
      : [`- Files: ${count(input.files.length, 'file')} edited, ${count(edits, 'edit')}`]),
    ...(checks.length === 0
      ? []
      : [`- Checks: ${checks.map(check => `${check.kind} ${check.state}`).join(' · ')}`]),
    `- Cost: ${cost.join(' · ')}`,
  ]
}

const filesOf = (input: ReportInput): string[] => {
  const ranked = hotFiles(input.files, input.files.length)
  const more = ranked.length - MAX_FILES

  return [
    ...ranked
      .slice(0, MAX_FILES)
      .map(file => `- ${code(relativeTo(file.path, input.root))} — ${count(file.edits, 'edit')}`),
    // A bullet, so Markdown does not fold the line into the one above it.
    ...(more > 0 ? [`- and ${more} more`] : []),
  ]
}

const usageOf = (input: ReportInput): string[] => {
  const { usage } = input
  const held =
    usage.contextWindow > 0
      ? ` (${compact(usage.contextTokens)} of ${compact(usage.contextWindow)} tokens)`
      : ''

  return [
    `- Context window: ${Math.round(usage.contextPercent)}%${held}`,
    ...(input.limits ?? []).map(
      limit =>
        `- ${clip(limit.label, 40)}: ${Math.round(limit.percentUsed)}% used` +
        `${limit.note === undefined || limit.note === '' ? '' : ` (${clip(limit.note, 60)})`}`,
    ),
    `- Session cost: ${dollars(usage.costUsd)} (${compact(usage.sessionTokens)} tokens)`,
  ]
}

// The session as GitHub-flavoured Markdown, for a pull request or a stand-up
// note. A section with nothing to say is left out.
export const reportOf = (input: ReportInput): string => {
  // The verdicts are read from their own map: the tree takes the tasks bare.
  const rows = taskTree(input.tasks.map(({ verdict: _verdict, ...task }): Task => task))
  const shelves = shelve(rows)
  const verdicts = new Map(input.tasks.map(task => [task.id, task.verdict] as const))
  const lines = (list: readonly Row[], isChecklist: boolean): string[] =>
    list.map(row => taskLine(row, verdicts.get(row.task.id), isChecklist))
  const checks = latestChecks(input.checks ?? [])
  const roots = rows.filter(row => row.depth === 0).map(row => row.task)

  const blocks = [
    headerOf(input),
    block('Summary', summaryOf(input, roots, verdicts, checks)),
    block('Done', lines(shelves.done, true)),
    block('In progress', lines(shelves.active, false)),
    block('Not started', lines(shelves.waiting, false)),
    block('Files changed', filesOf(input)),
    block('Checks', checksTable(checks, input.now)),
    block('Usage', usageOf(input)),
  ]

  return `${blocks
    .filter(one => one.length > 0)
    .map(one => one.join('\n'))
    .join('\n\n')}\n`
}
