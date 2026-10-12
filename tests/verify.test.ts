import { expect, test } from 'claude-code/testing'

import {
  dropStaleVerdicts,
  isVerifier,
  judge,
  judgeByChecks,
  standingOf,
  standings,
  STANDING,
  taskToJudge,
  verdictNote,
  verdictOf,
} from '../hooks/verify'
import type { JudgedTask } from '../hooks/verify'
import type { AgentRun, Task, TaskStatus } from '../types'

const task = (id: string, subject: string, status: TaskStatus): Task => ({
  id,
  subject,
  status,
  area: 'general',
  blockedBy: [],
  source: 'task',
})

const run = (label: string, taskId?: string): AgentRun => ({
  key: 'run-1',
  label,
  type: 'polis:verifier',
  status: 'running',
  tools: 0,
  families: {},
  tokens: 0,
  startedAt: 0,
  ...(taskId === undefined ? {} : { taskId }),
})

test('a verifier is told by its own name, not by what surrounds it', () => {
  expect(isVerifier('polis:verifier')).toBe(true)
  expect(isVerifier('verifier')).toBe(true)
  expect(isVerifier('Verification')).toBe(true)
  expect(isVerifier('a:b:VERIFY')).toBe(true)
  expect(isVerifier('code-reviewer')).toBe(false)
  expect(isVerifier('general-purpose')).toBe(false)
  // The prefix is of the name after the last colon, not of the whole type.
  expect(isVerifier('verifier:worker')).toBe(false)
  expect(isVerifier('polis:')).toBe(false)
  expect(isVerifier('')).toBe(false)
})

test('a verdict is read from a verifier message, and prose words are not one', () => {
  expect(verdictOf('PASS')).toBe('passed')
  expect(verdictOf('All 29 tests ran.\n\nPASSED - nothing missing')).toBe('passed')
  expect(verdictOf('FAIL: the parser drops a token')).toBe('failed')
  expect(verdictOf('The check FAILED at step 2')).toBe('failed')
  expect(verdictOf('verdict: pass')).toBe('passed')
  expect(verdictOf('Verdict: Passed')).toBe('passed')
  expect(verdictOf('**Verdict:** fail')).toBe('failed')
  expect(verdictOf('VERDICT: fail')).toBe('failed')

  // One failure outweighs any number of passes.
  expect(verdictOf('PASS on build, FAIL on tests')).toBe('failed')
  expect(verdictOf('verdict: pass\nbut also FAIL for the docs')).toBe('failed')

  // Words that only look like a verdict.
  expect(verdictOf('The PASSWORD field is validated')).toBeUndefined()
  expect(verdictOf('every test passes and nothing fails')).toBeUndefined()
  expect(verdictOf('there was a failure in the parser')).toBeUndefined()
  expect(verdictOf('pass fail passed failed')).toBeUndefined()
  expect(verdictOf('verdict: passwords were checked')).toBeUndefined()
  expect(verdictOf('verdict: failure to launch')).toBeUndefined()
  expect(verdictOf('The BYPASS flag')).toBeUndefined()
  expect(verdictOf('')).toBeUndefined()
})

test('the task a verdict is about: the run\'s own, else the best match of its brief', () => {
  const list = [
    task('1', 'Write the parser tests', 'completed'),
    task('2', 'Build the lexer', 'completed'),
    task('3', 'Deploy the site', 'in_progress'),
    task('4', 'Document the lexer', 'pending'),
  ]
  // The run says which task it is about, and that task exists.
  expect(taskToJudge(list, run('anything at all', '2'))).toBe('2')
  // The run names a task that is gone: its brief decides instead.
  expect(taskToJudge(list, run('Verify the parser tests', 'gone'))).toBe('1')
  // No id: the brief decides.
  expect(taskToJudge(list, run('Verify the parser tests'))).toBe('1')
  // Finished work is preferred over an open task that matches as well.
  expect(taskToJudge(list, run('Verify the lexer'))).toBe('2')
  // Nothing finished matches: an open task can still be judged early.
  expect(taskToJudge(list, run('Verify the site is deployed'))).toBe('3')
  // Nothing matches at all, and one task in progress is the guess.
  expect(taskToJudge(list, run('Something unrelated'))).toBe('3')
  expect(taskToJudge(list.slice(0, 2), run('Something unrelated'))).toBeUndefined()
  expect(taskToJudge([], run('Verify the parser tests'))).toBeUndefined()
})

test('judging sets a verdict on any task, never mutating, in order', () => {
  const list: JudgedTask[] = [
    task('1', 'Done', 'completed'),
    task('2', 'Underway', 'in_progress'),
    task('3', 'Waiting', 'pending'),
  ]
  const frozen = JSON.stringify(list)

  const done = judge(list, '1', 'passed', 'verifier', 10)
  expect(done.map(one => one.id)).toEqual(['1', '2', '3'])
  expect(done[0]?.verdict).toEqual({ state: 'passed', by: 'verifier', at: 10 })
  expect(done[1]).toBe(list[1])
  expect(done[2]).toBe(list[2])

  // A verifier may report before the task is marked done.
  expect(judge(list, '2', 'failed', 'verifier', 11)[1]?.verdict).toEqual({
    state: 'failed',
    by: 'verifier',
    at: 11,
  })
  expect(judge(list, '3', 'passed', 'checks', 12)[2]?.verdict?.by).toBe('checks')

  // A later verdict replaces an earlier one.
  const again = judge(done, '1', 'failed', 'verifier', 20)
  expect(again[0]?.verdict).toEqual({ state: 'failed', by: 'verifier', at: 20 })

  // An unknown id leaves every task as it was, in a new array.
  const same = judge(list, 'nope', 'passed', 'verifier', 30)
  expect(same).toEqual(list)
  expect(same === list).toBe(false)
  expect(same[0]).toBe(list[0])

  expect(JSON.stringify(list)).toBe(frozen)
  expect(done[0] === list[0]).toBe(false)
})

