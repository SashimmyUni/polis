import { expect, test } from 'claude-code/testing'

import { fitCity, renderCity } from '../hooks/city'
import type { CityInput, CityLayout } from '../hooks/city'
import { avatarSvg } from '../hooks/icons'
import { agent, base, busy, full, proc, scenes, small, states, task } from '../tools/scenes'
import type { Archive, ArchiveEntry, Check, Task, Wait } from '../types'

const LAYOUTS: readonly CityLayout[] = ['avenue', 'column', 'wide']

const city = (tasks: Task[], rest: Partial<CityInput> = {}): CityInput => ({ ...base, tasks, ...rest })

const finished = (rest: Partial<Task> = {}): Task[] => [task('a', 'Write the parser', 'api', 'completed', rest)]

const check = (kind: Check['kind'], hasPassed: boolean, editsSince = 0): Check => ({
  kind,
  hasPassed,
  at: 0,
  ms: 1000,
  command: kind,
  editsSince,
})

const permission: Wait = { kind: 'permission', at: 0, tool: 'Bash' }
const turn: Wait = { kind: 'turn', at: 0 }

test('a finished building reads differently verified, unchecked and refuted', () => {
  const verified = renderCity(city(finished({ verdict: { state: 'passed', by: 'verifier', at: 0 } })))
  const unchecked = renderCity(city(finished()))
  const refuted = renderCity(city(finished({ verdict: { state: 'failed', by: 'checks', at: 0 } })))
  expect(new Set([verified, unchecked, refuted]).size).toBe(3)
  // Tooltips end with the note on the verdict.
  expect(verified).toContain('verified by a verifier</title>')
  expect(unchecked).toContain('not checked yet</title>')
  expect(refuted).toContain('failed its tests</title>')
  // The pennant is sage and the cross rose; neither is on the other buildings.
  expect(verified).toContain('l6 2.2l-6 2.2z')
  expect(unchecked).not.toContain('l6 2.2l-6 2.2z')
  expect(refuted).not.toContain('l6 2.2l-6 2.2z')
  expect(refuted).toContain('stroke-width="1.7" stroke-linecap="round"')
  expect(verified).not.toContain('stroke-width="1.7" stroke-linecap="round"')
  expect(verified).toContain('>verified</text>')
})

test('open work carries no verdict note', () => {
  const svg = renderCity(city([task('a', 'Write the parser', 'api', 'in_progress')]))
  expect(svg).not.toContain('not checked yet')
})

test('a blocking wait raises the bubble and the rose callout, and no wait does not', () => {
  const waiting = renderCity({ ...base, waits: [permission] })
  expect(waiting).toContain('needs you: permission for Bash</title>')
  expect(waiting).toContain('>!</text>')
  expect(waiting).toContain('>session needs you</text>')
  expect(waiting).toContain('permission for Bash</title>')
  const calm = renderCity(base)
  expect(calm).not.toContain('>!</text>')
  expect(calm).not.toContain('needs you')
  const column = renderCity({ ...base, waits: [permission] }, 'column')
  expect(column).toContain('>main session needs you</text>')
})

test('the main session figure tooltip ends with what it waits for', () => {
  const svg = renderCity({ ...base, usage: { ...base.usage, mainFamilies: { read: 3 } }, waits: [permission] })
  expect(svg).toContain('holding a book (read) · permission for Bash</title>')
})

test('a turn wait says your turn and raises no bubble', () => {
  const svg = renderCity({ ...base, waits: [turn] })
  expect(svg).toContain('>your turn</text>')
  expect(svg).not.toContain('>!</text>')
  expect(svg).not.toContain('needs you')
})

test('a lamp for each check that has run, none when nothing has', () => {
  const lamps = (checks: Check[]): number => (renderCity({ ...base, checks }).match(/<title>(?:tests|lint|types|build) /g) ?? []).length
  expect(lamps([])).toBe(0)
  expect(lamps([check('test', true)])).toBe(1)
  expect(lamps([check('build', true), check('test', false), check('lint', true), check('types', true)])).toBe(4)
  expect(renderCity(base)).not.toContain('<title>tests ')
})

test('lamps are told by their tooltips, in the order of the kinds', () => {
  const svg = renderCity({
    ...base,
    checks: [check('types', true, 3), check('lint', false), check('test', true)],
  })
  const at = (text: string): number => svg.indexOf(`<title>${text}</title>`)
  expect(at('tests passed')).toBeGreaterThan(-1)
  expect(at('lint failed')).toBeGreaterThan(at('tests passed'))
  expect(at('types stale: 3 edits since it passed')).toBeGreaterThan(at('lint failed'))
  expect(renderCity({ ...base, checks: [check('types', true, 1)] })).toContain('types stale: 1 edit since it passed')
})

const MOTION = /<animate/

test('a still drawing has no animation in any layout, with or without a shape', () => {
  const scenesAll: CityInput[] = [...scenes.map(([, scene]) => scene), states, small, busy, full]
  for (const scene of scenesAll) {
    const input: CityInput = { ...scene, waits: [permission], checks: [check('test', true)], isStill: true }
    for (const layout of LAYOUTS) {
      expect(MOTION.test(renderCity(input, layout))).toBe(false)
      expect(MOTION.test(renderCity(input, layout, 1.6))).toBe(false)
      expect(MOTION.test(renderCity(input, layout, 0.5))).toBe(false)
    }
  }
})

