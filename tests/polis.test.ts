import { expect, mock, test } from 'claude-code/testing'
import type { Engine, FoundElement } from 'claude-code/testing'
import type { On } from 'claude-code'

import {
  expectedFor,
  fileUrl,
  gaugeOf,
  heuristicSize,
  matchTask,
  mergeProject,
  newProject,
  under,
} from '../hooks/logic'
import type { TurnRecord } from '../types'

const PANE = {
  title: 'Polis',
  isFocused: false,
  bodyColumns: 70,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

const MOUNT = { plugin: 'polis', component: 'Pane', requestId: 'polis', props: PANE } as const

// The band above the prompt, as a surface asks for it.
const BAND = {
  plugin: 'polis',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 6,
    bodyColumns: 110,
    scroll: { offset: 0, bodyRows: 6 },
    view: {},
  },
} as const

// Every surface the engine names. Mounting on one validates the hook's tree
// by that surface's element table: the kit rejects a tree it cannot draw. It
// exercises the mod on the surface, never the surface's own paint.
const SURFACES = ['terminal', 'desktop', 'vscode', 'mobile'] as const

// The surfaces whose table has `Svg`: each gets the vector city and an icon
// per agent. The terminal's has none and gets both as text.
const VECTOR = ['desktop', 'vscode', 'mobile'] as const

const VIEWS = ['overview', 'city', 'tasks', 'agents', 'resources', 'skills'] as const

// The most characters an `Svg` may carry as `source` (SvgProps): a longer one
// and the engine refuses the whole tree it is in.
const SVG_LIMIT = 131072

// The nouns the plugin calls that the kit has no mock for: answered quietly.
const quiet = (on: On, onOpen: (id: string) => void = () => undefined): void => {
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', (_, e) => {
    onOpen(e.id)

    return { value: { isPlaced: true } }
  })
}

// What an `Svg` has to be wherever one is drawn: a whole SVG document inside
// the engine's limit that leans on no script (the surfaces draw it without),
// and words for a reader who cannot see it.
const expectDrawable = (svg: FoundElement | undefined): string => {
  expect(svg).toBeDefined()
  const source = String(svg?.props.source)
  expect(source).toStartWith('<svg')
  expect(source).toEndWith('</svg>')
  expect(source.length).toBeLessThan(SVG_LIMIT)
  expect(source).not.toMatch(/<script|\son[a-z]+=|javascript:/i)
  expect(typeof svg?.props.alt).toBe('string')
  expect(String(svg?.props.alt).trim().length).toBeGreaterThan(0)

  return source
}

// Every element tag in a drawn tree.
const tagsOf = (node: unknown, into: Set<string> = new Set()): Set<string> => {
  if (Array.isArray(node)) {
    for (const one of node) tagsOf(one, into)

    return into
  }
  if (typeof node !== 'object' || node === null) return into
  const { type, children } = node as { type?: unknown; children?: unknown }
  if (typeof type === 'string') into.add(type)
  tagsOf(children, into)

  return into
}

test('task tools build a tree with districts, sub-tasks and dependencies', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  quiet(on)
  let made = 0
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => {
    made += 1

    return { result: { task: { id: String(made), subject: e.subject } } }
  })
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: [] },
  }))

  await $.tool.call({
    tool: 'TaskCreate',
    tool_use_id: 't1',
    subject: 'Design the schema',
    description: '',
    metadata: { area: 'api' },
  })
  await $.tool.call({
    tool: 'TaskCreate',
    tool_use_id: 't2',
    subject: 'Add the users table',
    description: '',
    metadata: { parent: '1' },
  })
  await $.tool.call({
    tool: 'TaskCreate',
    tool_use_id: 't3',
    subject: 'Write the integration tests',
    description: '',
  })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't4', taskId: '1', status: 'in_progress' })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't5', taskId: '3', addBlockedBy: ['1'] })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...MOUNT, surface })
    await ui.press({ key: 'view-tasks' })
    expect(await ui.find({ type: 'Text', text: 'Design the schema' })).toBeDefined()
    // The sub-task inherits its parent's district; the third is inferred.
    expect(await ui.findAll({ type: 'Text', text: /^api$/ })).toHaveLength(2)
    expect(await ui.find({ type: 'Text', text: /^tests$/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'waits on 1' })).toBeDefined()
    await ui.unmount()
  }
})

