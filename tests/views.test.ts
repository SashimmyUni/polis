// What the person can read where nothing is drawn as a picture: the band's
// row and the pane's text views in a terminal (VS Code's among them), and the
// plain-text answer of /city, which is all an editor's chat panel shows.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, FoundElement } from 'claude-code/testing'
import type { On } from 'claude-code'

import { C, VIEWS } from '../hooks/theme'
import type { ProjectLog } from '../types'

const PANE = {
  title: 'Polis',
  isFocused: false,
  bodyColumns: 70,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

const paneAt = (columns: number) =>
  ({
    plugin: 'polis',
    component: 'Pane',
    requestId: 'polis',
    props: { ...PANE, bodyColumns: columns },
  }) as const

const bandAt = (columns: number) =>
  ({
    plugin: 'polis',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 6,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: 6 },
      view: {},
    },
  }) as const

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const ROOT = '/work/atlas'

const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

// The two surfaces a person in VS Code reads Polis on: its integrated
// terminal, and the extension's own panel.
const READ = ['terminal', 'vscode'] as const

type Surface = (typeof SURFACES)[number]

type World = {
  kept: Record<string, unknown>
  /** The id the engine gives the session: a test moves it to start another. */
  session: { id: string }
  /** What draws: emptied, the session is an editor's chat panel. */
  drawing: { surfaces: readonly Surface[] }
}

// The engine beneath the mod for a session in /work/atlas.
const world = (on: On, kept: Record<string, unknown> = {}): World => {
  const session = { id: 'session-1' }
  const drawing: World['drawing'] = { surfaces: ['terminal', 'vscode'] }
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('session.surfaces', () => ({ value: drawing.surfaces }))
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
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('agent.register', (_, e) => ({ value: { agent: e.name } }))
  let spawned = 0
  on('agent.spawn', () => {
    spawned += 1

    return { model: 'haiku', agentId: `agent-${spawned}` }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.SubagentStop', () => ({}))
  let made = 0
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => {
    made += 1

    return { result: { task: { id: String(made), subject: e.subject } } }
  })
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: [] },
  }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never }))

  return { kept, session, drawing }
}

const START = { cwd: ROOT, surface: null, isInteractive: false } as const

const turnEnd = (turnId: string) =>
  ({ answer: 'done', durationMs: 4000, isAborted: false, turnId, reason: 'answer' }) as const

// The /city answer where nothing draws: the whole board as text.
const answer = async ($: Engine, { drawing }: World): Promise<string> => {
  const before = drawing.surfaces
  drawing.surfaces = []
  const ran = await $.command.run({ command: 'city', args: '', ...TYPED, origin: { kind: 'sdk' } })
  drawing.surfaces = before

  return ran.text ?? ''
}

// The texts of the pane's view on a surface, in the order they are drawn.
const viewed = async (
  $: Engine,
  surface: Surface,
  view: string,
  columns = 70,
): Promise<FoundElement[]> => {
  const ui = await $.ui.mount({ ...paneAt(columns), surface })
  await ui.press({ key: `view-${view}` })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()

  return texts
}

// The band's texts on a surface, in the order they are drawn.
const banded = async ($: Engine, surface: Surface, columns: number): Promise<FoundElement[]> => {
  const ui = await $.ui.mount({ ...bandAt(columns), surface })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()

  return texts
}

const shown = (texts: readonly FoundElement[]): string[] => texts.map(one => one.text)

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

test('a failing test command is told in the overview, the text city and the /city answer, not the band', async ($, on) => {
  mock.clock(on)
  const here = world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'Exit code 1\n3 tests failed', isError: true }) as never)
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' })

  for (const surface of READ) {
    expect(shown(await banded($, surface, 200)).some(one => one.includes('✘'))).toBe(false)
    const overview = await viewed($, surface, 'overview')
    expect(shown(overview)).toContain('CHECKS')
    const line = overview.find(one => one.text.startsWith('✘ tests'))
    expect(line?.text).toBe('✘ tests   failed just now · 0ms · npm test')
    expect(line?.props.color).toBe(C.fail)
  }
  // The terminal has the city as text, with a line for the checks.
  expect(shown(await viewed($, 'terminal', 'city'))).toContain('▣ checks: tests ✘')
  expect(await answer($, here)).toContain('\nChecks: tests ✘\n')
})

