// How the mod behaves under different hosts: a surface that places panes, one
// that does not, and a session nothing draws for (an editor's chat panel, a
// headless run).
import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

const PANE = {
  title: 'Polis',
  isFocused: false,
  bodyColumns: 70,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const

const MOUNT = { plugin: 'polis', component: 'Pane', requestId: 'polis', props: PANE } as const

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

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const TODOS = [
  { content: 'One', status: 'completed', activeForm: 'One' },
  { content: 'Two', status: 'in_progress', activeForm: 'Doing two' },
] as const

type World = { surfaces: readonly ('terminal' | 'desktop' | 'vscode' | 'mobile')[]; isPlaced: boolean }

// The engine beneath the mod, recording what the mod asked of it.
const world = (on: On, { surfaces, isPlaced }: World): string[] => {
  const calls: string[] = []
  mock.clock(on)
  mock.store(on)
  on('session.surfaces', () => ({ value: surfaces }))
  on('ui.status', (_, e) => {
    calls.push(`status:${JSON.stringify(e)}`)

    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    calls.push(`toast:${JSON.stringify(e)}`)

    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', (_, e) => {
    calls.push(`open:${JSON.stringify({ id: e.id, rows: e.rows, columns: e.columns })}`)

    return {
      value: isPlaced ? { isPlaced: true } : { isPlaced: false, reason: 'no attached surface places panes' },
    }
  })
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))

  return calls
}

test('/city opens the pane and asks for room enough for the city', async ($, on) => {
  const calls = world(on, { surfaces: ['desktop'], isPlaced: true })
  const ran = await $.command.run({ command: 'city', args: '', ...TYPED })
  expect(ran.text).toBe('Polis opened.')
  expect(calls).toContain('open:{"id":"polis","rows":46,"columns":68}')
})

test('/city says so, and gives the board as text, when the pane is not drawn', async ($, on) => {
  world(on, { surfaces: ['desktop'], isPlaced: false })
  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 't1', todos: [...TODOS] })
  const ran = await $.command.run({ command: 'city', args: '', ...TYPED })
  expect(ran.text).toStartWith('Polis is open but not drawn here yet: no attached surface places panes')
  expect(ran.text).toContain('Tasks: 1 done · 1 active · 0 waiting')
})

test('/city answers with the board as text where no surface draws at all', async ($, on) => {
  const calls = world(on, { surfaces: [], isPlaced: true })
  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 't1', todos: [...TODOS] })
  const ran = await $.command.run({ command: 'city', args: '', ...TYPED, origin: { kind: 'sdk' } })
  expect(ran.text).toStartWith('Polis · ')
  expect(ran.text).toContain('Progress: 75% (1/2 tasks)')
  expect(ran.text).toContain('  ▶ Doing two')
  // Nothing was opened on /city's account: there is nowhere to draw it.
  expect(calls.filter(call => call.startsWith('open:'))).toHaveLength(1)
})

test('with no band asked for, the status line carries the progress', async ($, on) => {
  const calls = world(on, { surfaces: ['vscode'], isPlaced: true })
  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 't1', todos: [...TODOS] })
  expect(calls.filter(call => call.startsWith('status:')).at(-1)).toBe('status:{"text":"◆ 1/2 tasks"}')
})

test('once a surface asks for the band, the status line is cleared', async ($, on) => {
  const calls = world(on, { surfaces: ['terminal'], isPlaced: true })
  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 't1', todos: [...TODOS] })
  expect(calls.filter(call => call.startsWith('status:')).at(-1)).toBe('status:{}')
  await band.unmount()
})

test('Orchestrate says what to type where the surface has its own composer', async ($, on) => {
  const calls = world(on, { surfaces: ['vscode'], isPlaced: true })
  on('prompt.fill', () => ({ isFilled: false, refusal: 'no_composer' }))
  const ui = await $.ui.mount({ ...MOUNT, surface: 'vscode' })
  await ui.press({ key: 'view-overview' })
  await ui.press({ key: 'orchestrate' })
  await ui.unmount()
  expect(calls).toContain('toast:{"text":"Type /orchestrate <goal> to plan it and run it with agents"}')
})