test('a todo list fills the board, and Clear finished empties its done rows', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  quiet(on)
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))

  // Clear finished empties the board, so each surface starts from a list
  // written afresh: a todo list replaces the one before it.
  for (const surface of SURFACES) {
    await $.tool.call({
      tool: 'TodoWrite',
      tool_use_id: `toolu_${surface}`,
      todos: [
        { content: 'Write code', status: 'completed', activeForm: 'Writing code' },
        { content: 'Run tests', status: 'in_progress', activeForm: 'Running tests' },
      ],
    })

    const ui = await $.ui.mount({ ...MOUNT, surface })
    await ui.press({ key: 'view-overview' })
    expect(await ui.find({ type: 'Text', text: '1 done · 1 active · 0 waiting' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Running tests' })).toBeDefined()
    await ui.press({ key: 'clear' })
    expect(await ui.find({ type: 'Text', text: '0 done · 1 active · 0 waiting' })).toBeDefined()
    await ui.unmount()
  }
})

test('tool calls equip the main session, and a spawned agent is listed', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  quiet(on)
  on('tool.call', { tool: 'Grep' }, () => ({
    result: { mode: 'files_with_matches', filenames: [], numFiles: 0 },
  }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'agent-1' }))

  await $.tool.call({ tool: 'Grep', tool_use_id: 'g1', pattern: 'a' })
  await $.tool.call({ tool: 'Grep', tool_use_id: 'g2', pattern: 'b' })
  await $.agent.spawn({
    tool_use_id: 'a1',
    prompt: 'Find every caller of parse()',
    description: 'Find parse callers',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'opus',
    background: true,
    fork: false,
  })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...MOUNT, surface })
    await ui.press({ key: 'view-agents' })
    expect(await ui.find({ type: 'Text', text: 'search ×2' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Find parse callers' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Explore · running/ })).toBeDefined()
    await ui.unmount()
  }
})

test('background work and agents are settled by what the engine says is in flight', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  quiet(on)
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bash_1' },
  }))
  on('classic.Stop', () => ({}))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'agent-1' }))
  on('agent.list', () => ({
    value: [{ id: 'agent-1', description: 'Check it', type: 'Explore', status: 'completed' }],
  }))

  await $.tool.call({
    tool: 'Bash',
    tool_use_id: 'b1',
    command: 'npm run dev',
    description: 'Start the dev server',
    run_in_background: true,
  })

  // One session drawn on every surface at once: each drawing follows it.
  const drawings = await Promise.all(SURFACES.map(surface => $.ui.mount({ ...MOUNT, surface })))
  for (const ui of drawings) {
    await ui.press({ key: 'view-overview' })
    expect(await ui.find({ type: 'Text', text: '1 running' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: 'Start the dev server' })).toBeDefined()
  }

  await $.agent.spawn({
    tool_use_id: 'a1',
    prompt: 'Check it',
    description: 'Check it',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'opus',
    background: true,
    fork: false,
  })
  for (const ui of drawings) {
    expect(await ui.find({ type: 'Text', text: '1 working · 1 this session' })).toBeDefined()
  }

  // The engine reports nothing in flight and the agent completed.
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [], session_crons: [] })
  for (const ui of drawings) {
    expect(await ui.find({ type: 'Text', text: '0 running' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '0 working · 1 this session' })).toBeDefined()
    await ui.unmount()
  }
})