test('before any check has run there is no Checks section, and the city says none ran', async ($, on) => {
  mock.clock(on)
  const here = world(on)
  expect(shown(await viewed($, 'terminal', 'overview'))).not.toContain('CHECKS')
  expect(shown(await viewed($, 'terminal', 'city'))).toContain('▣ checks: none run yet')
  const text = await answer($, here)
  for (const label of ['Needs you', 'Checks:', 'Git:', 'Limits:', 'Project:']) {
    expect(text).not.toContain(label)
  }
})

test('a permission request leads the band in rose and is told with how long it has waited', async ($, on) => {
  const clock = mock.clock(on)
  const here = world(on)
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 't1', subject: 'Clean the build', description: '' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  await clock.advance(125_000)

  for (const surface of READ) {
    // However narrow the band, what needs the person is the last thing to go.
    for (const columns of [40, 80, 110]) {
      const [first] = await banded($, surface, columns)
      expect(first?.text).toBe('▲ needs you: permission for Bash')
      expect(first?.props.color).toBe(C.fail)
    }
    const overview = shown(await viewed($, surface, 'overview'))
    // It stands above everything else in the view.
    const at = overview.indexOf('▲ NEEDS YOU')
    expect(overview[at + 1]).toBe('permission for Bash · waiting 2m05s')
    expect(at).toBeLessThan(overview.indexOf('PROJECT'))
  }
  const city = shown(await viewed($, 'terminal', 'city'))
  expect(city).toContain('needs you')
  expect(city).toContain('▲ needs you: permission for Bash · waiting 2m05s')
  expect((await answer($, here)).split('\n')[1]).toBe('▲ Needs you: permission for Bash · waiting 2m05s')
})

test("a verifier's verdicts mark the done tasks: verified, not checked, and failed", async ($, on) => {
  mock.clock(on)
  const here = world(on)
  const subjects = ['Check the parser', 'Write the guide', 'Draw the map', 'Plan the launch']
  for (const [at, subject] of subjects.entries()) {
    await $.tool.call({ tool: 'TaskCreate', tool_use_id: `t${at}`, subject, description: '' })
  }
  for (const taskId of ['1', '2', '3']) {
    await $.tool.call({ tool: 'TaskUpdate', tool_use_id: `u${taskId}`, taskId, status: 'completed' })
  }
  const stop = { stop_hook_active: false, agent_transcript_path: '', agent_type: 'polis:verifier' } as const
  await $.agent.spawn(VERIFIER)
  await $.classic.SubagentStop({ ...stop, agent_id: 'agent-1', last_assistant_message: 'PASS. 41 tests passed.' })
  await $.agent.spawn({ ...VERIFIER, tool_use_id: 'a2', description: 'Write the guide' })
  await $.classic.SubagentStop({ ...stop, agent_id: 'agent-2', last_assistant_message: 'FAIL: a page is missing.' })

  for (const surface of READ) {
    const tasks = await viewed($, surface, 'tasks', 100)
    const marks = tasks.filter(one => /^(✔✔|✔|✘|○)$/.test(one.text))
    expect(marks.map(one => [one.text, one.props.color])).toEqual([
      ['✔✔', C.done],
      ['✘', C.fail],
      ['✔', C.muted],
      ['○', C.muted],
    ])
    for (const note of ['verified by a verifier', 'failed its verifier', 'not checked yet']) {
      expect(shown(tasks)).toContain(note)
    }
    expect(shown(tasks)).toContain('1 verified · 1 not checked · 1 failed its check')
    // A narrow pane keeps the marks and drops the words beside them.
    const narrow = shown(await viewed($, surface, 'tasks', 30))
    expect(narrow).toContain('✔✔')
    expect(narrow).not.toContain('verified by a verifier')
    expect(shown(await viewed($, surface, 'overview'))).toContain('1 verified · 1 not checked · 1 failed its check')
  }
  // In the text city a done building reads by its standing.
  const city = shown(await viewed($, 'terminal', 'city'))
  expect(city.slice(city.indexOf('general   ') + 1).slice(0, 4)).toEqual(['█', '✘', '▄', '░'])
  expect(city).toContain('█ verified · ▄ done, not checked · ✘ failed its check · ▓ in progress · ░ waiting')
  expect(await answer($, here)).toContain(
    'Tasks: 3 done · 0 active · 1 waiting (1 verified · 1 not checked · 1 failed its check)',
  )
})

