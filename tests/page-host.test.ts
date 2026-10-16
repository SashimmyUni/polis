// The page on disk as the host sees it: what the mod writes under the
// project root, when it writes again, and what `/city page` answers.
import { expect, mock, test } from 'claude-code/testing'
import type { MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const START = { cwd: '/work/atlas', surface: 'terminal', isInteractive: true } as const

const TODOS = [
  { content: 'One', status: 'completed', activeForm: 'One' },
  { content: 'Two', status: 'in_progress', activeForm: 'Doing two' },
] as const

const PAGE = '/work/atlas/.polis/city.html'
const FULL = '/work/atlas/.polis/city-full.html'
const IGNORE = '/work/atlas/.polis/.gitignore'

type Disk = {
  clock: MockClock
  // Every write the mod asked for, in order, and the files as they stand.
  writes: { path: string; text: string }[]
  files: Map<string, string>
  logs: string[]
  opened: string[]
}

// The engine hands a hook the path made absolute for its host: on Windows
// `/work/atlas` arrives with a drive and backslashes. The tests read one form.
const plain = (path: string): string => path.replace(/^[A-Za-z]:/, '').replace(/\\/g, '/')

// A session in /work/atlas, outside a repository, over a disk in memory.
const disk = (on: On, isWritable = true, kept?: Record<string, unknown>): Disk => {
  const writes: Disk['writes'] = []
  const files = new Map<string, string>()
  const logs: string[] = []
  const opened: string[] = []
  const clock = mock.clock(on)
  if (kept === undefined) mock.store(on)
  else {
    on('store.get', (_, e) => ({ value: kept[e.key] }))
    on('store.set', (_, e) => {
      kept[e.key] = e.value

      return { value: undefined }
    })
  }
  on('fs.exists', (_, e) => ({ value: files.has(plain(e.path)) }))
  // With nothing answering `fs.write` the call rejects, as a write refused does.
  if (isWritable) {
    on('fs.write', (_, e) => {
      writes.push({ path: plain(e.path), text: e.text })
      files.set(plain(e.path), e.text)

      return { value: undefined }
    })
  }
  on('ui.log', (_, e) => {
    logs.push(e.text)

    return { value: undefined }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('ui.open', (_, e) => {
    opened.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.panes', () => ({ value: [] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.repo', () => ({ value: null }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 20_000, percent: 10 }, rateLimits: [] },
  }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('agent.register', (_, e) => ({ value: { agent: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('tool.call', { tool: 'TodoWrite' }, () => ({ result: { oldTodos: [], newTodos: [] } }))

  return { clock, writes, files, logs, opened }
}

const pages = (world: Disk): string[] =>
  world.writes.filter(write => write.path === PAGE).map(write => write.text)

test('a session writes the city under the project root, and keeps the folder out of git', async ($, on) => {
  const world = disk(on)
  await $.session.start(START)

  expect(world.writes.map(write => write.path)).toEqual([IGNORE, PAGE, FULL])
  expect(world.files.get(IGNORE)).toBe('*\n')
  expect(world.files.get(PAGE)).toStartWith('<!doctype html>')
  expect(world.files.get(PAGE)).toContain('<meta http-equiv="refresh" content="3">')
  // The project's name heads the page.
  expect(world.files.get(PAGE)).toContain('<h1>atlas</h1>')
})

test('an idle board writes nothing more, and a changed one writes the new picture', async ($, on) => {
  const world = disk(on)
  await $.session.start(START)
  expect(pages(world)).toHaveLength(1)

  await world.clock.advance(10_000)
  expect(world.writes).toHaveLength(3)

  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 't1', todos: [...TODOS] })
  await world.clock.advance(2000)
  const drawn = pages(world)
  expect(drawn).toHaveLength(2)
  expect(drawn[1]).not.toBe(drawn[0])
  expect(drawn[1]).toContain('<meta http-equiv="refresh"')
  expect(world.files.get(PAGE)).toBe(drawn[1])

  // The same board again: nothing to write.
  await world.clock.advance(10_000)
  expect(pages(world)).toHaveLength(2)
  // The folder's .gitignore was written once.
  expect(world.writes.filter(write => write.path === IGNORE)).toHaveLength(1)
})

test('a .gitignore already in the folder is left as it is', async ($, on) => {
  const world = disk(on)
  world.files.set(IGNORE, 'city.html\n')
  await $.session.start(START)

  expect(world.writes.map(write => write.path)).toEqual([PAGE, FULL])
  expect(world.files.get(IGNORE)).toBe('city.html\n')
})

test('with the page off nothing is written, and /city page says so', { options: { page: false } }, async ($, on) => {
  const world = disk(on)
  await $.session.start(START)
  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 't1', todos: [...TODOS] })
  await world.clock.advance(10_000)
  const ran = await $.command.run({ command: 'city', args: 'page', ...TYPED })

  expect(world.writes).toEqual([])
  expect(ran.text).toContain('turned off')
  expect(ran.text).toContain('`page`')
})

test('/city page answers with the path and its file URL, and opens no pane', async ($, on) => {
  const world = disk(on)
  await $.session.start(START)
  // A page deleted since comes back when it is asked for.
  world.files.delete(PAGE)
  const ran = await $.command.run({ command: 'city', args: ' Page ', ...TYPED })

  expect(ran.text).toContain(PAGE)
  expect(ran.text).toContain('file:///work/atlas/.polis/city.html')
  // The steps to keep it open in VS Code's Integrated Browser.
  expect(ran.text).toContain('Command Palette')
  expect(ran.text).toContain('"Open Integrated Browser"')
  expect(ran.text).toContain('Paste the file URL')
  expect(world.files.get(PAGE)).toContain('<meta http-equiv="refresh"')
  expect(world.opened).toEqual([])
})

test('/city page names the full city’s page as well', async ($, on) => {
  const world = disk(on)
  await $.session.start(START)
  world.files.delete(FULL)
  const ran = await $.command.run({ command: 'city', args: 'page', ...TYPED })

  expect(ran.text).toContain(FULL)
  expect(ran.text).toContain('file:///work/atlas/.polis/city-full.html')
  expect(world.files.get(FULL)).toContain('<meta http-equiv="refresh"')
})

test('the two pages link to each other, and the full one carries the archive', async ($, on) => {
  const world = disk(on, true, {
    'archive:/work/atlas': {
      entries: [{ id: 'old/1', subject: 'Lay the roads', area: 'roads', doneAt: 1, sessionId: 'old' }],
      folded: { roads: 40 },
    },
  })
  await $.session.start(START)

  const current = world.files.get(PAGE) ?? ''
  const full = world.files.get(FULL) ?? ''
  expect(current).toContain('<a href="city-full.html">full city</a>')
  expect(full).toContain('<a href="city.html">current city</a>')
  expect(current).not.toContain('Lay the roads')
  expect(full).toContain('Lay the roads · archived')
  expect(full).toContain('old town · 40 done')
})

test('the full page is written again when the board changes, and not otherwise', async ($, on) => {
  const world = disk(on)
  await $.session.start(START)
  const fulls = (): string[] => world.writes.filter(write => write.path === FULL).map(write => write.text)
  expect(fulls()).toHaveLength(1)

  await world.clock.advance(10_000)
  expect(fulls()).toHaveLength(1)

  await $.tool.call({ tool: 'TodoWrite', tool_use_id: 't1', todos: [...TODOS] })
  await world.clock.advance(2000)
  expect(fulls()).toHaveLength(2)
})

test('a folder that cannot be written is reported once, not at every tick', async ($, on) => {
  const world = disk(on, false)
  await $.session.start(START)
  await world.clock.advance(10_000)

  expect(world.logs.filter(text => text.startsWith('polis: writing the page on disk: '))).toHaveLength(1)
})