test('the project tool records milestones and keeps them in the store', async ($, on) => {
  mock.clock(on)
  const kept: Record<string, unknown> = {}
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('session.cwd', () => ({ value: '/work/atlas' }))
  quiet(on)

  const ran = await $.tool.call({
    tool: 'mcp__polis__project',
    tool_use_id: 'p1',
    phase: 'Building the API',
    milestones: [
      { id: 'design', title: 'Design', status: 'done' },
      { id: 'build', title: 'Build', status: 'active' },
      { id: 'ship', title: 'Ship' },
    ],
  })
  expect(ran.text ?? String(ran.result)).toContain('1 of 3 milestones done')
  expect(kept['project:/work/atlas']).toMatchObject({ name: 'atlas', phase: 'Building the API' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...MOUNT, surface })
    await ui.press({ key: 'view-overview' })
    expect(await ui.find({ type: 'Text', text: '50% · 1/3 milestones' })).toBeDefined()
    await ui.unmount()
  }
})

test('the city is a vector drawing on the desktop, in VS Code and on mobile, and text in a terminal', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  quiet(on)
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))
  await $.tool.call({
    tool: 'TodoWrite',
    tool_use_id: 'toolu_1',
    todos: [{ content: 'Write the docs', status: 'in_progress', activeForm: 'Writing the docs' }],
  })

  for (const surface of VECTOR) {
    const ui = await $.ui.mount({ ...MOUNT, surface })
    await ui.press({ key: 'view-city' })
    const drawings = await ui.findAll({ type: 'Svg' })
    expect(drawings).toHaveLength(1)
    const drawing = drawings[0]
    expect(drawing).toBeDefined()
    const source = expectDrawable(drawing)
    expect(source.startsWith('<svg')).toBe(true)
    expect(source.length).toBeLessThan(SVG_LIMIT)
    expect(String(drawing?.props.alt)).toContain('1 task')
    // Drawn in the script-less frame, where its tooltips and motion work.
    expect(drawing?.props.isInteractive).toBe(true)
    // The drawing stands in for the district rows; it is not beside them.
    expect(await ui.find({ type: 'Text', text: /^docs/ })).toBeUndefined()
    await ui.unmount()
  }

  const terminal = await $.ui.mount({ ...MOUNT, surface: 'terminal' })
  await terminal.press({ key: 'view-city' })
  expect(await terminal.find({ type: 'Svg' })).toBeUndefined()
  expect(await terminal.find({ type: 'Text', text: /^docs/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: '◆ city hall' })).toBeDefined()
  await terminal.unmount()
})

test('the band shows progress and opens the city', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  let opened = 0
  quiet(on, () => {
    opened += 1
  })
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))
  await $.tool.call({
    tool: 'TodoWrite',
    tool_use_id: 'toolu_1',
    todos: [
      { content: 'One', status: 'completed', activeForm: 'One' },
      { content: 'Two', status: 'pending', activeForm: 'Two' },
    ],
  })

  // The engine raises `AbovePrompt` on the terminal and the desktop only in
  // this build (RenderPropsOf). On `vscode` and `mobile` the mount shows the
  // band's tree is one those surfaces could draw, not that they show a band.
  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...BAND, surface })
    expect(await ui.find({ type: 'Text', text: '1/2 tasks' })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'hide' })).toBeDefined()
    const before = opened
    await ui.press({ key: 'city' })
    expect(opened).toBe(before + 1)
    await ui.unmount()
  }
})

test('expected resources: sizing, ranges from history, and the gauge', () => {
  expect(heuristicSize('what does this function do?')).toBe('S')
  expect(heuristicSize('Refactor the auth module across the entire codebase')).toBe('M')
  expect(heuristicSize(['Do this:', '- a', '- b', '- c'].join('\n'))).toBe('L')

  const cold = expectedFor('M', 'heuristic', [])
  expect(cold.samples).toBe(0)
  expect(cold.tokens.high).toBe(90_000)

  const past: TurnRecord[] = [10, 20, 30, 40, 50].map(k => ({
    size: 'M',
    tokens: k * 1000,
    ms: k * 100,
    tools: k,
    agents: 0,
    at: 0,
  }))
  const warm = expectedFor('M', 'model', past)
  expect(warm.samples).toBe(5)
  expect(warm.tokens).toEqual({ low: 20_000, high: 42_000 })

  expect(gaugeOf(10_000, warm.tokens).state).toBe('under')
  expect(gaugeOf(30_000, warm.tokens).state).toBe('within')
  expect(gaugeOf(50_000, warm.tokens).state).toBe('over')
})