test('tasks an earlier session left are marked so, and an area taken from the code is tagged', async ($, on) => {
  mock.clock(on)
  const earlier = {
    sessionId: 'session-0',
    at: 0,
    tasks: [
      { id: '1', subject: 'Draw the map', status: 'in_progress', area: 'ui', blockedBy: [], source: 'task' },
      { id: '2', subject: 'Write the guide', status: 'pending', area: 'docs', blockedBy: [], source: 'task' },
    ],
  }
  world(on, { [`tasks:${ROOT}`]: earlier })
  await $.session.start(START)
  await $.turn.start({ text: 'Go on', turnId: 'turn-1' })
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 't1', subject: 'Build the login form', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't2', taskId: '1', status: 'in_progress' })
  await $.tool.call({
    tool: 'Edit',
    tool_use_id: 'e1',
    file_path: `${ROOT}/packages/web/src/login.ts`,
    old_string: 'a',
    new_string: 'b',
  })

  for (const surface of READ) {
    const tasks = await viewed($, surface, 'tasks')
    expect(tasks.filter(one => one.text === 'earlier session')).toHaveLength(2)
    expect(tasks.filter(one => one.text === 'code')).toHaveLength(1)
    // The carried work is dimmer than this session's own.
    expect(tasks.find(one => one.text === 'Write the guide')?.props.color).toBe(C.muted)
    expect(tasks.find(one => one.text === 'Build the login form')?.props.color).toBe(C.text)
    expect(shown(tasks)).toContain('web')
  }
})

const NESTED = [
  {
    key: 'k1',
    type: 'worker',
    label: 'Fix the linker',
    name: 'linker',
    status: 'done',
    tokens: 1200,
    tools: 3,
    startedAt: 0,
    children: [
      { key: 'k2', type: 'Explore', label: 'Find the flags', status: 'done', tokens: 300, tools: 1, startedAt: 0, children: [] },
    ],
  },
] as const

// Three sessions of one project: the first with an agent, a parallel one whose
// agent spawned a sub-agent, and the live one.
const threeSessions = async ($: Engine, { kept, session }: World): Promise<void> => {
  await $.session.start(START)
  await $.turn.start({ text: 'Build the docs site', turnId: 'turn-1' })
  await $.agent.spawn({ ...VERIFIER, description: 'Write the docs', subagentType: 'polis:worker' })
  await $.turn.complete(turnEnd('turn-1'))
  await $.session.end({ reason: 'clear', sessionId: 'session-1', resume: {} } as never)
  const log = kept[`log:${ROOT}`] as ProjectLog
  kept[`log:${ROOT}`] = {
    ...log,
    sessions: [...log.sessions, { ...log.sessions[0], id: 'session-other', title: 'Fix the build', agents: NESTED }],
  }
  session.id = 'session-2'
  await $.turn.start({ text: 'Publish the site', turnId: 'turn-2' })
  await $.turn.complete(turnEnd('turn-2'))
}

test('the Project view shows every session with its agents and their sub-agents, the live one marked', async ($, on) => {
  mock.clock(on)
  const here = world(on)
  await threeSessions($, here)
  const headline = '3 sessions · 2 agents · 1 sub-agent · 0 tokens · $0.00'

  for (const surface of READ) {
    const wide = await viewed($, surface, 'project', 100)
    const lines = shown(wide)
    expect(lines).toContain(headline)
    expect(lines).toContain('atlas')
    const live = wide.find(one => one.text.startsWith('●') && one.text.includes('Publish the site'))
    expect(live?.text).toBe('● now  Publish the site — 1 turn · 0 tokens · $0.00 · 0/0 tasks')
    expect(live?.props.bold).toBe(true)
    expect(lines).toContain('○ now  Build the docs site — 1 turn · 0 tokens · $0.00 · 0/0 tasks')
    expect(lines).toContain('  └ ✔ polis:worker: Write the docs · 0 tok · 0 tools')
    expect(lines).toContain('  └ ✔ linker (worker): Fix the linker · 1.2k tok · 3 tools')
    expect(lines).toContain('    └ ✔ Explore: Find the flags · 300 tok · 1 tool')
    // The agent sits under its session, the sub-agent under its agent.
    const at = lines.indexOf('    └ ✔ Explore: Find the flags · 300 tok · 1 tool')
    expect(lines[at - 1]).toStartWith('  └ ✔ linker')
    expect(lines[at - 2]).toStartWith('○ now  Fix the build')

    // At forty columns every line of the log is cut to the pane.
    const narrow = shown(await viewed($, surface, 'project', 40))
    expect(narrow).toContain(headline)
    const log = narrow.slice(narrow.indexOf('newest first') + 1)
    expect(log).toHaveLength(6)
    for (const line of log) expect(line.length).toBeLessThanOrEqual(40)
    expect(log.find(line => line.startsWith('●'))).toBe('● now  Publish t… — 1t · 0 · $0.00 · 0/0')
    expect(log).toContain('    └ ✔ Explore: Fin… · 300 tok · 1 tool')
  }
})