test('where nothing draws, the system prompt is left alone', async ($, on) => {
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'Hello.', scope: 'shared' }] }))
  const composed = await $.prompt.compose({
    model: 'claude',
    promptModel: 'claude',
    surfaces: [],
    tools: [],
    outputStyle: null,
    traits: [],
  })
  expect(composed.sections.map(section => section.id)).toEqual(['intro'])
})

test('the city stands alone in its view, with no caption under it', async ($, on) => {
  world(on, { surfaces: ['desktop', 'mobile'], isPlaced: true })
  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...MOUNT, surface })
    await ui.press({ key: 'view-city' })
    expect(await ui.find({ type: 'Svg' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Buildings are tasks/ })).toBeUndefined()
    await ui.unmount()
  }
})

// The desktop app docks the pane about twenty columns wide when the
// conversation shares its window with other panes.
const NARROW = { ...MOUNT, props: { ...PANE, bodyColumns: 21 } } as const

test('a narrow pane gets the city one block wide and stacks its bars under their labels', async ($, on) => {
  world(on, { surfaces: ['desktop'], isPlaced: true })
  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 't1', todos: [...TODOS] })

  for (const surface of ['desktop', 'vscode', 'mobile'] as const) {
    const narrow = await $.ui.mount({ ...NARROW, surface })
    await narrow.press({ key: 'view-city' })
    expect(String((await narrow.find({ type: 'Svg' }))?.props.source)).toContain('>main session ')
    await narrow.unmount()

    const wide = await $.ui.mount({ ...MOUNT, surface })
    expect(String((await wide.find({ type: 'Svg' }))?.props.source)).toContain('>session ')
    await wide.unmount()
  }

  for (const surface of ['terminal', 'desktop', 'vscode', 'mobile'] as const) {
    const ui = await $.ui.mount({ ...NARROW, surface })
    for (const view of ['overview', 'city', 'tasks', 'agents', 'resources', 'skills']) {
      await ui.press({ key: `view-${view}` })
    }
    await ui.press({ key: 'view-overview' })
    // The figure sits beside the label and the bar gets a row of its own.
    expect(await ui.find({ type: 'Text', text: '75% · 1/2 tasks' })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /^█{15}$/ })).toBeDefined()
    await ui.unmount()
  }
})

test('where the host has no task tool, the project tool records the tasks', async ($, on) => {
  world(on, { surfaces: ['desktop'], isPlaced: true })
  on('session.cwd', () => ({ value: '/work/atlas' }))
  on('agent.spawn', () => ({ model: 'haiku', agentId: 'agent-1' }))

  const first = await $.tool.call({
    tool: 'mcp__polis__project',
    tool_use_id: 'p1',
    tasks: [
      { id: 'guide', subject: 'Write the city guide', area: 'docs' },
      { id: 'pictures', subject: 'Draw the illustrations', area: 'images' },
      { id: 'check', subject: 'Check the manual', area: 'tests', blockedBy: ['guide'] },
    ],
  })
  expect(first.text ?? String(first.result)).toContain('Tasks: 0 done, 0 active, 3 waiting.')

  await $.agent.spawn({
    tool_use_id: 'a1',
    prompt: 'Write it',
    description: 'Something else entirely',
    name: 'writer',
    subagentType: 'polis:worker',
    provider: { plugin: 'polis', tier: 'user' },
    parentModel: 'opus',
    background: true,
    fork: false,
  })
  const second = await $.tool.call({
    tool: 'mcp__polis__project',
    tool_use_id: 'p2',
    tasks: [
      { id: 'guide', status: 'in_progress', owner: 'writer' },
      { id: 'pictures', status: 'completed' },
    ],
  })
  expect(second.text ?? String(second.result)).toContain('Tasks: 1 done, 1 active, 1 waiting.')

  const ui = await $.ui.mount({ ...MOUNT, surface: 'terminal' })
  await ui.press({ key: 'view-tasks' })
  expect(await ui.find({ type: 'Text', text: 'waits on guide' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '@writer' })).toBeDefined()
  await ui.press({ key: 'view-agents' })
  // The owner of the task in progress stands at it.
  expect(await ui.find({ type: 'Text', text: '→ Write the city guide' })).toBeDefined()
  await ui.unmount()
})