test('an agent is matched to the task its brief is about', () => {
  const task = (id: string, subject: string, status: 'pending' | 'in_progress') => ({
    id,
    subject,
    status,
    area: 'general',
    blockedBy: [],
    source: 'task' as const,
  })
  const list = [task('1', 'Write the parser tests', 'pending'), task('2', 'Build the lexer', 'pending')]
  expect(matchTask('Parser tests', list)).toBe('1')
  expect(matchTask('Something unrelated', list)).toBeUndefined()
  expect(matchTask('Something unrelated', [task('7', 'Deploy', 'in_progress')])).toBe('7')
})

test('milestones merge by id', () => {
  const start = mergeProject(newProject('/work/atlas', 0), {
    milestones: [{ id: 'a', title: 'First' }, { id: 'b', title: 'Second' }],
  })
  const next = mergeProject(start, { milestones: [{ id: 'a', status: 'done' }] })
  expect(next.milestones).toEqual([
    { id: 'a', title: 'First', status: 'done' },
    { id: 'b', title: 'Second', status: 'planned' },
  ])
})

test('a path becomes the file URL a browser opens', () => {
  expect(fileUrl('C:\\Users\\jo\\app\\.polis\\city.html')).toBe('file:///C:/Users/jo/app/.polis/city.html')
  expect(fileUrl('/work/atlas/.polis/city.html')).toBe('file:///work/atlas/.polis/city.html')
  // Each segment is encoded by itself: the slashes between them stay.
  expect(fileUrl('/home/jo/my app/50% #1/city.html')).toBe('file:///home/jo/my%20app/50%25%20%231/city.html')
  expect(fileUrl('C:\\My Projects\\app/.polis/city.html')).toBe('file:///C:/My%20Projects/app/.polis/city.html')
  expect(fileUrl('\\\\server\\share\\app\\city.html')).toBe('file://server/share/app/city.html')
})

test('a path under the root is joined the way the root is written', () => {
  expect(under('/work/atlas', '.polis', 'city.html')).toBe('/work/atlas/.polis/city.html')
  expect(under('C:\\work\\atlas', '.polis', 'city.html')).toBe('C:\\work\\atlas\\.polis\\city.html')
  expect(under('C:/work/atlas/', '.polis', 'city.html')).toBe('C:/work/atlas/.polis/city.html')
})

// What `session.start` reads from the engine, for a session in /work/atlas.
const session = (on: On, kept: Record<string, unknown>): void => {
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.repo', () => ({ value: null }))
  on('session.id', () => ({ value: 'session-1' }))
  on('ui.panes', () => ({ value: [] }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 20_000, percent: 10 }, rateLimits: [] },
  }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('agent.register', (_, e) => ({ value: { agent: e.name } }))
  on('command.list', () => ({
    value: [
      { name: 'help', description: 'Shows help', source: 'builtin' },
      { name: 'security-review', description: 'Review pending changes for security issues', source: 'user' },
    ],
  }))
}

