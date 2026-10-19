// The flow's phase: which skill Claude invoked last says what the work is,
// whether the person should stay close (HITL) or can walk away (AFK), and
// where the work goes next.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import { flowOf } from '../hooks/flow'

const ROOT = '/work/atlas'
const PAGE = '/work/atlas/.polis/city.html'
const MINUTE = 60_000

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

type World = {
  clock: MockClock
  /** The last status line the mod set, or undefined once it cleared it. */
  status: () => string | undefined
  /** The city page's header facts as last written, tags stripped. */
  page: () => string
  /** The system prompt sections and tools the mod gave Claude. */
  told: { sections: string[]; tools: string[] }
}

// A session in /work/atlas on a terminal, outside a repository.
const world = (on: On): World => {
  const clock = mock.clock(on)
  const kept: Record<string, unknown> = {}
  const files = new Map<string, string>()
  let status: string | undefined
  const told: World['told'] = { sections: [], tools: [] }
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('fs.exists', (_, e) => ({ value: files.has(e.path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')) }))
  on('fs.write', (_, e) => {
    files.set(e.path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/'), e.text)

    return { value: undefined }
  })
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.repo', () => ({ value: null }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 20_000, percent: 10 }, rateLimits: [] },
  }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', (_, e) => {
    status = e.text === '' ? undefined : e.text

    return { value: undefined }
  })
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('tool.register', (_, e) => {
    told.tools.push(e.name)

    return { value: { tool: e.name } }
  })
  on('agent.register', (_, e) => ({ value: { agent: e.name } }))
  let spawned = 0
  on('agent.spawn', () => {
    spawned += 1

    return { model: 'haiku', agentId: `agent-${spawned}` }
  })
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('prompt.submit', (_, e) => ({ text: e.text }) as never)
  on('prompt.compose', () => ({ sections: [] }))
  on('classic.PermissionRequest', () => ({}))
  on('classic.SubagentStop', () => ({}))
  on('tool.call', { tool: 'Skill' }, () => ({ result: { success: true } }) as never)
  let made = 0
  on('tool.call', { tool: 'TaskCreate' }, (_, e) => {
    made += 1

    return { result: { task: { id: String(made), subject: e.subject } } }
  })
  on('tool.call', { tool: 'TaskUpdate' }, (_, e) => ({
    result: { success: true, taskId: e.taskId, updatedFields: [] },
  }))
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }) as never)

  return {
    clock,
    status: () => status,
    page: () => {
      const header = /<header>(.*?)<\/header>/s.exec(files.get(PAGE) ?? '')?.[1] ?? ''

      return header
        .replace(/<p>.*<\/p>/s, '')
        .replace(/<h1>.*?<\/h1>/, '')
        .replace(/<span><a .*?<\/a><\/span>/, '')
        .replace(/<span[^>]*>/g, '')
        .replace(/<\/span>/g, ' | ')
    },
    told,
  }
}

const START = { cwd: ROOT, surface: null, isInteractive: false } as const

const turnEnd = (turnId: string) =>
  ({ answer: 'done', durationMs: 4000, isAborted: false, turnId, reason: 'answer' }) as const

const skill = ($: Engine, name: string, agentId?: string) =>
  $.tool.call({ tool: 'Skill', tool_use_id: `s-${name}`, skill: name, ...(agentId === undefined ? {} : { agentId }) } as never)

// The band's texts at a width.
const banded = async ($: Engine, columns = 200): Promise<string[]> => {
  const ui = await $.ui.mount({ ...bandAt(columns), surface: 'terminal' })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()

  return texts
}

// The page is rewritten on its two-second clock.
const paged = async (here: World): Promise<string> => {
  await here.clock.advance(2000)

  return here.page()
}

test('HITL work shows first on the band, the status line and the city page while working, and the next step stays', async ($, on) => {
  const here = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Grill me on the parser', turnId: 'turn-1' })
  await skill($, 'mattpocock-skills:grilling')

  // The status line stands in for the band only until a surface draws one.
  expect(here.status()).toBe('◆ HITL: grilling · next: /to-spec · ctx 20k')
  expect(await paged(here)).toBe('◆ HITL: grilling | next: /to-spec | ctx 20k | ')
  expect(await banded($)).toEqual(['◆ HITL: grilling', 'next: /to-spec', 'ctx 20k'])

  // Idle: nothing new but the next step.
  await $.turn.complete(turnEnd('turn-1'))
  expect(await banded($)).toEqual(['next: /to-spec', 'ctx 20k'])
  expect(await paged(here)).toMatch(/^(idle|your turn) \| next: \/to-spec \| ctx 20k \| $/)
})

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const WORKER = {
  tool_use_id: 'a1',
  prompt: 'Do it',
  description: 'Write the table',
  subagentType: 'polis:worker',
  provider: { plugin: 'polis', tier: 'user' },
  parentModel: 'opus',
  background: true,
  fork: false,
} as const

