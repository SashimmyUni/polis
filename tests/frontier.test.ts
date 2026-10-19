// The wayfinder frontier in the Tasks view: read through `gh` at the start
// of a session and as a turn comes back, at most every five minutes, and
// shown per open map. Where `gh`, a GitHub remote or a map is missing,
// nothing shows and nothing is said.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

const ROOT = '/work/atlas'

const PANE = {
  plugin: 'polis',
  component: 'Pane',
  requestId: 'polis',
  props: {
    title: 'Polis',
    isFocused: false,
    bodyColumns: 70,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 60 },
    view: {},
  },
} as const

const START = { cwd: ROOT, surface: null, isInteractive: false } as const

const NO_PAGE = { options: { page: false } } as const

const turnEnd = (turnId: string) =>
  ({ answer: 'done', durationMs: 4000, isAborted: false, turnId, reason: 'answer' }) as const

// Recorded from SashimmyUni/polis on 2026-10-19 with the commands the mod runs.
const MAPS =
  '[{"number":42,"title":"Map: Cut Polis\'s overhead"},{"number":14,"title":"Map: refine Polis\'s UI/UX to be minimal, actionable and unambiguous"},{"number":4,"title":"Map: build the smart-zone, city-page and full-city prototype"}]\n'

const TICKETS: Record<string, string> = {
  42: '[{"assignees":["SashimmyUni"],"blockedBy":0,"labels":["wayfinder:task"],"number":43,"state":"closed","title":"Measure Polis\'s overhead baseline"},{"assignees":["SashimmyUni"],"blockedBy":0,"labels":["wayfinder:research"],"number":44,"state":"closed","title":"How Claude Code charges for a mod\'s text"},{"assignees":[],"blockedBy":0,"labels":["wayfinder:grilling"],"number":45,"state":"open","title":"Derive task area and parent without asking Claude"},{"assignees":[],"blockedBy":0,"labels":["wayfinder:grilling"],"number":46,"state":"open","title":"Which prompted tool calls the core features need"},{"assignees":[],"blockedBy":0,"labels":["wayfinder:grilling"],"number":47,"state":"open","title":"Trim the turn-sizing model call"},{"assignees":[],"blockedBy":0,"labels":["wayfinder:grilling"],"number":48,"state":"open","title":"Defer the project tool or slim its schema"}]\n',
  14: '[{"assignees":["SashimmyUni"],"blockedBy":0,"labels":["wayfinder:task"],"number":15,"state":"closed","title":"Inconsistency audit of every user-facing string"},{"assignees":[],"blockedBy":0,"labels":["wayfinder:research"],"number":16,"state":"closed","title":"What interactions can a Polis pane and band offer on each host"},{"assignees":["SashimmyUni"],"blockedBy":0,"labels":["wayfinder:grilling"],"number":17,"state":"closed","title":"Which views the pane keeps, and what each is for"},{"assignees":["SashimmyUni"],"blockedBy":0,"labels":["wayfinder:grilling"],"number":18,"state":"closed","title":"Which elements the band and status line carry"},{"assignees":[],"blockedBy":1,"labels":["wayfinder:prototype"],"number":19,"state":"open","title":"One meaning per color and glyph, and where the legend lives"},{"assignees":["SashimmyUni"],"blockedBy":0,"labels":["wayfinder:grilling"],"number":20,"state":"closed","title":"The /city command grammar"},{"assignees":[],"blockedBy":0,"labels":["wayfinder:grilling"],"number":21,"state":"closed","title":"One name per concept across UI, commands and docs"},{"assignees":[],"blockedBy":0,"labels":["wayfinder:grilling"],"number":22,"state":"open","title":"Which reading of context every surface shows"},{"assignees":[],"blockedBy":0,"labels":["wayfinder:grilling"],"number":23,"state":"closed","title":"How Polis reads the phase and picks the next step"}]\n',
  4: '[{"assignees":["SashimmyUni"],"blockedBy":0,"labels":["wayfinder:task"],"number":5,"state":"closed","title":"Smart-zone levels in the band and toasts"},{"assignees":[],"blockedBy":0,"labels":["wayfinder:task"],"number":10,"state":"closed","title":"Full city drawing with archived buildings and old towns"},{"assignees":[],"blockedBy":0,"labels":["wayfinder:task"],"number":13,"state":"closed","title":"Manual and README for the new features"}]\n',
}