test('a prompt is sized, metered as it runs, and remembered for the next estimate', async ($, on) => {
  mock.clock(on)
  const kept: Record<string, unknown> = {}
  session(on, kept)
  quiet(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('turn.step', async function* (_, e) {
    return {
      turnId: e.turnId,
      index: e.index,
      answer: 'done',
      toolUses: [],
      stopReason: 'end_turn',
      usage: {
        input_tokens: 1000,
        output_tokens: 500,
        cache_read_input_tokens: 9000,
        cache_creation_input_tokens: 2000,
        model: 'claude',
      },
    }
  })

  await $.session.start({ cwd: '/work/atlas', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'what does this function do?', turnId: 'turn-1' })
  for (const index of [0, 1]) {
    const stream = $.turn.step({ turnId: 'turn-1', index, model: 'claude', messageCount: 1 })
    for await (const chunk of stream) void chunk
  }

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...MOUNT, surface })
    await ui.press({ key: 'view-resources' })
    // Two requests of 1000 in, 2000 cached anew and 500 out; cache reads apart.
    expect(await ui.find({ type: 'Text', text: '7.0k of 6.0k–23k' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /2 requests · 1.0k written · 18k from cache/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /10% · 20k of 200k/ })).toBeDefined()
    await ui.unmount()
  }

  await $.turn.complete({
    answer: 'done',
    durationMs: 4000,
    isAborted: false,
    turnId: 'turn-1',
    reason: 'answer',
  })
  expect(kept['history:/work/atlas']).toEqual([
    { size: 'S', tokens: 7000, ms: 4000, tools: 0, agents: 0, at: 0 },
  ])
  expect(kept['project:/work/atlas']).toMatchObject({ name: 'atlas', sessions: 1, turns: 1, tokens: 7000 })
})

test('a session lists the skills on offer and marks the ones used', async ($, on) => {
  mock.clock(on)
  session(on, {})
  quiet(on)
  on('skill.prompt', (_, e) => ({ text: e.text }))

  await $.session.start({ cwd: '/work/atlas', surface: 'terminal', isInteractive: true })
  await $.skill.prompt({ skill: 'security-review', text: 'Review the changes.' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...MOUNT, surface })
    await ui.press({ key: 'view-skills' })
    expect(await ui.find({ type: 'Text', text: '✦ security-review' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: '/help' })).toBeUndefined()
    await ui.unmount()
  }
})

test('guidance joins the system prompt, and can be switched off', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'Hello.', scope: 'shared' }] }))
  const composed = await $.prompt.compose({
    model: 'claude',
    promptModel: 'claude',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  expect(composed.sections.map(section => section.id)).toEqual(['intro', 'polis:guidance'])
})

test('with guidance off the system prompt is left alone', { options: { guidance: false } }, async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'Hello.', scope: 'shared' }] }))
  const composed = await $.prompt.compose({
    model: 'claude',
    promptModel: 'claude',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  expect(composed.sections.map(section => section.id)).toEqual(['intro'])
})

test('on the desktop, in VS Code and on mobile every agent has an icon, and a glyph in a terminal', async ($, on) => {
  mock.clock(on)
  mock.store(on)
  quiet(on)
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'agent-1' }))
  await $.agent.spawn({
    tool_use_id: 'a1',
    prompt: 'Find every caller of parse()',
    description: 'Find parse callers',
    subagentType: 'Explore',
    provider: { plugin: 'engine', tier: 'core' },
    parentModel: 'opus',
    background: true,
    fork: false,
  })

  for (const surface of VECTOR) {
    const ui = await $.ui.mount({ ...MOUNT, surface })
    await ui.press({ key: 'view-agents' })
    const icons = await ui.findAll({ type: 'Svg' })
    // The main session's, then the one agent's.
    expect(icons).toHaveLength(2)
    expect(String(icons[0]?.props.alt)).toBe('main agent')
    expect(String(icons[1]?.props.alt)).toBe('Explore agent')
    for (const icon of icons) {
      expectDrawable(icon)
      expect(icon.props).toMatchObject({ width: 56, height: 56 })
    }
    // The icon stands in for the glyph; it is not beside it.
    expect(await ui.find({ type: 'Text', text: /^◎$/ })).toBeUndefined()
    await ui.unmount()
  }

  const terminal = await $.ui.mount({ ...MOUNT, surface: 'terminal' })
  await terminal.press({ key: 'view-agents' })
  expect(await terminal.findAll({ type: 'Svg' })).toHaveLength(0)
  expect(await terminal.find({ type: 'Text', text: /^◆$/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /^◎$/ })).toBeDefined()
  await terminal.unmount()
})

