// The pure modules as the hooks module wires them to the engine: checks and
// code areas off tool calls, waits, limits, git, verdicts, the project's log
// and the tasks carried from one session to the next, and the text commands.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { KEEP_DONE, carryTasks, mergeTodos, stampDone } from '../hooks/logic'
import type { ProjectLog, Task } from '../types'

const PANE = {
  title: 'Polis',
  isFocused: false,
  bodyColumns: 70,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

const MOUNT = { plugin: 'polis', component: 'Pane', requestId: 'polis', props: PANE } as const

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const ROOT = '/work/atlas'

type World = {
  calls: string[]
  kept: Record<string, unknown>
  /** The id the engine gives the session: a test moves it to start another. */
  session: { id: string }
  /** The last status line the mod set, or undefined once it cleared it. */
  status: () => string | undefined
  toasts: () => string[]
}

// The engine beneath the mod for a session in /work/atlas, recording what the
// mod asked of it. `surfaces` is what draws: none stands for an editor's chat
// panel, where the status line and the commands' text are all there is.
const world = (
  on: On,
  surfaces: readonly ('terminal' | 'desktop' | 'vscode' | 'mobile')[] = ['vscode'],
  kept: Record<string, unknown> = {},
): World => {
  const calls: string[] = []
  const session = { id: 'session-1' }
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('session.surfaces', () => ({ value: surfaces }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.repo', () => ({ value: null }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: session.id }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 20_000, percent: 10 }, rateLimits: [] },
  }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => {
    calls.push('open')

    return { value: { isPlaced: true } }
  })
  on('ui.status', (_, e) => {
    calls.push(`status:${e.text ?? ''}`)

    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    calls.push(`toast:${e.text}`)

    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('agent.register', (_, e) => ({ value: { agent: e.name } }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'agent-1' }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  let made = 0
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => {
    made += 1

    return { result: { task: { id: String(made), subject: e.subject } } }
  })
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: [] },
  }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never }))

  return {
    calls,
    kept,
    session,
    status: () => {
      const last = calls.filter(call => call.startsWith('status:')).at(-1)

      return last === undefined || last === 'status:' ? undefined : last.slice('status:'.length)
    },
    toasts: () => calls.filter(call => call.startsWith('toast:')).map(call => call.slice('toast:'.length)),
  }
}

const START = { cwd: ROOT, surface: null, isInteractive: false } as const

const turnEnd = (turnId: string) =>
  ({ answer: 'done', durationMs: 4000, isAborted: false, turnId, reason: 'answer' }) as const

const report = async ($: Engine, args = 'report'): Promise<string> =>
  (await $.command.run({ command: 'city', args, ...TYPED })).text ?? ''

const savedTasks = (kept: Record<string, unknown>): Task[] =>
  (kept[`tasks:${ROOT}`] as { tasks: Task[] }).tasks

test('a test command is recorded as a check: failed, then passed, then stale after an edit, and never reaches the status line', async ($, on) => {
  mock.clock(on)
  const { status, toasts } = world(on)
  let runs = 0
  on('tool.call', { tool: 'Bash' }, () => {
    runs += 1

    return runs < 3
      ? ({ result: 'Exit code 1\n3 tests failed', isError: true } as never)
      : { result: { stdout: 'ok', stderr: '', interrupted: false } as never }
  })

  // A command that only mentions the tests runs none.
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b0', command: 'git commit -m "fix npm test"' })
  expect(status()).toBeUndefined()
  runs = 0

  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' })
  expect(status()).toBeUndefined()
  // The check is named once as it starts failing, not again while it stays so.
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b2', command: 'npm test' })
  expect(toasts()).toEqual(['Check failed: tests'])

  await $.tool.call({ tool: 'Bash', tool_use_id: 'b3', command: 'npm test' })
  expect(status()).toBeUndefined()
  expect(await report($)).toContain('| tests | passed | `npm test` |')

  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: `${ROOT}/src/a.ts`, old_string: 'a', new_string: 'b' })
  expect(status()).toBeUndefined()
  expect(await report($)).toContain('| tests | stale | `npm test` |')
})