// The recorded map 14 with four tickets reopened: an assigned task, an
// unassigned task, a research ticket and a grilling one.
const REOPENED_14 =
  '[{"assignees":["SashimmyUni"],"blockedBy":0,"labels":["wayfinder:task"],"number":15,"state":"open","title":"Inconsistency audit of every user-facing string"},{"assignees":[],"blockedBy":0,"labels":["wayfinder:research"],"number":16,"state":"open","title":"What interactions can a Polis pane and band offer on each host"},{"assignees":[],"blockedBy":1,"labels":["wayfinder:prototype"],"number":19,"state":"open","title":"One meaning per color and glyph, and where the legend lives"},{"assignees":[],"blockedBy":0,"labels":["wayfinder:task"],"number":20,"state":"open","title":"The /city command grammar"},{"assignees":["SashimmyUni","octocat"],"blockedBy":0,"labels":["wayfinder:grilling"],"number":21,"state":"open","title":"One name per concept across UI, commands and docs"},{"assignees":[],"blockedBy":0,"labels":["wayfinder:grilling"],"number":22,"state":"open","title":"Which reading of context every surface shows"}]\n'

type Gh = {
  /** Every `gh` command run, as `<argv> in <cwd> within <timeout>`. */
  runs: string[]
  /** What `gh` answers now: the outputs, a failure, or no `gh` at all. */
  answer: 'recorded' | 'reopened' | 'fails' | 'missing' | 'no maps'
  toasts: string[]
  logs: string[]
}

// The engine beneath the mod for a session in /work/atlas, with `gh` on the
// path answering from the recorded output.
const world = (on: On, kept: Record<string, unknown> = {}): Gh => {
  const gh: Gh = { runs: [], answer: 'recorded', toasts: [], logs: [] }
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.repo', () => ({ value: null }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 20_000, percent: 10 }, rateLimits: [] },
  }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', (_, e) => {
    gh.logs.push(String(e.text))

    return { value: undefined }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', (_, e) => {
    gh.toasts.push(e.text)

    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('agent.register', (_, e) => ({ value: { agent: e.name } }))
  on('turn.start', (_, e) => ({ turnId: e.turnId }))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('process.run', (_, e) => {
    const ok = (stdout: string) => ({ value: { exitCode: 0, stdout, stderr: '' } as never })
    if (e.argv[0] !== 'gh') return { value: { exitCode: 128, stdout: '', stderr: 'not a repository' } as never }
    gh.runs.push(`${e.argv.join(' ')} in ${e.init?.cwd} within ${e.init?.timeoutMs}`)
    if (gh.answer === 'missing') throw new Error('spawn gh ENOENT')
    if (gh.answer === 'fails') {
      return { value: { exitCode: 1, stdout: '', stderr: 'error connecting to api.github.com' } as never }
    }
    if (e.argv[1] === 'issue') return ok(gh.answer === 'no maps' ? '[]\n' : MAPS)
    const map = /issues\/(\d+)\/sub_issues/.exec(e.argv[2] ?? '')?.[1] ?? ''

    return ok(gh.answer === 'reopened' && map === '14' ? REOPENED_14 : (TICKETS[map] ?? '[]\n'))
  })

  return gh
}

// The Tasks view's texts from its FRONTIER heading on, in the order drawn.
const frontier = async ($: Engine): Promise<string[]> => {
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'view-tasks' })
  const texts = (await ui.findAll({ type: 'Text' })).map(one => one.text)
  await ui.unmount()
  const at = texts.indexOf('FRONTIER')

  return at < 0 ? [] : texts.slice(at)
}

test('the recorded maps show each open map with its open, unblocked, unclaimed tickets, HITL counted', NO_PAGE, async ($, on) => {
  const clock = mock.clock(on)
  const gh = world(on)

  await $.session.start(START)
  await clock.settle()

  expect(gh.runs).toEqual([
    `gh issue list --label wayfinder:map --state open --json number,title --limit 50 in ${ROOT} within 10000`,
    expect.stringMatching(/^gh api repos\/\{owner\}\/\{repo\}\/issues\/42\/sub_issues\?per_page=100 --jq .* within 10000$/),
    expect.stringMatching(/issues\/14\/sub_issues/),
    expect.stringMatching(/issues\/4\/sub_issues/),
  ])
  // Map 4 has nothing open and is left out; #19 waits on a blocker.
  expect(await frontier($)).toEqual([
    'FRONTIER',
    '5 HITL waiting',
    "Cut Polis's overhead",
    'HITL',
    'Derive task area and parent without asking Claude',
    'HITL',
    'Which prompted tool calls the core features need',
    'HITL',
    'Trim the turn-sizing model call',
    'HITL',
    'Defer the project tool or slim its schema',
    "refine Polis's UI/UX to be minimal, actionable and unambiguous",
    'HITL',
    'Which reading of context every surface shows',
  ])
})