test('a passing test run vouches for unjudged finished work, never over a verifier', () => {
  const list: JudgedTask[] = [
    task('1', 'Done, unjudged', 'completed'),
    task('2', 'Done, refuted by a verifier', 'completed'),
    task('3', 'Done, confirmed by a verifier', 'completed'),
    task('4', 'Done, checked by an earlier run', 'completed'),
    task('5', 'Underway', 'in_progress'),
    task('6', 'Waiting', 'pending'),
  ]
  const judged = judge(
    judge(judge(list, '2', 'failed', 'verifier', 5), '3', 'passed', 'verifier', 6),
    '4',
    'passed',
    'checks',
    7,
  )
  const frozen = JSON.stringify(judged)

  const after = judgeByChecks(judged, 100)
  expect(after[0]?.verdict).toEqual({ state: 'passed', by: 'checks', at: 100 })
  // A verifier's failed verdict survives a passing run.
  expect(after[1]?.verdict).toEqual({ state: 'failed', by: 'verifier', at: 5 })
  expect(after[2]?.verdict).toEqual({ state: 'passed', by: 'verifier', at: 6 })
  // An earlier run keeps its own time.
  expect(after[3]?.verdict).toEqual({ state: 'passed', by: 'checks', at: 7 })
  // Work not finished is not vouched for.
  expect(after[4]?.verdict).toBeUndefined()
  expect(after[5]?.verdict).toBeUndefined()
  expect(after.map(one => one.id)).toEqual(['1', '2', '3', '4', '5', '6'])

  expect(JSON.stringify(judged)).toBe(frozen)
  expect(judgeByChecks([], 1)).toEqual([])
})

test('a reopened task loses its verdict, and nothing else does', () => {
  const list: JudgedTask[] = judgeByChecks(
    [task('1', 'Stays done', 'completed'), task('2', 'Reopened', 'completed'), task('3', 'Never done', 'pending')],
    50,
  )
  // Nothing was reopened: the very same array comes back.
  expect(dropStaleVerdicts(list)).toBe(list)

  const reopened = list.map(one => (one.id === '2' ? { ...one, status: 'in_progress' as const } : one))
  const frozen = JSON.stringify(reopened)
  const next = dropStaleVerdicts(reopened)
  expect(next === reopened).toBe(false)
  expect(next.map(one => one.id)).toEqual(['1', '2', '3'])
  expect(next[0]?.verdict).toEqual({ state: 'passed', by: 'checks', at: 50 })
  expect(next[1]?.status).toBe('in_progress')
  expect(next[1]?.verdict).toBeUndefined()
  expect(next[1] !== undefined && 'verdict' in next[1]).toBe(false)
  expect(next[2]).toBe(reopened[2])
  expect(JSON.stringify(reopened)).toBe(frozen)

  // A verdict held by a task that is not done is stale, whenever it arrived.
  const failed = judge([task('9', 'Fixing', 'pending')], '9', 'failed', 'verifier', 1)
  expect(dropStaleVerdicts(failed)[0]?.verdict).toBeUndefined()
  expect(dropStaleVerdicts([])).toEqual([])
})

test('standing: open, unchecked, verified or refuted, with its mark and its words', () => {
  const open = task('1', 'Pending', 'pending')
  const active = task('2', 'Underway', 'in_progress')
  const unchecked = task('3', 'Said done', 'completed')
  const byVerifier = judge([unchecked], '3', 'passed', 'verifier', 1)[0]
  const byTests = judge([unchecked], '3', 'passed', 'checks', 2)[0]
  const refuted = judge([unchecked], '3', 'failed', 'verifier', 3)[0]
  const early = judge([active], '2', 'passed', 'verifier', 4)[0]
  if (byVerifier === undefined || byTests === undefined || refuted === undefined || early === undefined) {
    throw new Error('judge dropped a task')
  }

  expect(standingOf(open)).toBe('open')
  expect(standingOf(active)).toBe('open')
  expect(standingOf(unchecked)).toBe('unchecked')
  expect(standingOf(byVerifier)).toBe('verified')
  expect(standingOf(byTests)).toBe('verified')
  expect(standingOf(refuted)).toBe('refuted')
  // A verdict that came before the work was done does not count until it is.
  expect(standingOf(early)).toBe('open')

  expect(STANDING.verified).toEqual({ glyph: '✔✔', label: 'verified' })
  expect(STANDING.unchecked).toEqual({ glyph: '✔', label: 'done, not checked' })
  expect(STANDING.refuted).toEqual({ glyph: '✘', label: 'failed its check' })
  expect(STANDING.open).toEqual({ glyph: '', label: 'open' })

  expect(standings([])).toEqual({ verified: 0, unchecked: 0, refuted: 0 })
  expect(standings([open, active, early])).toEqual({ verified: 0, unchecked: 0, refuted: 0 })
  expect(standings([open, unchecked, byVerifier, byTests, refuted, early])).toEqual({
    verified: 2,
    unchecked: 1,
    refuted: 1,
  })

  expect(verdictNote(open)).toBe('')
  expect(verdictNote(early)).toBe('')
  expect(verdictNote(unchecked)).toBe('not checked yet')
  expect(verdictNote(byVerifier)).toBe('verified by a verifier')
  expect(verdictNote(byTests)).toBe('verified by tests')
  expect(verdictNote(refuted)).toBe('failed its verifier')
  expect(verdictNote(judge([unchecked], '3', 'failed', 'checks', 5)[0] ?? unchecked)).toBe('failed its tests')
})