test('AFK work names its phase, the agents running and the tasks done while working', async ($, on) => {
  const here = world(on)
  await $.session.start(START)
  await $.prompt.submit({ text: '/implement', command: { name: 'implement', args: '' } } as never)
  await $.turn.start({ text: 'Implement #51', turnId: 'turn-1' })
  expect(here.status()).toBe('◇ AFK: implementing · next: /code-review · ctx 20k')

  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 't1', subject: 'Write the table', description: '' })
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 't2', subject: 'Show it', description: '' })
  await $.tool.call({ tool: 'TaskUpdate', tool_use_id: 't3', taskId: '1', status: 'completed' })
  await $.agent.spawn({ ...WORKER, tool_use_id: 'a1' })
  await $.agent.spawn({ ...WORKER, tool_use_id: 'a2' })
  expect(here.status()).toBe('◇ AFK: implementing · 2 agents · 1/2 · next: /code-review · ctx 20k · 1/2 tasks')
})

test('/orchestrate is AFK work, orchestrating', async ($, on) => {
  const here = world(on)
  await $.session.start(START)
  await $.command.run({ command: 'orchestrate', args: 'Ship the parser', ...TYPED })
  await $.turn.start({ text: 'Act as the orchestrator', turnId: 'turn-1' })

  expect(here.status()).toBe('◇ AFK: orchestrating · next: review the reports · ctx 20k')
})

test('a phase lasts through skills off the table and subagents’ skills, and ends with /clear', async ($, on) => {
  const here = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Write the spec', turnId: 'turn-1' })
  await skill($, 'to-spec')
  await skill($, 'frontend-design')
  await skill($, 'grilling', 'agent-9')
  expect(here.status()).toBe('◆ HITL: writing the spec · next: /to-tickets · ctx 20k')

  await $.session.end({ reason: 'clear', sessionId: 'session-1' } as never)
  await $.turn.start({ text: 'Something else', turnId: 'turn-2' })
  await skill($, 'frontend-design')
  expect(here.status()).toBe('ctx 20k')
})

test('off the flow there is no phase and no next step, and AFK shows only while an agent runs or after two minutes', async ($, on) => {
  const here = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Fix the build', turnId: 'turn-1' })
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'ls' })
  expect(here.status()).toBe('ctx 20k')

  await here.clock.advance(2 * MINUTE)
  expect(here.status()).toBe('◇ AFK: working · ctx 20k')

  await $.turn.complete(turnEnd('turn-1'))
  expect(here.status()).toBe('ctx 20k')

  await $.turn.start({ text: 'Fix the tests', turnId: 'turn-2' })
  await $.agent.spawn({ ...WORKER, tool_use_id: 'a1' })
  expect(here.status()).toBe('◇ AFK: working · 1 agent · ctx 20k')
})

test('off the flow, a turn that has put anything to the person is not AFK work by its length, even once answered', async ($, on) => {
  const here = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Clean the build', turnId: 'turn-1' })
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })
  // The person allowed it: the call runs and ends, and nothing is open now.
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'rm -rf build' })
  expect(here.status()).toBe('ctx 20k')

  await here.clock.advance(3 * MINUTE)
  expect(here.status()).toBe('ctx 20k')

  // The next turn starts afresh.
  await $.turn.complete(turnEnd('turn-1'))
  await $.turn.start({ text: 'Fix the build', turnId: 'turn-2' })
  await here.clock.advance(2 * MINUTE)
  expect(here.status()).toBe('◇ AFK: working · ctx 20k')
})

test('needs you takes the first slot over HITL work', async ($, on) => {
  const here = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Grill me', turnId: 'turn-1' })
  await skill($, 'grill-me')
  await $.classic.PermissionRequest({ tool_name: 'Bash', tool_input: { command: 'rm -rf build' } })

  expect(here.status()).toBe('▲ needs you: permission for Bash · next: /to-spec · ctx 20k')
})