test('the other views say which scope a figure has, and the /city answer ends on the project', async ($, on) => {
  mock.clock(on)
  const here = world(on)
  await threeSessions($, here)

  for (const surface of READ) {
    const overview = shown(await viewed($, surface, 'overview'))
    const at = overview.indexOf('project ')
    expect(overview.slice(at, at + 4)).toEqual([
      'project ',
      '3 sessions · 2 agents · 1 sub-agent · 0 tokens · $0.00',
      'session ',
      '1 turn · 0 agents · 0 tokens · $0.00',
    ])
    // The agents of the sessions before this one, and where the rest is.
    const agents = shown(await viewed($, surface, 'agents', 100))
    expect(agents).toContain('EARLIER SESSIONS')
    expect(agents).toContain('2 in this project · all of them in Project (2)')
    expect(agents).toContain('    └ ✔ Explore: Find the flags · 300 tok · 1 tool')
    expect(agents.some(line => line.startsWith('●'))).toBe(false)
  }
  expect((await answer($, here)).split('\n').at(-1)).toBe(
    'Project: 3 sessions · 2 agents · 1 sub-agent · 0 tokens · $0.00',
  )
})

test('with no session in the log the Project view says so plainly', async ($, on) => {
  mock.clock(on)
  world(on)
  for (const surface of SURFACES) {
    for (const columns of [40, 100]) {
      expect(shown(await viewed($, surface, 'project', columns))).toContain(
        'No sessions recorded yet: one is written as a session starts.',
      )
    }
    expect(shown(await viewed($, surface, 'agents'))).not.toContain('EARLIER SESSIONS')
  }
})

test('a limit on course to run out early is rose in Resources, warned of in the band and in the /city answer', async ($, on) => {
  const clock = mock.clock(on)
  const here = world(on)
  const HOUR = 3_600_000
  const resetsAt = new Date(clock.now() + 4 * HOUR).toISOString()
  const reading = (kind: string, percentUsed: number) => ({ kind, percentUsed, resetsAt })
  const measure = (rateLimits: unknown[]) =>
    $.session.measure({
      context: { window: 200_000, tokens: 20_000, percent: 10 },
      rateLimits,
      changed: ['rateLimits'],
    } as never)

  await measure([reading('five_hour', 40), reading('seven_day', 12)])
  // Before a pace can be told, the fullest window is named with what is known.
  expect(await answer($, here)).toContain('\nLimits: 5h 40% · pace not known yet: it takes a few readings\n')
  await clock.advance(12 * 60_000)
  await measure([reading('five_hour', 60), reading('seven_day', 12)])

  for (const surface of READ) {
    const resources = await viewed($, surface, 'resources', 100)
    const short = resources.find(one => one.text.startsWith('full in about '))
    expect(short?.text).toMatch(/^full in about \d+m at 100%\/h, 3h\d\dm before it resets$/)
    expect(short?.props.color).toBe(C.fail)
    // Each window has its line, under its own short name.
    expect(resources[resources.indexOf(short as FoundElement) - 1]?.text).toBe('5h      ')
    const week = resources[shown(resources).indexOf('7d      ') + 1]
    expect(week?.text).toBe('pace not known yet: it takes a few readings')
    expect(week?.props.color).toBe(C.muted)
    const alert = (await banded($, surface, 80)).find(one => one.text.startsWith('⚠ 5h limit out in '))
    expect(alert?.props.color).toBe(C.fail)
  }
  expect(await answer($, here)).toMatch(/\nLimits: ⚠ 5h limit out in \d+m\n/)
})