test('a still drawing keeps every shed step free of animation', () => {
  const heavy: CityInput = {
    ...busy,
    isStill: true,
    tasks: Array.from({ length: 120 }, (_, k) => task(`t${k}`, `Task ${k}`, `area${k % 11}`, 'completed')),
  }
  for (const layout of LAYOUTS) {
    const { svg } = fitCity(heavy, layout)
    expect(MOTION.test(svg)).toBe(false)
  }
})

test('the same drawing with motion on does animate', () => {
  expect(MOTION.test(renderCity({ ...busy, waits: [permission] }))).toBe(true)
  expect(MOTION.test(renderCity({ ...busy, isStill: false }))).toBe(true)
})

test('what only showed through its motion stays visible when still', () => {
  const svg = renderCity({ ...busy, tasks: busy.tasks.map(one => ({ ...one, status: 'completed' as const })), isStill: true })
  // Smoke, fireworks, petals and the boat are left fixed, not at opacity 0.
  expect(svg).not.toContain('opacity="0"')
  expect(svg).toContain('pathLength="48"')
})

test('an agent card is still when asked', () => {
  const families = { edit: 5, read: 2 }
  expect(MOTION.test(avatarSvg('polis:worker', families, true))).toBe(true)
  expect(MOTION.test(avatarSvg('polis:worker', families, true, true))).toBe(false)
  expect(MOTION.test(avatarSvg('main', { plan: 3 }, true, true))).toBe(false)
})

test('agents and background work stand in a still city too', () => {
  const input: CityInput = { ...busy, procs: [proc('p', 'shell', 'npm run dev')], agents: [agent('a', 'Explore', 'Look', { search: 3 })], isStill: true }
  expect(renderCity(input)).toContain('Explore')
})

// ------------------------------------------------------------- the full city

const archived = (area: string, count: number, from = 0, rest: Partial<ArchiveEntry> = {}): ArchiveEntry[] =>
  Array.from({ length: count }, (_, k) => ({
    id: `old0000${area}/${from + k}`,
    subject: `${area} archived ${from + k}`,
    area,
    doneAt: 1_000 + from + k,
    sessionId: 'old00000',
    ...rest,
  }))

const archiveOf = (entries: ArchiveEntry[], folded: { [area: string]: number } = {}): Archive => ({ entries, folded })

test('archived work stands as quieter buildings with no pennant or verdict mark', () => {
  const svg = renderCity(city([], { archive: archiveOf(archived('api', 1, 0, { verdict: 'passed' })) }))
  expect(svg).toContain('api archived 0 · archived')
  expect(svg).not.toContain('l6 2.2l-6 2.2z')
  expect(svg).not.toContain('stroke-width="1.7" stroke-linecap="round"')
})

test('a district shows its newest 24 archived tasks, and the rest and the folded counts as an old town', () => {
  const svg = renderCity(city([], { archive: archiveOf(archived('api', 30), { api: 282 }) }))
  // Newest first: the six oldest are in the old town, not drawn singly.
  expect(svg).toContain('api archived 29 · archived')
  expect(svg).toContain('api archived 6 · archived')
  expect(svg).not.toContain('api archived 5 · archived')
  expect(svg).toContain('>old town · 288 done</text>')
})

test('an old town grows with its count', () => {
  const small = renderCity(city([], { archive: archiveOf([], { api: 3 }) }))
  const large = renderCity(city([], { archive: archiveOf([], { api: 3000 }) }))
  expect(small).toContain('>old town · 3 done</text>')
  expect(large).toContain('>old town · 3,000 done</text>')
  expect(small).not.toBe(large)
})

test('a district only the archive knows is laid out like any other', () => {
  const svg = renderCity(city(finished(), { archive: archiveOf(archived('docs', 2)) }))
  expect(svg).toContain('>DOCS  0/0</text>')
  expect(svg).toContain('>API  1/1</text>')
})

test('the current city draws no archive, and the moon and fireworks count only the board', () => {
  const board = finished()
  const current = renderCity(city(board))
  const whole = renderCity(city(board, { archive: archiveOf(archived('api', 5)) }))
  expect(current).not.toContain('· archived')
  expect(whole).toContain('Moon: the project is 100% done')
  // Every task on the board done: fireworks in both views.
  expect(whole.match(/pathLength="48"/g)?.length).toBe(current.match(/pathLength="48"/g)?.length)
})

test('a full city with a large archive fits the Svg limit in every layout', () => {
  const areas = ['api', 'web', 'docs', 'cli', 'core', 'infra', 'auth', 'db', 'ui', 'ops', 'qa']
  const entries = areas.flatMap(area => archived(area, 200))
  const folded = Object.fromEntries(areas.map(area => [area, 5000]))
  for (const layout of LAYOUTS) {
    const svg = renderCity({ ...full, archive: archiveOf(entries, folded) }, layout, 1.6)
    expect(svg.length).toBeLessThan(131072)
    expect(svg).toContain('old town')
  }
})