test('as the band narrows it drops tasks done, the smart-zone tail, the smart zone, the next step, the limit warning, then AFK work', { timeoutMs: 20_000 }, async ($, on) => {
  const here = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Cut the tickets', turnId: 'turn-1' })
  await skill($, 'to-tickets')
  await $.tool.call({ tool: 'TaskCreate', tool_use_id: 't1', subject: 'Cut them', description: '' })
  const resetsAt = new Date(here.clock.now() + 4 * 3_600_000).toISOString()
  const measure = (percentUsed: number) =>
    $.session.measure({
      context: { window: 200_000, tokens: 151_000, percent: 76 },
      rateLimits: [{ kind: 'five_hour', percentUsed, resetsAt }],
      changed: ['context', 'rateLimits'],
    } as never)
  await measure(40)
  await here.clock.advance(12 * MINUTE)
  await measure(60)
  // Work that moves is not stalled.
  await $.tool.call({ tool: 'Bash', tool_use_id: 'b1', command: 'ls' })

  const rows: string[][] = []
  for (let columns = 200; columns >= 10; columns -= 1) {
    const row = (await banded($, columns)).map(one => (one.startsWith('⚠ 5h') ? '⚠ limit' : one))
    if (JSON.stringify(rows.at(-1)) !== JSON.stringify(row)) rows.push(row)
  }
  const AFK = '◇ AFK: cutting tickets · 0/1'
  const NEXT = 'next: /clear, then /implement'
  expect(rows).toEqual([
    [AFK, '⚠ limit', NEXT, 'ctx 151k · out of the smart zone', '0/1 tasks'],
    [AFK, '⚠ limit', NEXT, 'ctx 151k · out of the smart zone'],
    [AFK, '⚠ limit', NEXT, 'ctx 151k'],
    [AFK, '⚠ limit', NEXT],
    [AFK, '⚠ limit', 'next: /clear'],
    [AFK, '⚠ limit'],
    [AFK],
    [],
  ])
})

test('nothing new reaches Claude’s system prompt or tool list', async ($, on) => {
  const here = world(on)
  await $.session.start(START)
  await $.turn.start({ text: 'Grill me', turnId: 'turn-1' })
  await skill($, 'grilling')
  const composed = await $.prompt.compose({
    model: 'claude',
    promptModel: 'claude',
    surfaces: ['terminal'],
    tools: [],
    outputStyle: null,
    traits: [],
  })

  expect(composed.sections.map(section => section.id)).toEqual(['polis:guidance'])
  expect(here.told.tools).toEqual(['project'])
})

const ROWS = [
  ['grilling', 'grilling', 'HITL', '/to-spec'],
  ['grill-me', 'grilling', 'HITL', '/to-spec'],
  ['grill-with-docs', 'grilling', 'HITL', '/to-spec'],
  ['domain-modeling', 'grilling', 'HITL', '/to-spec'],
  ['prototype', 'prototyping', 'HITL', 'back to grilling'],
  ['wayfinder', 'wayfinding', 'HITL', "the map's next ticket"],
  ['to-spec', 'writing the spec', 'HITL', '/to-tickets'],
  ['to-tickets', 'cutting tickets', 'AFK', '/clear, then /implement'],
  ['to-ticket', 'cutting tickets', 'AFK', '/clear, then /implement'],
  ['implement', 'implementing', 'AFK', '/code-review'],
  ['implement-spec', 'implementing', 'AFK', '/code-review'],
  ['tdd', 'implementing', 'AFK', '/code-review'],
  ['research', 'researching', 'AFK', 'back to the ticket that asked'],
  ['code-review', 'reviewing', 'AFK', 'merge or fix'],
  ['diagnosing-bugs', 'diagnosing', 'AFK', '/code-review'],
  ['orchestrate', 'orchestrating', 'AFK', 'review the reports'],
] as const

for (const [skill, phase, kind, next] of ROWS) {
  test(`${skill} is ${kind} work, ${phase}, then ${next}`, () => {
    expect(flowOf(skill)).toMatchObject({ phase, kind, next })
  })
}

test('a plugin-prefixed skill is read by its name after the colon', () => {
  expect(flowOf('mattpocock-skills:grilling')).toMatchObject({ phase: 'grilling', kind: 'HITL' })
  expect(flowOf('polis:orchestrate')).toMatchObject({ phase: 'orchestrating', kind: 'AFK' })
})

test('a slash command names its skill', () => {
  expect(flowOf('/to-spec')).toMatchObject({ phase: 'writing the spec' })
})

test('a skill off the table has no phase', () => {
  expect(flowOf('frontend-design')).toBeUndefined()
  expect(flowOf('')).toBeUndefined()
})

test('a next step of more than one move starts with its first', () => {
  expect(flowOf('to-tickets')?.first).toBe('/clear')
  expect(flowOf('to-spec')?.first).toBe('/to-tickets')
})