test('every view draws on every surface once the session is busy', async ($, on) => {
  mock.clock(on)
  session(on, {})
  quiet(on)
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))
  on('tool.call', { tool: 'Edit' }, () => ({ result: {} as never }))
  on('tool.call', { tool: 'Bash' }, () => ({
    result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'bash_1' },
  }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'agent-1' }))

  await $.session.start({ cwd: '/work/atlas', surface: 'terminal', isInteractive: true })
  await $.turn.start({ text: 'Build the docs site', turnId: 'turn-1' })
  await $.tool.call({
    tool: 'TodoWrite',
    tool_use_id: 'w1',
    todos: [
      { content: 'Write the docs', status: 'in_progress', activeForm: 'Writing the docs' },
      { content: 'Test the build', status: 'pending', activeForm: 'Testing the build' },
      { content: 'Set up the config', status: 'completed', activeForm: 'Setting up' },
    ],
  })
  await $.agent.spawn({
    tool_use_id: 'a1',
    prompt: 'Write the docs pages',
    description: 'Write the docs',
    subagentType: 'polis:worker',
    provider: { plugin: 'polis', tier: 'user' },
    parentModel: 'opus',
    background: true,
    fork: false,
  })
  await $.tool.call({ tool: 'Edit', tool_use_id: 'e1', file_path: '/work/atlas/docs/index.md', old_string: 'a', new_string: 'b' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'npm run dev', run_in_background: true })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...MOUNT, surface })
    for (const view of VIEWS) {
      await ui.press({ key: `view-${view}` })
      expect(await ui.find({ type: 'Button', key: `view-${view}` })).toBeDefined()
      // The view pressed is the one drawn: its tab is the marked one.
      expect((await ui.find({ type: 'Button', key: `view-${view}` }))?.props.variant).toBe('primary')
      // Vectors only where the surface draws them: the city is one drawing,
      // the agents view an icon for the main session and one for the agent.
      const vectors = surface === 'terminal' ? 0 : view === 'city' ? 1 : view === 'agents' ? 2 : 0
      const drawn = await ui.findAll({ type: 'Svg' })
      expect(drawn).toHaveLength(vectors)
      for (const one of drawn) expectDrawable(one)
    }
    await ui.press({ key: 'view-overview' })
    expect(await ui.find({ type: 'Text', text: 'docs/index.md' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Agent started: Write the docs/ })).toBeDefined()
    expect(await ui.find({ type: 'Button', key: 'stop' })).toBeDefined()
    await ui.unmount()
  }
})