test('an edit moves a task to the code area it lands in, unless a tag placed it', async ($, on) => {
  mock.clock(on)
  const { kept } = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Build the login form', turnId: 'turn-1' })

  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 't1', subject: 'Build the login form', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't2', taskId: '1', status: 'in_progress' })
  await $.tool.call({
    tool: 'Edit',
    tool_use_id: 'e1',
    file_path: `${ROOT}/packages/web/src/login.ts`,
    old_string: 'a',
    new_string: 'b',
  })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't3', taskId: '1', status: 'completed' })

  await $.tool.call({
    tool: 'TaskCreate',
    tool_use_id: 't4',
    subject: 'Describe the login flow',
    description: '',
    metadata: { area: 'docs' },
  })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't5', taskId: '2', status: 'in_progress' })
  await $.tool.call({
    tool: 'Edit',
    tool_use_id: 'e2',
    file_path: `${ROOT}/packages/api/src/session.ts`,
    old_string: 'a',
    new_string: 'b',
  })
  await $.turn.complete(turnEnd('turn-1'))

  const [form, flow] = savedTasks(kept)
  expect(form).toMatchObject({ id: '1', area: 'web', areaFrom: 'code', touched: { web: 1 } })
  // The model chose this one's area: the edits are counted and it stays.
  expect(flow).toMatchObject({ id: '2', area: 'docs', areaFrom: 'tag', touched: { api: 1 } })
})

test('a permission request needs the person until the tool call ends', async ($, on) => {
  mock.clock(on)
  const { status } = world(on)
  on('classic.PermissionRequest', () => ({}))
  on('classic.PostToolUse', () => ({}))
  on('classic.PermissionDenied', () => ({}))

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  expect(status()).toBe('▲ needs you: permission for Bash')
  await $.classic.PostToolUse({ tool_name: 'Bash', tool_input: {}, tool_response: {}, tool_use_id: 'b1' })
  expect(status()).toBeUndefined()

  await $.classic.PermissionRequest({ tool_name: 'Write', tool_input: {} })
  expect(status()).toBe('▲ needs you: permission for Write')
  await $.classic.PermissionDenied({ tool_name: 'Write', tool_input: {}, tool_use_id: 'w1', reason: 'no' })
  expect(status()).toBeUndefined()
})

test('a question waits on the person while its call is in flight, and the wait leads the status line', async ($, on) => {
  mock.clock(on)
  const { status } = world(on)
  let during: string | undefined
  on('tool.call', { tool: 'AskUserQuestion' }, () => {
    during = status()

    return { result: {} as never }
  })

  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 't1', todos: [{ content: 'One', status: 'pending', activeForm: 'One' }] })
  await $.tool.call({ tool: 'AskUserQuestion', tool_use_id: 'q1', questions: [] } as never)
  expect(during).toBe('▲ needs you: a question for you · 0/1 tasks')
  expect(status()).toBe('0/1 tasks')
})

test('a limit on course to run out before it resets is announced once, and kept for every session', async ($, on) => {
  const clock = mock.clock(on)
  const { kept, status, toasts } = world(on)
  const HOUR = 3_600_000
  const reading = (percentUsed: number) =>
    ({
      context: { window: 200_000, tokens: 20_000, percent: 10 },
      rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt: new Date(clock.now() + 4 * HOUR).toISOString() }],
      changed: ['rateLimits'],
    }) as never

  // A parallel session's earlier reading of the same window is in the store.
  kept.limits = [
    { kind: 'five_hour', resetsAt: new Date(4 * HOUR).toISOString(), samples: [{ at: 0, percent: 40 }], hasWarned: false },
  ]
  const resetsAt = new Date(4 * HOUR).toISOString()
  await clock.advance(12 * 60_000)
  await $.session.measure({ ...(reading(60) as object), rateLimits: [{ kind: 'five_hour', percentUsed: 60, resetsAt }] } as never)
  // Twenty points in twelve minutes: full in twenty-four, hours before the reset.
  expect(toasts()).toHaveLength(1)
  expect(toasts()[0]).toStartWith('The five-hour limit is on course to run out in about ')
  expect(status()).toStartWith('⚠ 5h limit out in ')
  expect(status()).toEndWith(' · ctx 20k')

  await clock.advance(60_000)
  await $.session.measure({ ...(reading(62) as object), rateLimits: [{ kind: 'five_hour', percentUsed: 62, resetsAt }] } as never)
  expect(toasts()).toHaveLength(1)
  expect(kept.limits).toMatchObject([
    { kind: 'five_hour', hasWarned: true, samples: [{ percent: 40 }, { percent: 60 }, { percent: 62 }] },
  ])
})

