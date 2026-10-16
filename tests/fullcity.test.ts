// The full city in the pane: the toggle on City between the current city and
// the full one, the pane opening on the current city, the archive's work
// drawn once beside the board's, and the terminal's text city in full.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, FoundElement } from 'claude-code/testing'
import type { On } from 'claude-code'

import { C } from '../hooks/theme'
import type { Archive, ArchiveEntry } from '../types'

const ROOT = '/work/atlas'
const DAY = 24 * 3_600_000

const START = { cwd: ROOT, surface: null, isInteractive: false } as const
const TYPED = { origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } } as const

const PANE = {
  plugin: 'polis',
  component: 'Pane',
  requestId: 'polis',
  props: {
    title: 'Polis',
    isFocused: false,
    bodyColumns: 100,
    placement: 'dock',
    scroll: { offset: 0, bodyRows: 40 },
    view: {},
  },
} as const

type Surface = 'terminal' | 'desktop'

// The engine beneath the mod for a session in /work/atlas, over a store in memory.
const world = (on: On, kept: Record<string, unknown> = {}): { kept: Record<string, unknown> } => {
  on('store.get', (_, e) => ({ value: kept[e.key] }))
  on('store.set', (_, e) => {
    kept[e.key] = e.value

    return { value: undefined }
  })
  on('session.surfaces', () => ({ value: ['terminal', 'desktop'] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.repo', () => ({ value: null }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'session-2' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 20_000, percent: 10 }, rateLimits: [] },
  }))
  on('fs.exists', () => ({ value: true }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', () => ({ value: undefined }))
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('agent.register', (_, e) => ({ value: { agent: e.name } }))

  return { kept }
}

const entries = (area: string, count: number): ArchiveEntry[] =>
  Array.from({ length: count }, (_, k) => ({
    id: `session-/${area}${k}`,
    subject: `${area} archived ${k}`,
    area,
    doneAt: 1_000 + k,
    sessionId: 'session-1',
  }))

const archiveOf = (list: ArchiveEntry[], folded: { [area: string]: number } = {}): Archive => ({ entries: list, folded })

// The pane on City: the drawing (the Svg's source, or the text city's texts)
// and the toggle's label, after pressing the toggle `presses` times.
const city = async ($: Engine, surface: Surface, presses = 0): Promise<{ drawn: string; toggle: string; texts: FoundElement[] }> => {
  const ui = await $.ui.mount({ ...PANE, surface })
  await ui.press({ key: 'view-city' })
  for (let k = 0; k < presses; k += 1) await ui.press({ key: 'city-view' })
  const svg = await ui.find({ type: 'Svg' })
  const texts = await ui.findAll({ type: 'Text' })
  const toggle = await ui.find({ type: 'Button', key: 'city-view' })
  await ui.unmount()

  return {
    drawn: svg === undefined ? texts.map(one => one.text).join('\n') : String(svg.props.source),
    toggle: String(toggle?.props.label ?? ''),
    texts,
  }
}

test('City opens on the current city, and the toggle switches to the full city and back', async ($, on) => {
  mock.clock(on)
  world(on, { [`archive:${ROOT}`]: archiveOf(entries('docs', 3)) })
  await $.session.start(START)

  const current = await city($, 'desktop')
  expect(current.toggle).toBe('Full city')
  expect(current.drawn).not.toContain('· archived')

  const full = await city($, 'desktop', 1)
  expect(full.toggle).toBe('Current city')
  expect(full.drawn).toContain('docs archived 2 · archived')
  // The full view stays up while the pane does.
  expect((await city($, 'desktop')).drawn).toContain('docs archived 2 · archived')

  expect((await city($, 'desktop', 1)).drawn).not.toContain('· archived')
})

test('the pane opened again starts on the current city', async ($, on) => {
  mock.clock(on)
  world(on, { [`archive:${ROOT}`]: archiveOf(entries('docs', 3)) })
  await $.session.start(START)
  expect((await city($, 'desktop', 1)).drawn).toContain('· archived')

  await $.command.run({ command: 'city', args: 'city', ...TYPED })
  const reopened = await city($, 'desktop')
  expect(reopened.toggle).toBe('Full city')
  expect(reopened.drawn).not.toContain('· archived')
})

test('a task on the board and in the archive is drawn once in the full city', async ($, on) => {
  const clock = mock.clock(on)
  await clock.advance(10 * DAY)
  const doneAt = clock.now() - DAY
  const earlier = {
    sessionId: 'session-1',
    at: doneAt,
    tasks: [{ id: '1', subject: 'Draw the map', status: 'completed', area: 'ui', blockedBy: [], source: 'task', doneAt }],
  }
  world(on, { [`tasks:${ROOT}`]: earlier })
  await $.session.start(START)

  const full = await city($, 'desktop', 1)
  expect(full.drawn.match(/Draw the map/g)).toHaveLength(1)
})

test('the terminal’s full city ends each district’s row with dim blocks and a count of the rest', async ($, on) => {
  mock.clock(on)
  world(on, { [`archive:${ROOT}`]: archiveOf(entries('docs', 30), { docs: 282 }) })
  await $.session.start(START)

  const current = await city($, 'terminal')
  expect(current.drawn).not.toContain('docs')

  const full = await city($, 'terminal', 1)
  const dim = full.texts.filter(one => one.text === '█' && one.props.color === C.faint)
  expect(dim).toHaveLength(24)
  expect(full.texts.some(one => one.text === '+288')).toBe(true)
  expect(full.toggle).toBe('Current city')
})
