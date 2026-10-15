import type { Archive, ArchiveEntry, Task } from '../types'
import { clip } from './logic'

// A pure module: the project's archive, every task it has finished, kept in
// the store under the project's root and read back by every later session.
// The newest ARCHIVE_KEEP are kept in full; older ones fold into an exact
// count per district (ADR 0002). Nothing here touches the engine.

export type { Archive, ArchiveEntry } from '../types'

export const ARCHIVE_KEEP = 2000

export const EMPTY_ARCHIVE: Archive = { entries: [], folded: {} }

// Bounds on what a saved archive may hold: it is read back untrusted.
const MAX_AREAS = 200
const MAX_COUNT = 1_000_000_000

const text = (bag: { [key: string]: unknown }, key: string, max: number): string | undefined => {
  const value = bag[key]
  if (typeof value !== 'string') return undefined
  const trimmed = value.trim()

  return trimmed === '' ? undefined : trimmed.slice(0, max)
}

const asEntry = (raw: unknown): ArchiveEntry | undefined => {
  if (typeof raw !== 'object' || raw === null) return undefined
  const bag = raw as { [key: string]: unknown }
  const id = text(bag, 'id', 80)
  const subject = text(bag, 'subject', 240)
  const sessionId = text(bag, 'sessionId', 80)
  const doneAt = typeof bag.doneAt === 'number' && Number.isFinite(bag.doneAt) ? bag.doneAt : undefined
  if (id === undefined || subject === undefined || sessionId === undefined || doneAt === undefined) {
    return undefined
  }
  const verdict = (['passed', 'failed'] as const).find(one => one === bag.verdict)

  return {
    id,
    subject: clip(subject, 240),
    area: text(bag, 'area', 24) ?? 'general',
    doneAt,
    sessionId,
    ...(verdict === undefined ? {} : { verdict }),
  }
}

// The archive as the store kept it, held to the contract's shape: anything
// malformed is dropped, never thrown on.
export const asArchive = (saved: unknown): Archive => {
  if (typeof saved !== 'object' || saved === null) return EMPTY_ARCHIVE
  const bag = saved as { entries?: unknown; folded?: unknown }
  const seen = new Set<string>()
  const entries = (Array.isArray(bag.entries) ? bag.entries.slice(-ARCHIVE_KEEP) : [])
    .flatMap(raw => asEntry(raw) ?? [])
    .filter(entry => (seen.has(entry.id) ? false : (seen.add(entry.id), true)))
  const folded: { [area: string]: number } = {}
  if (typeof bag.folded === 'object' && bag.folded !== null) {
    for (const [area, count] of Object.entries(bag.folded).slice(0, MAX_AREAS)) {
      if (typeof count !== 'number' || !Number.isFinite(count) || count <= 0) continue
      folded[area.slice(0, 24)] = Math.min(MAX_COUNT, Math.floor(count))
    }
  }

  return { entries, folded }
}

// The id a task is archived under: the one a later session carries it as.
// A session numbers its own tasks from one, so its own are marked with it.
export const archivedId = (task: Task, sessionId: string): string =>
  task.sessionId === undefined ? `${sessionId.slice(0, 8)}/${task.id}` : task.id

// The oldest entries past the cap, folded into their districts' counts.
export const foldArchive = (archive: Archive): Archive => {
  if (archive.entries.length <= ARCHIVE_KEEP) return archive
  const sorted = [...archive.entries].sort((a, b) => a.doneAt - b.doneAt)
  const cut = sorted.length - ARCHIVE_KEEP
  const folded = { ...archive.folded }
  for (const entry of sorted.slice(0, cut)) folded[entry.area] = (folded[entry.area] ?? 0) + 1

  return { entries: sorted.slice(cut), folded }
}

// The archive brought in line with the board: finished tasks added once,
// reopened ones taken out (they show as open work instead), the oldest
// folded. The same archive back when nothing changed, so a caller can skip
// the write.
export const syncArchive = (archive: Archive, board: readonly Task[], sessionId: string): Archive => {
  const open = new Set(
    board.filter(task => task.status !== 'completed').map(task => archivedId(task, sessionId)),
  )
  const kept = archive.entries.filter(entry => !open.has(entry.id))
  const known = new Set(kept.map(entry => entry.id))
  const added: ArchiveEntry[] = []
  for (const task of board) {
    if (task.status !== 'completed' || task.doneAt === undefined) continue
    const id = archivedId(task, sessionId)
    if (known.has(id)) continue
    known.add(id)
    added.push({
      id,
      subject: clip(task.subject, 240),
      area: task.area.slice(0, 24),
      doneAt: task.doneAt,
      sessionId: task.sessionId ?? sessionId,
      ...(task.verdict === undefined ? {} : { verdict: task.verdict.state }),
    })
  }
  if (added.length === 0 && kept.length === archive.entries.length) return archive

  return foldArchive({ entries: [...kept, ...added], folded: archive.folded })
}

// How many finished tasks the archive stands for, district by district.
export const archiveCounts = (archive: Archive): { [area: string]: number } => {
  const counts = { ...archive.folded }
  for (const entry of archive.entries) counts[entry.area] = (counts[entry.area] ?? 0) + 1

  return counts
}