// What is expected of Claude Code for VS Code (`vscode`), in one place. Its
// table has Box, Text, Button and Svg among others and no Client, Raster or
// Image, and the mod has not been seen running there: this holds the mod to
// what that surface is declared to draw.
test('in VS Code the city is one bounded Svg, every agent has an icon, and the band opens the pane', async ($, on) => {
  mock.clock(on)
  session(on, {})
  const opened: string[] = []
  quiet(on, id => {
    opened.push(id)
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))
  let spawned = 0
  on('agent.spawn', () => {
    spawned += 1

    return { model: 'haiku', agentId: `agent-${spawned}` }
  })

  // No terminal at the start: the declarations give `surface: null` for a
  // session a host other than the REPL starts. The mod must not need one.
  await $.session.start({ cwd: '/work/atlas', surface: null, isInteractive: false })
  await $.turn.start({ text: 'Build the docs site', turnId: 'turn-1' })
  await $.tool.call({
    tool: 'TodoWrite',
    tool_use_id: 'w1',
    todos: [
      { content: 'Write the docs', status: 'in_progress', activeForm: 'Writing the docs' },
      { content: 'Test the build', status: 'pending', activeForm: 'Testing the build' },
      { content: 'Set up the config', status: 'completed', activeForm: 'Setting up' },
    ],
  })
  for (const [id, subagentType, description] of [
    ['a1', 'Explore', 'Find the docs pages'],
    ['a2', 'polis:worker', 'Write the docs'],
  ] as const) {
    await $.agent.spawn({
      tool_use_id: id,
      prompt: description,
      description,
      subagentType,
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'opus',
      background: true,
      fork: false,
    })
  }
  await $.skill.prompt({ skill: 'security-review', text: 'Review the changes.' })

  const tags = new Set<string>()

  // The band draws, and its City button opens the pane at the city. (This
  // build's engine raises `AbovePrompt` on the terminal and desktop only; the
  // mount holds the band's tree to the `vscode` table all the same.)
  const band = await $.ui.mount({ ...BAND, surface: 'vscode' })
  expect(await band.find({ type: 'Text', text: '1/3 tasks' })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'city' })).toMatchObject({ text: 'City' })
  tagsOf(await band.drawn(), tags)
  const before = opened.length
  await band.press({ key: 'city' })
  expect(opened.slice(before)).toEqual(['polis'])
  await band.unmount()

  const pane = await $.ui.mount({ ...MOUNT, surface: 'vscode' })
  expect((await pane.find({ type: 'Button', key: 'view-city' }))?.props.variant).toBe('primary')

  // The city: one `Svg`, its source non-empty and under the limit, with an
  // alt text that says what the map shows.
  const cities = await pane.findAll({ type: 'Svg' })
  expect(cities).toHaveLength(1)
  const city = cities[0]
  const source = expectDrawable(city)
  expect(source.length).toBeGreaterThan(0)
  expect(source.length).toBeLessThan(SVG_LIMIT)
  expect(String(city?.props.alt)).toContain('City map of atlas')
  expect(String(city?.props.alt)).toContain('1 of 3 tasks done')
  expect(String(city?.props.alt)).toContain('2 agents working')
  expect(city?.props.isInteractive).toBe(true)
  // Every task is a building and names itself to a pointer.
  for (const subject of ['Write the docs', 'Test the build', 'Set up the config']) {
    expect(source).toContain(`<title>${subject} · `)
  }
  tagsOf(await pane.drawn(), tags)

  // Every agent has an icon: the main session's, then one per agent.
  await pane.press({ key: 'view-agents' })
  const icons = await pane.findAll({ type: 'Svg' })
  expect(icons.map(icon => String(icon.props.alt))).toEqual([
    'main agent holding pen and paper (plan)',
    'Explore agent',
    'polis:worker agent',
  ])
  for (const icon of icons) {
    expectDrawable(icon)
    expect(icon.props).toMatchObject({ width: 56, height: 56 })
  }
  expect(await pane.find({ type: 'Text', text: 'Find the docs pages' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /polis:worker · running/ })).toBeDefined()
  tagsOf(await pane.drawn(), tags)

  // The text views draw there as they do everywhere.
  for (const view of VIEWS) {
    await pane.press({ key: `view-${view}` })
    expect((await pane.find({ type: 'Button', key: `view-${view}` }))?.props.variant).toBe('primary')
    tagsOf(await pane.drawn(), tags)
  }
  await pane.press({ key: 'view-skills' })
  expect(await pane.find({ type: 'Text', text: '✦ security-review' })).toBeDefined()
  await pane.press({ key: 'view-overview' })
  expect(await pane.find({ type: 'Button', key: 'stop' })).toBeDefined()
  await pane.unmount()

  // Nothing drawn there needs an element the `vscode` table lacks.
  expect([...tags].sort()).toEqual(['Box', 'Button', 'Svg', 'Text'])
})