test('git is asked at the start and as each turn comes back, and never between', async ($, on) => {
  const clock = mock.clock(on)
  world(on)
  const asked: string[] = []
  on('process.run', (_, e) => {
    if (e.argv[0] !== 'git') return { value: { exitCode: 1, stdout: '', stderr: '' } as never }
    asked.push(`${e.argv.slice(0, 2).join(' ')} in ${e.init?.cwd} within ${e.init?.timeoutMs}`)
    const stdout =
      e.argv[1] === 'status'
        ? '# branch.oid abc\n# branch.head main\n1 .M N... 100644 100644 100644 a b src/a.ts\n? notes.txt\n'
        : ' 1 file changed, 12 insertions(+), 3 deletions(-)\n'

    return { value: { exitCode: 0, stdout, stderr: '' } as never }
  })

  await $.session.start(START)
  await clock.settle()
  expect(asked).toEqual([`git status in ${ROOT} within 5000`, `git diff in ${ROOT} within 5000`])
  expect(await report($)).toContain('branch main (1 file changed, +12 -3, 1 untracked)')

  await $.turn.start({ text: 'Tidy up', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: `${ROOT}/src/a.ts`, old_string: 'a', new_string: 'b' })
  await clock.settle()
  expect(asked).toHaveLength(2)
  await $.turn.complete(turnEnd('turn-1'))
  await clock.settle()
  expect(asked).toHaveLength(4)
})

const VERIFIER = {
  tool_use_id: 'a1',
  prompt: 'Check it',
  description: 'Check the parser',
  subagentType: 'polis:verifier',
  provider: { plugin: 'polis', tier: 'user' },
  parentModel: 'opus',
  background: true,
  fork: false,
} as const

test("the status line is the band's list in the band's order, with no checks and no agents running", { timeoutMs: 20_000 }, async ($, on) => {
  const clock = mock.clock(on)
  const { status } = world(on)
  on('classic.PermissionRequest', () => ({}))
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'Exit code 1\n3 tests failed', isError: true }) as never)
  const resetsAt = new Date(4 * 3_600_000).toISOString()
  const reading = (percentUsed: number) =>
    ({
      context: { window: 200_000, tokens: 125_000, percent: 63 },
      rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt }],
      changed: ['context', 'rateLimits'],
    }) as never

  await $.session.start(START)
  await $.turn.start({ text: 'Build the docs site', turnId: 'turn-1' })
  await $.tool.call({
    tool: 'TodoWrite',
    tool_use_id: 't1',
    todos: [
      { content: 'One', status: 'completed', activeForm: 'One' },
      { content: 'Two', status: 'pending', activeForm: 'Two' },
    ],
  })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' })
  await $.agent.spawn({ ...VERIFIER, description: 'Write the docs', subagentType: 'polis:worker' })
  await $.session.measure(reading(40))
  await clock.advance(12 * 60_000)
  await $.session.measure(reading(60))
  // Work that moves is not stalled.
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b2', command: 'ls' })
  // An agent running off the flow is AFK work, first; needs you takes its place.
  expect(status()).toMatch(/^◇ AFK: working · 1 agent · 1\/2 · ⚠ 5h limit out in .+ · ctx 125k · 1\/2 tasks$/)

  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  expect(status()).toMatch(/^▲ needs you: permission for Bash · ⚠ 5h limit out in .+ · ctx 125k · 1\/2 tasks$/)
})

test("a verifier's PASS marks its task verified, and reopening the task takes the mark off", async ($, on) => {
  mock.clock(on)
  world(on)
  on('classic.SubagentStop', () => ({}))

  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 't1', subject: 'Check the parser', description: '' })
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 't2', subject: 'Write the guide', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't3', taskId: '1', status: 'completed' })
  await $.agent.spawn(VERIFIER)
  expect(await report($)).not.toContain('verified')

  await $.classic.SubagentStop({
    stop_hook_active: false,
    agent_id: 'agent-1',
    agent_transcript_path: '',
    agent_type: 'polis:verifier',
    last_assistant_message: 'PASS. Ran the parser tests: 41 passed.',
  })
  expect(await report($)).toContain('- [x] Check the parser (general) — verified')
  expect(await report($)).toContain('1 of 2 done (1 verified)')

  // Another task moving leaves the verdict be; this one reopened loses it.
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't4', taskId: '2', status: 'in_progress' })
  expect(await report($)).toContain('(1 verified)')
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't5', taskId: '1', status: 'in_progress' })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't6', taskId: '1', status: 'completed' })
  expect(await report($)).not.toContain('verified')
})

test("a verifier's FAIL at the end of its turn refutes the task, and passing tests do not overrule it", async ($, on) => {
  mock.clock(on)
  world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } as never }))

  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 't1', subject: 'Check the parser', description: '' })
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 't2', subject: 'Write the guide', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't3', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't4', taskId: '2', status: 'completed' })
  await $.agent.spawn(VERIFIER)
  await $.turn.complete({ ...turnEnd('agent-turn'), answer: 'FAIL: the parser drops the last token.', agentId: 'agent-1' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' })

  const text = await report($)
  expect(text).toContain('- [x] Check the parser (general) — failed its check')
  // The test run speaks for the finished task nobody judged.
  expect(text).toContain('- [x] Write the guide (general) — verified')
})

