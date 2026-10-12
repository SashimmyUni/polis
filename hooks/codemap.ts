import type { AgentRun, FileHit, GitState, Task } from '../types'
import { clip, isLive } from './logic'

export type { GitState } from '../types'

// A task that knows where its area came from: the contract's own task now.
export type CodeTask = Task

// ---------------------------------------------------------------- code areas

// Directories that only hold the real units of a project: the name of the unit
// inside is the better district (`packages/web/...` is `web`, not `packages`).
const CONTAINERS: ReadonlySet<string> = new Set([
  'src', 'lib', 'app', 'apps', 'packages', 'libs', 'services', 'modules', 'crates',
  'cmd', 'internal', 'pkg', 'components',
])

const isDrive = (path: string): boolean => /^[a-z]:/i.test(path)

const isAbsolute = (path: string): boolean => isDrive(path) || /^[\\/]/.test(path)

// The names in a path with `.` and `..` resolved, whichever separator it uses;
// a `..` that climbs out of where the path starts leaves nothing to compare.
const names = (path: string): string[] | undefined => {
  const out: string[] = []
  for (const part of path.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue
    if (part !== '..') out.push(part)
    else if (out.pop() === undefined) return undefined
  }

  return out
}

// The code area of a file: the directory or package its edits land in.
export const areaOfPath = (path: string, root: string): string | undefined => {
  const base = names(root)
  const own = names(path)
  if (base === undefined || own === undefined) return undefined
  // Windows paths differ in case without meaning anything else.
  const fold = (name: string | undefined): string | undefined =>
    isDrive(root) ? name?.toLowerCase() : name
  const inside = base.every((name, at) => fold(name) === fold(own[at]))
  if (isAbsolute(path) && !inside) return undefined
  const rel = isAbsolute(path) ? own.slice(base.length) : own
  const first = rel[0]
  if (first === undefined) return undefined
  if (rel.length === 1) return 'root'
  const unit = CONTAINERS.has(first.toLowerCase()) && rel.length > 2 ? (rel[1] ?? first) : first
  const area = unit.toLowerCase().replace(/^\.+/, '').slice(0, 16)

  return area === '' ? 'root' : area
}

const countOf = (touched: { [area: string]: number } | undefined, area: string): number =>
  touched !== undefined && Object.hasOwn(touched, area) ? (touched[area] ?? 0) : 0

// One more edit of `area` for a task. The task moves to the area it edits most,
// unless a tag gave it its area: that one the model chose and stays.
export const noteTouch = (
  tasks: readonly CodeTask[],
  taskId: string,
  area: string,
): CodeTask[] =>
  tasks.map((task): CodeTask => {
    if (task.id !== taskId) return task
    const touched = { ...task.touched, [area]: countOf(task.touched, area) + 1 }
    if (task.areaFrom === 'tag') return { ...task, touched }
    const entries = Object.entries(touched)
    const top = Math.max(...entries.map(([, count]) => count))
    const leaders = entries.filter(([, count]) => count === top).map(([name]) => name)
    // On a tie the district does not flip back and forth with every edit.
    const next = leaders.includes(task.area) ? task.area : (leaders[0] ?? task.area)

    return { ...task, area: next, areaFrom: 'code', touched }
  })

// The task an edit belongs to. A subagent's edit goes to the task its run was
// matched to, else the one it recorded itself. The main loop's goes to the
// in-progress task that is nobody else's: the last one when several are.
export const taskOfEdit = (
  tasks: readonly Task[],
  agents: readonly AgentRun[],
  agentId: string | undefined,
): string | undefined => {
  const live = agents.filter(isLive)
  const active = tasks.filter(task => task.status === 'in_progress')
  if (agentId !== undefined) {
    const run = live.find(one => one.agentId === agentId && one.taskId !== undefined)

    return run?.taskId ?? active.filter(task => task.agentId === agentId).at(-1)?.id
  }
  const claimed = new Set(live.map(run => run.taskId))

  return active.filter(task => task.agentId === undefined && !claimed.has(task.id)).at(-1)?.id
}

export type AreaEdits = { area: string; files: number; edits: number }

// The session's edited files grouped by area, the busiest area first. Files
// outside the project (a note in a home directory, a temp file) are no district.
export const areasOfFiles = (files: readonly FileHit[], root: string): AreaEdits[] => {
  const groups = new Map<string, AreaEdits>()
  for (const file of files) {
    const area = areaOfPath(file.path, root)
    if (area === undefined) continue
    const group = groups.get(area) ?? { area, files: 0, edits: 0 }
    group.files += 1
    group.edits += file.edits
    groups.set(area, group)
  }

  return [...groups.values()].sort((a, b) => b.edits - a.edits)
}

// ----------------------------------------------------------------------- git

// Plain-text forms: `--porcelain=v2` is the one format git promises to keep.
export const GIT_STATUS: readonly string[] = ['git', 'status', '--porcelain=v2', '--branch']

export const GIT_DIFF: readonly string[] = ['git', 'diff', '--shortstat', 'HEAD']

const toCount = (text: string | undefined): number => (text === undefined ? 0 : Number(text))

// What the two commands said. A status with no branch line is not a
// repository (or git failed): there is nothing to show then.
export const parseGit = (status: string, diff: string, at: number): GitState | null => {
  let branch: string | undefined
  let ahead = 0
  let behind = 0
  let files = 0
  let untracked = 0
  for (const line of status.split(/\r?\n/)) {
    if (line.startsWith('# branch.head ')) {
      branch = line.slice('# branch.head '.length).trim()
    } else if (line.startsWith('# branch.ab ')) {
      const counts = /\+(\d+) -(\d+)/.exec(line)
      ahead = toCount(counts?.[1])
      behind = toCount(counts?.[2])
    } else if (/^[12u] /.test(line)) {
      files += 1
    } else if (line.startsWith('? ')) {
      untracked += 1
    }
  }
  if (branch === undefined || branch === '') return null
  // Git leaves a count out of the summary when it is zero.
  const added = toCount(/(\d+) insertions?\(\+\)/.exec(diff)?.[1])
  const removed = toCount(/(\d+) deletions?\(-\)/.exec(diff)?.[1])

  return { branch, ahead, behind, files, added, removed, untracked, at }
}

// One row for the band: `main ↑1 ↓2 · 5 files +120 −34 · 2 untracked`.
export const gitLine = (git: GitState): string => {
  const where = [clip(git.branch, 24)]
  if (git.ahead > 0) where.push(`↑${git.ahead}`)
  if (git.behind > 0) where.push(`↓${git.behind}`)
  const delta = `+${git.added} −${git.removed}`
  const changed =
    git.files > 0
      ? `${git.files} ${git.files === 1 ? 'file' : 'files'} ${delta}`
      : git.added + git.removed > 0
        ? delta
        : ''
  const loose = git.untracked > 0 ? `${git.untracked} untracked` : ''
  const parts = [where.join(' '), changed, loose].filter(part => part !== '')

  return (changed === '' && loose === '' ? [...parts, 'clean'] : parts).join(' · ')
}