test('a research ticket is marked AFK, a task unmarked, and claimed tickets follow with who has them', NO_PAGE, async ($, on) => {
  const clock = mock.clock(on)
  const gh = world(on)
  gh.answer = 'reopened'

  await $.session.start(START)
  await clock.settle()

  const shown = await frontier($)
  expect(shown.slice(shown.indexOf("refine Polis's UI/UX to be minimal, actionable and unambiguous"))).toEqual([
    "refine Polis's UI/UX to be minimal, actionable and unambiguous",
    'AFK',
    'What interactions can a Polis pane and band offer on each host',
    'The /city command grammar',
    'HITL',
    'Which reading of context every surface shows',
    'Inconsistency audit of every user-facing string',
    '@SashimmyUni',
    'One name per concept across UI, commands and docs',
    '@SashimmyUni @octocat',
  ])
  // The claimed grilling ticket no longer waits on the person.
  expect(shown[1]).toBe('5 HITL waiting')
})

const MAP_READS = (gh: Gh): number => gh.runs.filter(run => run.startsWith('gh issue list')).length

test('the tracker is read at the start and as a turn comes back, at most every five minutes', NO_PAGE, async ($, on) => {
  const clock = mock.clock(on)
  const gh = world(on)

  await $.session.start(START)
  await clock.settle()
  expect(MAP_READS(gh)).toBe(1)

  await $.turn.start({ text: 'Go on', turnId: 'turn-1' })
  await clock.advance(4 * 60_000)
  await $.turn.complete(turnEnd('turn-1'))
  await clock.settle()
  expect(MAP_READS(gh)).toBe(1)

  // Nothing reads it between turns, however long the wait.
  await clock.advance(2 * 60_000)
  expect(MAP_READS(gh)).toBe(1)

  await $.turn.start({ text: 'And again', turnId: 'turn-2' })
  await $.turn.complete(turnEnd('turn-2'))
  await clock.settle()
  expect(MAP_READS(gh)).toBe(2)
})

test('a session started within five minutes of another takes its read from the store', NO_PAGE, async ($, on) => {
  const clock = mock.clock(on)
  const kept: Record<string, unknown> = {}
  const gh = world(on, kept)
  await clock.set(1_000_000)
  kept[`tracker:${ROOT}`] = {
    at: 1_000_000 - 60_000,
    triedAt: 1_000_000 - 60_000,
    isFailed: false,
    maps: [{ number: 7, name: 'Kept map', open: [{ number: 8, title: 'Kept ticket', mark: 'HITL' }], claimed: [] }],
  }

  await $.session.start(START)
  await clock.settle()
  expect(gh.runs).toEqual([])
  expect(await frontier($)).toEqual(['FRONTIER', '1 HITL waiting', 'Kept map', 'HITL', 'Kept ticket'])
})

test('a failed read keeps the last one, marked with its age, until a read succeeds', NO_PAGE, async ($, on) => {
  const clock = mock.clock(on)
  const gh = world(on)

  await $.session.start(START)
  await clock.settle()
  gh.answer = 'fails'
  await clock.advance(6 * 60_000)
  await $.turn.start({ text: 'Go on', turnId: 'turn-1' })
  await $.turn.complete(turnEnd('turn-1'))
  await clock.settle()
  expect(MAP_READS(gh)).toBe(2)
  expect((await frontier($)).slice(0, 3)).toEqual(['FRONTIER', '5 HITL waiting · as of 6m', "Cut Polis's overhead"])

  gh.answer = 'recorded'
  await clock.advance(5 * 60_000)
  await $.turn.start({ text: 'Again', turnId: 'turn-2' })
  await $.turn.complete(turnEnd('turn-2'))
  await clock.settle()
  expect((await frontier($)).slice(0, 2)).toEqual(['FRONTIER', '5 HITL waiting'])
  expect(gh.toasts).toEqual([])
})

for (const answer of ['missing', 'fails', 'no maps'] as const) {
  test(`with gh ${answer === 'missing' ? 'not on the path' : answer === 'fails' ? 'failing (no remote, not signed in)' : 'finding no map'}, no block shows and nothing is said`, NO_PAGE, async ($, on) => {
    const clock = mock.clock(on)
    const gh = world(on)
    gh.answer = answer

    await $.session.start(START)
    await clock.settle()
    expect(MAP_READS(gh)).toBe(1)
    expect(await frontier($)).toEqual([])
    expect(gh.toasts).toEqual([])
    expect(gh.logs).toEqual([])
  })
}