test('the project log holds every session with its agents, a finished one shows none live, and a second joins it', async ($, on) => {
  mock.clock(on)
  const { kept, session } = world(on, [])

  await $.session.start(START)
  await $.turn.start({ text: 'Build the docs site', turnId: 'turn-1' })
  await $.agent.spawn({ ...VERIFIER, description: 'Write the docs', subagentType: 'polis:worker' })
  await $.turn.complete(turnEnd('turn-1'))
  const live = kept[`log:${ROOT}`] as ProjectLog
  expect(live.sessions).toMatchObject([
    { id: 'session-1', title: 'Build the docs site', turns: 1, agents: [{ label: 'Write the docs', status: 'running' }] },
  ])

  // A /clear ends the session and the process goes on under another id, with
  // no start raised for it: its first prompt begins the next record.
  await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: {} } as never)
  expect((kept[`log:${ROOT}`] as ProjectLog).sessions[0]?.agents[0]?.status).toBe('done')

  // A parallel session wrote its record meanwhile: it is not lost.
  const log = kept[`log:${ROOT}`] as ProjectLog
  kept[`log:${ROOT}`] = {
    ...log,
    sessions: [...log.sessions, { ...log.sessions[0], id: 'session-other', title: 'Fix the build', agents: [] }],
  }
  session.id = 'session-2'
  await $.turn.start({ text: 'Publish the site', turnId: 'turn-2' })
  await $.turn.complete(turnEnd('turn-2'))
  const after = kept[`log:${ROOT}`] as ProjectLog
  expect(after.sessions.map(one => one.id).sort()).toEqual(['session-1', 'session-2', 'session-other'])

  const ran = await $.command.run({ command: 'city', args: 'project', ...TYPED, origin: { kind: 'sdk' } })
  expect(ran.text).toStartWith('atlas · 3 sessions · 1 agent · 0 sub-agents')
  expect(ran.text).toContain('○ now  Build the docs site — 1 turn')
  expect(ran.text).toContain('● now  Publish the site — 1 turn')
  expect(ran.text).toContain('└ ✔ polis:worker: Write the docs')
})

test('a session starts with the tasks the earlier ones left, under names of their own', async ($, on) => {
  mock.clock(on)
  const earlier = {
    sessionId: 'session-0',
    at: 0,
    tasks: [
      { id: '1', subject: 'Draw the map', status: 'in_progress', area: 'ui', blockedBy: [], source: 'task' },
      { id: '2', subject: 'Write the guide', status: 'pending', area: 'docs', blockedBy: ['1'], source: 'task' },
    ],
  }
  const { kept } = world(on, [], { [`tasks:${ROOT}`]: earlier })
  await $.session.start(START)
  await $.turn.start({ text: 'Go on', turnId: 'turn-1' })
  // This session numbers its own tasks from one again.
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 't1', subject: 'Test the map', description: '' })
  await $.turn.complete(turnEnd('turn-1'))

  expect(savedTasks(kept).map(task => [task.id, task.sessionId, task.blockedBy])).toEqual([
    ['session-/1', 'session-0', []],
    ['session-/2', 'session-0', ['session-/1']],
    ['1', undefined, []],
  ])
  const ran = await $.command.run({ command: 'city', args: '', ...TYPED, origin: { kind: 'sdk' } })
  expect(ran.text).toContain('Tasks: 0 done · 1 active · 2 waiting')
  // The session's own record counts its own task alone.
  expect((kept[`log:${ROOT}`] as ProjectLog).sessions[0]).toMatchObject({ tasksDone: 0, tasksTotal: 1 })
})