test('git is told as a line in the overview and the /city answer, and not in the band', async ($, on) => {
  const clock = mock.clock(on)
  const here = world(on)
  on('process.run', (_, e) => {
    const stdout =
      e.argv[1] === 'status'
        ? '# branch.oid abc\n# branch.head main\n1 .M N... 100644 100644 100644 a b src/a.ts\n? notes.txt\n'
        : ' 1 file changed, 12 insertions(+), 3 deletions(-)\n'

    return { value: { exitCode: 0, stdout, stderr: '' } as never }
  })
  await $.session.start(START)
  await clock.settle()

  for (const surface of READ) {
    const overview = shown(await viewed($, surface, 'overview'))
    expect(overview.slice(overview.indexOf('GIT')).slice(0, 2)).toEqual(['GIT', 'main · 1 file +12 −3 · 1 untracked'])
    expect(shown(await banded($, surface, 200)).some(one => one.includes('main'))).toBe(false)
  }
  expect(await answer($, here)).toContain('\nGit: main · 1 file +12 −3 · 1 untracked\n')
})

// The cells a row of the band takes: its texts, a gap after each, and its two
// buttons.
const rowWidth = (texts: readonly FoundElement[]): number =>
  texts.reduce((sum, one) => sum + one.text.length + 1, 16)

// The two surfaces that draw the band.
const BANDED = ['terminal', 'desktop'] as const

// A session with something in every strip element, and data for every
// reading the band no longer carries: the project name, progress, an agent,
// checks, the prompt's tokens, git and the current task.
const everything = async ($: Engine, on: On): Promise<void> => {
  const clock = mock.clock(on)
  world(on)
  on('process.run', (_, e) => {
    const stdout =
      e.argv[1] === 'status'
        ? '# branch.head feature/text-views\n1 .M N... 100644 100644 100644 a b src/a.ts\n'
        : ' 1 file changed, 120 insertions(+), 34 deletions(-)\n'

    return { value: { exitCode: 0, stdout, stderr: '' } as never }
  })
  on('tool.call', { tool: 'Bash' }, () => ({ result: 'Exit code 1', isError: true }) as never)
  await $.session.start(START)
  await clock.settle()
  await $.turn.start({ text: 'Write the text views of the dashboard', turnId: 'turn-1' })
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 't1', subject: 'Write the text views', description: '' })
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 't2', subject: 'Test them', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't3', taskId: '1', status: 'in_progress' })
  await $.agent.spawn({ ...VERIFIER, subagentType: 'Explore', description: 'Find the callers' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test && npm run lint && npx tsc' })
  await $.classic.PermissionRequest({ tool_name: 'Write', tool_input: {} })
  const resetsAt = new Date(clock.now() + 4 * 3_600_000).toISOString()
  const measure = (percentUsed: number) =>
    $.session.measure({
      context: { window: 200_000, tokens: 151_000, percent: 76 },
      rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt }],
      changed: ['context', 'rateLimits'],
    } as never)
  await measure(40)
  await clock.advance(12 * 60_000)
  await measure(60)
}

const LIMIT = /^⚠ 5h limit out in \d+m$/

test('the band shows needs you, the limit warning, the smart zone and tasks done, then City and Hide', async ($, on) => {
  await everything($, on)

  for (const surface of BANDED) {
    const ui = await $.ui.mount({ ...bandAt(200), surface })
    expect(shown(await ui.findAll({ type: 'Text' }))).toEqual([
      '▲ needs you: permission for Write',
      expect.stringMatching(LIMIT),
      'ctx 151k · out of the smart zone',
      '0/2 tasks',
    ])
    expect((await ui.findAll({ type: 'Button' })).map(one => one.key)).toEqual(['city', 'hide'])
    await ui.unmount()
  }
})