// A board as full as the map shows: eleven districts of sixteen tasks, done,
// in progress, planned and blocked, and twenty-four agents at work.
const fillCity = async ($: Engine, on: On, subject: (index: number) => string): Promise<void> => {
  let made = 0
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => {
    made += 1

    return { result: { task: { id: String(made), subject: e.subject } } }
  })
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: [] },
  }))
  let spawned = 0
  on('agent.spawn', () => {
    spawned += 1

    return { model: 'haiku', agentId: `agent-${spawned}` }
  })

  for (let index = 1; index <= 11 * 16; index += 1) {
    const taskId = String(index)
    await $.tool.call({
      tool: 'TaskCreate',
      tool_use_id: `create-${index}`,
      subject: subject(index),
      description: '',
      metadata: { area: `area-${Math.ceil(index / 16)}` },
    })
    if (index % 3 === 0) {
      await $.tool.call({ tool: 'TaskUpdate', tool_use_id: `update-${index}`, taskId, status: 'completed' })
    } else if (index % 3 === 1) {
      await $.tool.call({ tool: 'TaskUpdate', tool_use_id: `update-${index}`, taskId, status: 'in_progress' })
    } else {
      await $.tool.call({
        tool: 'TaskUpdate',
        tool_use_id: `update-${index}`,
        taskId,
        addBlockedBy: [String(index - 1)],
      })
    }
  }
  for (let index = 1; index <= 24; index += 1) {
    await $.agent.spawn({
      tool_use_id: `agent-${index}`,
      prompt: subject(index),
      description: subject(index),
      subagentType: index % 2 === 0 ? 'polis:worker' : 'Explore',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'opus',
      background: true,
      fork: false,
    })
  }
}

// The city of that board on each surface that draws vectors: the surfaces
// that drew it within the limit, and what the rest refused it with.
const drawCity = async ($: Engine): Promise<{ drawn: string[]; refused: string[] }> => {
  const drawn: string[] = []
  const refused: string[] = []
  for (const surface of VECTOR) {
    // Once the city is the view, a surface that refuses it refuses the mount.
    const ui = await $.ui.mount({ ...MOUNT, surface }).catch((error: unknown) => {
      refused.push(`${surface}: ${String(error)}`)

      return undefined
    })
    if (ui === undefined) continue
    try {
      await ui.press({ key: 'view-city' })
      const cities = await ui.findAll({ type: 'Svg' })
      expect(cities).toHaveLength(1)
      expectDrawable(cities[0])
      expect(String(cities[0]?.props.alt)).toContain('11 districts, 58 of 176 tasks done, 24 agents working')
      // The view's tabs are part of the same tree: they are there to leave by.
      expect(await ui.find({ type: 'Button', key: 'view-tasks' })).toBeDefined()
      drawn.push(surface)
    } catch (error) {
      refused.push(`${surface}: ${String(error)}`)
    } finally {
      await ui.unmount().catch(() => undefined)
    }
  }

  return { drawn, refused }
}

test('a full city fits the Svg limit wherever it is a vector drawing', { timeoutMs: 20_000 }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  quiet(on)
  // Task names as a todo list usually has them: about sixty characters.
  await fillCity($, on, index => `Task ${index}: implement the next part and check that it works`)

  expect(await drawCity($)).toEqual({ drawn: [...VECTOR], refused: [] })
})

// A building's tooltip carries its task's name, clipped, and the city drops
// its tooltips before it would pass the limit: names of any length still draw.
test('a full city of long task names still fits the Svg limit', { timeoutMs: 20_000 }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  quiet(on)
  // Sentence-long task names, 240 characters each: the engine refuses the
  // whole pane, tabs included, when the drawing passes the limit.
  const tail = 'implement the next part of the plan and check that it works as described, '.repeat(4)
  await fillCity($, on, index => `Task ${index}: ${tail}`.slice(0, 240))

  expect(await drawCity($)).toEqual({ drawn: [...VECTOR], refused: [] })
})