test('carried tasks: unfinished ones stay, finished ones for a week, and the same session takes its own back', () => {
  const task = (id: string, status: Task['status'], more: Partial<Task> = {}): Task => ({
    id,
    subject: `Task ${id}`,
    status,
    area: 'general',
    blockedBy: [],
    source: 'task',
    ...more,
  })
  const NOW = 30 * 24 * 3_600_000
  const saved = {
    sessionId: 'abcdefgh-1234',
    at: NOW - 1000,
    tasks: [
      task('1', 'pending', { agentId: 'agent-9', parentId: '3' }),
      task('2', 'completed', { doneAt: NOW - KEEP_DONE + 1000 }),
      task('3', 'completed', { doneAt: NOW - KEEP_DONE - 1000 }),
      task('4', 'in_progress', { blockedBy: ['1', '3', 'zzzzzzzz/7'] }),
      task('zzzzzzzz/7', 'pending', { sessionId: 'zzzzzzzz-0000' }),
      { id: '', subject: 'No id' },
      'not a task',
    ],
  }
  const carried = carryTasks(saved, 'another', NOW)
  expect(carried.map(one => one.id)).toEqual(['abcdefgh/1', 'abcdefgh/2', 'abcdefgh/4', 'zzzzzzzz/7'])
  // References follow the new names, the dropped task's included, so that no
  // new task numbered alike is taken for it; the loop that ended is let go.
  expect(carried[0]).toMatchObject({ sessionId: 'abcdefgh-1234', parentId: 'abcdefgh/3' })
  expect(carried[0]?.agentId).toBeUndefined()
  expect(carried[2]?.blockedBy).toEqual(['abcdefgh/1', 'abcdefgh/3', 'zzzzzzzz/7'])
  expect(carried[3]?.sessionId).toBe('zzzzzzzz-0000')

  // The same session resumed: its list as it was, less the old finished work.
  expect(carryTasks(saved, 'abcdefgh-1234', NOW).map(one => one.id)).toEqual(['1', '2', '4', 'zzzzzzzz/7'])
  expect(carryTasks(undefined, 'x', NOW)).toEqual([])
  expect(carryTasks({ tasks: 'none' }, 'x', NOW)).toEqual([])

  // Finished work is dated when first saved so, and undated when reopened.
  const stamped = stampDone([task('1', 'completed'), task('2', 'completed', { doneAt: 5 }), task('3', 'pending', { doneAt: 5 })], 9)
  expect(stamped.map(one => one.doneAt)).toEqual([9, 5, undefined])

  // An earlier session's todos outlive this session's own list.
  const todos = mergeTodos(
    [task('abcdefgh/todo:main:0', 'pending', { source: 'todo', sessionId: 'abcdefgh-1234' })],
    [{ content: 'Mine', status: 'pending' }],
    undefined,
    undefined,
  )
  expect(todos.map(one => one.id)).toEqual(['abcdefgh/todo:main:0', 'todo:main:0'])
})

test('/city report and /city project answer as text where no surface draws, and report save writes the file', async ($, on) => {
  mock.clock(on)
  const { calls } = world(on, [])
  const written: string[] = []
  on('fs.write', (_, e) => {
    written.push(`${e.path}:${e.text.length}`)

    return { value: undefined }
  })

  await $.session.start(START)
  await $.turn.start({ text: 'Build the docs site', turnId: 'turn-1' })
  await $.tool.call({
    tool: 'TodoWrite',
    tool_use_id: 't1',
    todos: [
      { content: 'Write the docs', status: 'completed', activeForm: 'Writing' },
      { content: 'Test the build', status: 'in_progress', activeForm: 'Testing' },
    ],
  })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: `${ROOT}/docs/index.md`, old_string: 'a', new_string: 'b' })
  await $.turn.complete(turnEnd('turn-1'))
  const opened = calls.filter(call => call === 'open').length

  const text = await report($)
  expect(text).toStartWith('# atlas — session report')
  expect(text).toContain('- Tasks: 1 of 2 done · 1 in progress')
  expect(text).toContain('- `docs/index.md` — 1 edit')
  expect(written).toEqual([])

  const saved = await report($, 'report save')
  expect(saved).toStartWith(`Saved to ${ROOT}/polis-report.md\n\n# atlas — session report`)
  // The engine hands the path on as its host spells it.
  expect(written).toHaveLength(1)
  expect(written[0]).toEndWith(`polis-report.md:${text.length}`)

  const project = await report($, 'project')
  expect(project).toStartWith('atlas · 1 session · 0 agents · 0 sub-agents')
  expect(project).toContain('● now  Build the docs site — 1 turn')
  // Neither command opens anything: their answer is the text.
  expect(calls.filter(call => call === 'open')).toHaveLength(opened)
})

// The motion option is carried to the model as `isStill`, which no view reads
// yet: all a test can hold the mod to today is that it draws with motion off.
test('with motion off every view still draws', { options: { motion: false } }, async ($, on) => {
  mock.clock(on)
  world(on, ['desktop'])
  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...MOUNT, surface })
    for (const view of ['overview', 'city', 'tasks', 'agents', 'resources', 'skills']) {
      await ui.press({ key: `view-${view}` })
      expect(await ui.find({ type: 'Button', key: `view-${view}` })).toBeDefined()
    }
    await ui.unmount()
  }
})