test('as the band narrows it drops tasks done, the smart-zone tail, the smart zone, then the limit warning', async ($, on) => {
  await everything($, on)

  for (const surface of BANDED) {
    // Each distinct row the band shows, widest first.
    const rows: string[][] = []
    for (let columns = 200; columns >= 20; columns -= 1) {
      const ui = await $.ui.mount({ ...bandAt(columns), surface })
      const texts = await ui.findAll({ type: 'Text' })
      const row = shown(texts).map(one => (LIMIT.test(one) ? '⚠ limit' : one))
      if (row.length > 1) expect(rowWidth(texts)).toBeLessThanOrEqual(columns)
      expect((await ui.findAll({ type: 'Button' })).map(one => one.key)).toEqual(['city', 'hide'])
      // One row: the band never wraps onto a second.
      expect((await ui.find({ type: 'Box' }))?.props.flexWrap ?? 'nowrap').toBe('nowrap')
      await ui.unmount()
      if (JSON.stringify(rows.at(-1)) !== JSON.stringify(row)) rows.push(row)
    }
    const NEEDS = '▲ needs you: permission for Write'
    expect(rows).toEqual([
      [NEEDS, '⚠ limit', 'ctx 151k · out of the smart zone', '0/2 tasks'],
      [NEEDS, '⚠ limit', 'ctx 151k · out of the smart zone'],
      [NEEDS, '⚠ limit', 'ctx 151k'],
      [NEEDS, '⚠ limit'],
      [NEEDS],
    ])
  }
})

test('with nothing to say the band shows only City and Hide', async ($, on) => {
  mock.clock(on)
  world(on)
  await $.session.measure({
    context: { window: 200_000, tokens: 0, percent: 0 },
    rateLimits: [],
    changed: ['context'],
  } as never)

  for (const surface of BANDED) {
    const ui = await $.ui.mount({ ...bandAt(80), surface })
    expect(await ui.findAll({ type: 'Text' })).toEqual([])
    expect((await ui.findAll({ type: 'Button' })).map(one => one.key)).toEqual(['city', 'hide'])
    await ui.unmount()
  }
})

test('the limit warning is on the band only while a limit is on course to run out', async ($, on) => {
  const clock = mock.clock(on)
  world(on)
  const resetsAt = new Date(clock.now() + 4 * 3_600_000).toISOString()
  const measure = (percentUsed: number) =>
    $.session.measure({
      context: { window: 200_000, tokens: 20_000, percent: 10 },
      rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt }],
      changed: ['rateLimits'],
    } as never)
  const warned = async (): Promise<boolean> =>
    shown(await banded($, 'terminal', 200)).some(one => one.startsWith('⚠'))

  await measure(10)
  expect(await warned()).toBe(false)
  // A slow pace that lasts until the reset is no warning.
  await clock.advance(12 * 60_000)
  await measure(11)
  expect(await warned()).toBe(false)
  await clock.advance(12 * 60_000)
  await measure(40)
  expect(await warned()).toBe(true)
})

test('every view draws on every surface, wide and narrow, and the hotkeys follow the order', async ($, on) => {
  mock.clock(on)
  const here = world(on)
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: 'ok', stderr: '', interrupted: false } as never }))
  await threeSessions($, here)
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 't1', subject: 'Check the parser', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't2', taskId: '1', status: 'completed' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm test' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: {} })
  expect(VIEWS.map(one => one.name)).toEqual(['overview', 'project', 'city', 'tasks', 'agents', 'resources', 'skills'])

  for (const surface of SURFACES) {
    for (const columns of [21, 40, 100]) {
      const ui = await $.ui.mount({ ...paneAt(columns), surface })
      for (const [at, view] of VIEWS.entries()) {
        await ui.press({ key: `view-${view.name}` })
        const button = await ui.find({ type: 'Button', key: `view-${view.name}` })
        expect(button?.props).toMatchObject({ variant: 'primary', hotkey: String(at + 1), label: view.label })
        // Under the title and the row of views there is always something.
        expect((await ui.findAll({ type: 'Text' })).length + (await ui.findAll({ type: 'Svg' })).length).toBeGreaterThan(2)
      }
      await ui.unmount()
    }
    const band = await $.ui.mount({ ...bandAt(80), surface })
    expect(await band.find({ type: 'Button', key: 'city' })).toBeDefined()
    await band.unmount()
  }
})
