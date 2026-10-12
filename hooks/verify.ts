import type { AgentRun, Task, Verdict } from '../types'

import { matchTask } from './logic'

export type { Verdict } from '../types'

// A task that may carry a verdict: the contract's own task now.
export type JudgedTask = Task

// "Claude said it is done" and "something checked it" are different things:
// open work, work done but never checked, and work a check confirmed or refuted.
export type Standing = 'open' | 'unchecked' | 'verified' | 'refuted'

// ------------------------------------------------------------------ verifier

// The part after the last colon is the agent's own name: `polis:verifier`.
export const isVerifier = (type: string): boolean =>
  /^verif/i.test(type.slice(type.lastIndexOf(':') + 1))

// Whole upper-case words are how a verifier shouts its answer; the lower-case
// form counts only after the word "verdict", so running prose ("passes",
// "failure", "password") never reads as one.
const PASSED = [/\bPASS(?:ED)?\b/, /\bverdict\W{1,4}pass(?:ed)?\b/i]
const FAILED = [/\bFAIL(?:ED)?\b/, /\bverdict\W{1,4}fail(?:ed)?\b/i]

const said = (message: string, patterns: readonly RegExp[]): boolean =>
  patterns.some(pattern => pattern.test(message))

// A verifier's final message, read for its answer. A fail anywhere wins: one
// failed claim is enough to refute the work.
export const verdictOf = (message: string): 'passed' | 'failed' | undefined => {
  if (said(message, FAILED)) return 'failed'

  return said(message, PASSED) ? 'passed' : undefined
}

// The task a verifier's verdict is about: the one it was given, else the best
// match of its brief, finished work first since that is what gets verified.
export const taskToJudge = (tasks: readonly Task[], run: AgentRun): string | undefined => {
  if (run.taskId !== undefined && tasks.some(task => task.id === run.taskId)) return run.taskId
  // matchTask reads only unfinished tasks, so the finished ones are shown to it as pending.
  const finished = tasks
    .filter(task => task.status === 'completed')
    .map((task): Task => ({ ...task, status: 'pending' }))

  return matchTask(run.label, finished) ?? matchTask(run.label, tasks)
}

// ------------------------------------------------------------------- verdicts

// Any task may be judged: a verifier can report before the task is marked done.
export const judge = (
  tasks: readonly JudgedTask[],
  taskId: string,
  state: 'passed' | 'failed',
  by: Verdict['by'],
  at: number,
): JudgedTask[] =>
  tasks.map((task): JudgedTask => (task.id === taskId ? { ...task, verdict: { state, by, at } } : task))

// A passing test run speaks for every finished task nobody has judged yet.
// A verifier's word, passed or failed, stands, and an earlier run keeps its time.
export const judgeByChecks = (tasks: readonly JudgedTask[], at: number): JudgedTask[] =>
  tasks.map(
    (task): JudgedTask =>
      task.status === 'completed' && task.verdict === undefined
        ? { ...task, verdict: { state: 'passed', by: 'checks', at } }
        : task,
  )

const isStale = (task: JudgedTask): boolean => task.status !== 'completed' && task.verdict !== undefined

// Reopened work is no longer what was checked. The same array comes back when
// nothing was reopened, so a caller can tell by identity that nothing changed.
export const dropStaleVerdicts = (tasks: readonly JudgedTask[]): JudgedTask[] => {
  if (!tasks.some(isStale)) return tasks as JudgedTask[]

  return tasks.map((task): JudgedTask => {
    if (!isStale(task)) return task
    const { verdict: _dropped, ...rest } = task

    return rest
  })
}

// ------------------------------------------------------------------ standing

export const standingOf = (task: JudgedTask): Standing => {
  if (task.status !== 'completed') return 'open'
  if (task.verdict === undefined) return 'unchecked'

  return task.verdict.state === 'passed' ? 'verified' : 'refuted'
}

// The mark builds on the done mark of the text views (✔): doubled when checked,
// crossed like a failed run when refuted. The two-cell ✔✔ is the widest.
export const STANDING: { [S in Standing]: { glyph: string; label: string } } = {
  open: { glyph: '', label: 'open' },
  unchecked: { glyph: '✔', label: 'done, not checked' },
  verified: { glyph: '✔✔', label: 'verified' },
  refuted: { glyph: '✘', label: 'failed its check' },
}

// Counts over the finished tasks; open work has no standing to count.
export const standings = (
  tasks: readonly JudgedTask[],
): { verified: number; unchecked: number; refuted: number } => {
  const counts = { verified: 0, unchecked: 0, refuted: 0 }
  for (const task of tasks) {
    const standing = standingOf(task)
    if (standing !== 'open') counts[standing] += 1
  }

  return counts
}

const NOTE = {
  verifier: { passed: 'verified by a verifier', failed: 'failed its verifier' },
  checks: { passed: 'verified by tests', failed: 'failed its tests' },
} as const

// A few plain words for a tooltip or a report line.
export const verdictNote = (task: JudgedTask): string => {
  if (task.status !== 'completed') return ''
  if (task.verdict === undefined) return 'not checked yet'

  return NOTE[task.verdict.by][task.verdict.state]
}
