import type { AgentRun, Proc, Project, Skills, Task, Turn, Usage } from '../types'
import { avatar, esc, mix, n } from './icons'
import { clip, compact, districtsOf, gaugeOf, isBlocked, isLive, taskStats } from './logic'
import type { District } from './logic'
import { C } from './theme'

export type CityInput = {
  now: number
  tasks: Task[]
  agents: AgentRun[]
  procs: Proc[]
  turn: Turn
  usage: Usage
  project: Project | null
  skills: Skills
}

// The city is laid out on a square grid and drawn in a 2:1 isometric view:
// +gx runs down and to the right, +gy down and to the left.
const TW = 30
const TH = 15
const BLOCK = 4
const PITCH = 5
const FONT = `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"`

type Slot = readonly [number, number]

// Where districts are built, in order: City Hall keeps the back corner and
// the city grows as an avenue straight toward the viewer, so the drawing
// stays narrow enough for a side pane however many districts there are.
const SLOTS: readonly Slot[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [2, 1],
  [1, 2],
  [2, 2],
  [3, 2],
  [2, 3],
  [3, 3],
  [4, 3],
  [3, 4],
]

// A pane too narrow for the avenue gets the same city one block wide: the
// districts in a single file straight toward the viewer.
const COLUMN: readonly Slot[] = SLOTS.map((_, index): Slot => [index + 1, index + 1])

export type CityLayout = 'avenue' | 'column'

type Drawable = { depth: number; svg: string }

type Lot = { gx: number; gy: number; size: number; height: number }

const sx = (gx: number, gy: number): number => ((gx - gy) * TW) / 2
const sy = (gx: number, gy: number): number => ((gx + gy) * TH) / 2
const at = (gx: number, gy: number, z = 0): string => `${n(sx(gx, gy))},${n(sy(gx, gy) - z)}`

const tile = (gx: number, gy: number, w: number, d: number, z: number, rest: string): string =>
  `<polygon points="${at(gx, gy, z)} ${at(gx + w, gy, z)} ${at(gx + w, gy + d, z)} ${at(gx, gy + d, z)}" ${rest}/>`

const seg = (
  a: readonly [number, number, number],
  b: readonly [number, number, number],
  rest: string,
): string =>
  `<line x1="${n(sx(a[0], a[1]))}" y1="${n(sy(a[0], a[1]) - a[2])}" x2="${n(sx(b[0], b[1]))}" y2="${n(sy(b[0], b[1]) - b[2])}" ${rest}/>`

// A box standing on the grid: its two front faces and its top.
const prism = (gx: number, gy: number, w: number, d: number, h: number, color: string, base = 0): string =>
  `<polygon points="${at(gx, gy + d, base)} ${at(gx + w, gy + d, base)} ${at(gx + w, gy + d, base + h)} ${at(gx, gy + d, base + h)}" fill="${mix(color, C.bg, 0.22)}"/>` +
  `<polygon points="${at(gx + w, gy, base)} ${at(gx + w, gy + d, base)} ${at(gx + w, gy + d, base + h)} ${at(gx + w, gy, base + h)}" fill="${mix(color, C.bg, 0.48)}"/>` +
  tile(gx, gy, w, d, base + h, `fill="${mix(color, '#ffffff', 0.1)}"`)

// Rows of lit windows across both front faces.
const windows = (lot: Lot, color: string): string => {
  const { gx, gy, size } = lot
  let out = ''
  for (let z = 5; z < lot.height - 3; z += 6.5) {
    out +=
      seg([gx + size * 0.16, gy + size, z], [gx + size * 0.84, gy + size, z], `stroke="${color}" stroke-width="2" stroke-dasharray="2.2 2.2" opacity=".9"`) +
      seg([gx + size, gy + size * 0.84, z], [gx + size, gy + size * 0.16, z], `stroke="${color}" stroke-width="2" stroke-dasharray="2.2 2.2" opacity=".5"`)
  }

  return out
}

// Scaffolding up to the height the building will reach, with a crane on top.
const scaffold = (lot: Lot, from: number, color: string): string => {
  const { gx, gy, size, height } = lot
  const rest = `stroke="${color}" stroke-width=".6" opacity=".75"`
  let out =
    seg([gx, gy + size, 0], [gx, gy + size, height], rest) +
    seg([gx + size, gy + size, 0], [gx + size, gy + size, height], rest) +
    seg([gx + size, gy, 0], [gx + size, gy, height], rest)
  for (let z = Math.ceil(from / 6) * 6; z <= height; z += 6) {
    out +=
      seg([gx, gy + size, z], [gx + size, gy + size, z], rest) +
      seg([gx + size, gy + size, z], [gx + size, gy, z], rest)
  }
  const mx = sx(gx + size, gy)
  const my = sy(gx + size, gy) - height

  return (
    out +
    `<path d="M${n(mx)} ${n(my)}v-10h-13m3 0v5" fill="none" stroke="${color}" stroke-width=".9"/>` +
    `<circle cx="${n(mx)}" cy="${n(my - 10)}" r="1.7" fill="${color}"><animate attributeName="opacity" values="1;.15;1" dur="1.6s" repeatCount="indefinite"/></circle>`
  )
}

const hash = (text: string): number => {
  let value = 7
  for (const char of text) value = (value * 31 + char.charCodeAt(0)) % 9973

  return value
}

const STATUS_WORD = { pending: 'planned', in_progress: 'in progress', completed: 'done' } as const

// How high a task's building stands now: a lot, a half-built shell, or all of it.
const roofOf = (task: Task, lot: Lot): number =>
  task.status === 'pending' ? 0 : task.status === 'in_progress' ? Math.max(6, lot.height * 0.55) : lot.height

const building = (task: Task, lot: Lot, blocked: boolean, hasDetail: boolean): string => {
  const { gx, gy, size, height } = lot
  const owner = task.owner === undefined ? '' : ` · ${clip(task.owner, 24)}`
  const title = `<title>${esc(`${clip(task.subject, 80)} · ${blocked ? 'blocked' : STATUS_WORD[task.status]}${owner} · ${task.area}`)}</title>`
  if (task.status === 'pending') {
    const edge = blocked ? C.fail : C.muted
    const mid = [gx + size / 2, gy + size / 2] as const
    const barrier = blocked
      ? seg([gx + size * 0.15, gy + size * 0.55, 4], [gx + size * 0.85, gy + size * 0.55, 4], `stroke="${C.fail}" stroke-width="2.2" stroke-dasharray="2.4 1.6"`) +
        seg([gx + size * 0.2, gy + size * 0.55, 0], [gx + size * 0.2, gy + size * 0.55, 4], `stroke="${C.fail}" stroke-width=".8"`) +
        seg([gx + size * 0.8, gy + size * 0.55, 0], [gx + size * 0.8, gy + size * 0.55, 4], `stroke="${C.fail}" stroke-width=".8"`)
      : seg([mid[0], mid[1], 0], [mid[0], mid[1], 5], `stroke="${C.muted}" stroke-width=".8"`) +
        `<circle cx="${n(sx(mid[0], mid[1]))}" cy="${n(sy(mid[0], mid[1]) - 5.5)}" r="1.3" fill="${C.muted}"/>`

    return `<g>${title}${tile(gx, gy, size, size, 0, `fill="${C.ground}" stroke="${edge}" stroke-width=".8" stroke-dasharray="2 2"`)}${barrier}</g>`
  }
  if (task.status === 'in_progress') {
    const color = blocked ? C.fail : C.run

    return (
      `<g>${title}${prism(gx, gy, size, size, roofOf(task, lot), mix(color, C.tile, 0.45))}` +
      (hasDetail ? scaffold(lot, roofOf(task, lot), color) : '') +
      `</g>`
    )
  }

  return (
    `<g>${title}${prism(gx, gy, size, size, height, mix(C.done, C.tile, 0.42))}` +
    (hasDetail ? windows(lot, mix(C.run, '#ffffff', 0.25)) : '') +
    `</g>`
  )
}

type Label = { anchor: 'start' | 'middle' | 'end'; size: number; fill: string; hasPill: boolean }

const label = (x: number, y: number, text: string, how: Partial<Label> = {}): string => {
  const { anchor = 'middle', size = 8, fill = C.muted, hasPill = false } = how
  const width = text.length * size * 0.58 + 8
  const left = anchor === 'middle' ? x - width / 2 : anchor === 'end' ? x - width + 4 : x - 4
  const pill = hasPill
    ? `<rect x="${n(left)}" y="${n(y - size)}" width="${n(width)}" height="${n(size + 4.5)}" rx="3.5" fill="${C.bg}" opacity=".85"/>`
    : ''

  return `${pill}<text x="${n(x)}" y="${n(y)}" ${FONT} font-size="${size}" fill="${fill}" text-anchor="${anchor}">${esc(text)}</text>`
}

const meter = (x: number, y: number, share: number, color: string): string =>
  `<rect x="${n(x)}" y="${n(y)}" width="30" height="3" rx="1.5" fill="${C.faint}"/>` +
  `<rect x="${n(x)}" y="${n(y)}" width="${n(30 * Math.min(1, Math.max(0, share)))}" height="3" rx="1.5" fill="${color}"/>`

// ----------------------------------------------------------- civic buildings

type Place = { gx: number; gy: number; size: number }

const HALL: Place = { gx: 0.4, gy: 0.4, size: 1.7 }
const PLANT: Place = { gx: 2.6, gy: 0.5, size: 1.1 }
const LIBRARY: Place = { gx: 0.5, gy: 2.6, size: 1.1 }
const WORKS: Place = { gx: 2.6, gy: 2.6, size: 1.1 }
const HALL_COLOR = mix(C.agent, C.tile, 0.45)
const PLANT_COLOR = mix(C.run, C.tile, 0.55)
const LIBRARY_COLOR = mix(C.skill, C.tile, 0.55)
const WORKS_COLOR = mix(C.proc, C.tile, 0.6)

// Boxes that do not overlap are painted back to front by their centers.
const depthOf = (place: Place): number => place.gx + place.gy + place.size

const levelColor = (percent: number): string => (percent >= 80 ? C.fail : percent >= 60 ? C.run : C.done)

const cityHall = (m: CityInput): Drawable => {
  const { gx, gy, size } = HALL
  const pillar = `stroke="${mix(C.agent, '#ffffff', 0.35)}" stroke-width="1.3"`
  let columns = ''
  for (let k = 0; k < 5; k += 1) {
    const along = 0.14 + k * 0.18
    columns +=
      seg([gx + size * along, gy + size, 2], [gx + size * along, gy + size, 17], `${pillar} opacity=".75"`) +
      seg([gx + size, gy + size * along, 2], [gx + size, gy + size * along, 17], `${pillar} opacity=".4"`)
  }
  const cx = sx(gx + size / 2, gy + size / 2)
  const cy = sy(gx + size / 2, gy + size / 2) - 36
  const wave = m.turn.isWorking
    ? `<animate attributeName="opacity" values="1;.45;1" dur="1.8s" repeatCount="indefinite"/>`
    : ''

  return {
    depth: depthOf(HALL),
    svg:
      `<g><title>${esc(`City hall: the main session, ${m.turn.isWorking ? 'working' : 'idle'}`)}</title>` +
      prism(gx, gy, size, size, 20, HALL_COLOR) +
      columns +
      prism(gx + 0.4, gy + 0.4, 0.9, 0.9, 10, mix(C.agent, C.tile, 0.34), 20) +
      prism(gx + 0.65, gy + 0.65, 0.4, 0.4, 6, mix(C.agent, C.tile, 0.22), 30) +
      `<line x1="${n(cx)}" y1="${n(cy)}" x2="${n(cx)}" y2="${n(cy - 17)}" stroke="${C.muted}" stroke-width=".9"/>` +
      `<path d="M${n(cx)} ${n(cy - 17)}l10 3.2-10 3.2z" fill="${m.turn.isWorking ? C.run : C.muted}">${wave}</path>` +
      `</g>`,
  }
}

const powerPlant = (m: CityInput): Drawable => {
  const { gx, gy, size } = PLANT
  const share = Math.min(1, Math.max(0, m.usage.contextPercent / 100))
  const level = levelColor(m.usage.contextPercent)
  const cx = sx(gx + size * 0.62, gy + size * 0.62)
  const cy = sy(gx + size * 0.62, gy + size * 0.62) - 8
  const { expected } = m.turn
  const spent =
    expected === null
      ? 'no prompt yet'
      : `this prompt ${compact(m.turn.tokens)} tokens of ${compact(expected.tokens.low)}–${compact(expected.tokens.high)} expected`
  const stack: Place = { gx: gx + 0.08, gy: gy + 0.08, size: 0.24 }
  const tx = sx(stack.gx + stack.size / 2, stack.gy + stack.size / 2)
  const ty = sy(stack.gx + stack.size / 2, stack.gy + stack.size / 2) - 40
  const smoke = m.turn.isWorking
    ? [0, 0.9, 1.8]
        .map(
          delay =>
            `<circle cx="${n(tx)}" cy="${n(ty)}" r="2.2" fill="${C.muted}" opacity="0">` +
            `<animate attributeName="cy" values="${n(ty)};${n(ty - 16)}" dur="2.7s" begin="${delay}s" repeatCount="indefinite"/>` +
            `<animate attributeName="opacity" values=".55;0" dur="2.7s" begin="${delay}s" repeatCount="indefinite"/>` +
            `<animate attributeName="r" values="1.6;4" dur="2.7s" begin="${delay}s" repeatCount="indefinite"/></circle>`,
        )
        .join('')
    : ''

  return {
    depth: depthOf(PLANT),
    svg:
      `<g><title>${esc(`Power plant: context window ${m.usage.contextPercent}% full (${compact(m.usage.contextTokens)} of ${compact(m.usage.contextWindow)}); ${spent}`)}</title>` +
      prism(gx, gy, size, size, 8, PLANT_COLOR) +
      prism(stack.gx, stack.gy, stack.size, stack.size, 32, mix(C.muted, C.tile, 0.45), 8) +
      smoke +
      `<rect x="${n(cx - 7)}" y="${n(cy - 24)}" width="14" height="24" fill="${C.bg}" stroke="${C.faint}" stroke-width=".7"/>` +
      `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="7" ry="2.6" fill="${share > 0 ? level : C.bg}" stroke="${C.faint}" stroke-width=".7"/>` +
      `<rect x="${n(cx - 6.6)}" y="${n(cy - 24 * share)}" width="13.2" height="${n(24 * share)}" fill="${level}" opacity=".88"/>` +
      `<ellipse cx="${n(cx)}" cy="${n(cy - 24)}" rx="7" ry="2.6" fill="${mix(C.tile, '#ffffff', 0.08)}" stroke="${C.faint}" stroke-width=".7"/>` +
      `</g>`,
  }
}

const library = (m: CityInput): Drawable => {
  const { gx, gy, size } = LIBRARY
  const used = Object.keys(m.skills.used)
  const pillar = `stroke="${mix(C.skill, '#ffffff', 0.3)}" stroke-width="1.1" opacity=".7"`
  let detail = ''
  for (let k = 0; k < 4; k += 1) {
    const along = 0.16 + k * 0.225
    detail += seg([gx + size * along, gy + size, 2], [gx + size * along, gy + size, 12], pillar)
  }
  // One lit book on the side wall for each skill used.
  used.slice(0, 5).forEach((_, index) => {
    const along = 0.84 - index * 0.16
    detail += seg([gx + size, gy + size * along, 4], [gx + size, gy + size * along, 10], `stroke="${C.skill}" stroke-width="2"`)
  })
  const names = used.length === 0 ? 'none used yet' : `used ${used.slice(0, 6).join(', ')}`
  const suggested = m.skills.suggested.length === 0 ? '' : `; suggested ${m.skills.suggested.join(', ')}`

  return {
    depth: depthOf(LIBRARY),
    svg:
      `<g><title>${esc(`Library: skills, ${names}${suggested}`)}</title>` +
      prism(gx, gy, size, size, 14, LIBRARY_COLOR) +
      detail +
      prism(gx - 0.07, gy - 0.07, size + 0.14, size + 0.14, 2.6, mix(C.skill, C.tile, 0.36), 14) +
      `</g>`,
  }
}

const works = (running: readonly Proc[]): Drawable => {
  const { gx, gy, size } = WORKS
  const count = Math.max(1, Math.min(4, running.length))
  let stacks = ''
  for (let k = 0; k < count; k += 1) {
    const place: Place = { gx: gx + 0.1 + k * 0.25, gy: gy + 0.12, size: 0.16 }
    const tall = 9 + ((k * 5) % 9)
    stacks += prism(place.gx, place.gy, place.size, place.size, tall, mix(C.muted, C.tile, 0.4), 11)
    if (k < running.length) {
      const bx = sx(place.gx + 0.08, place.gy + 0.08)
      const by = sy(place.gx + 0.08, place.gy + 0.08) - 11 - tall - 2
      stacks +=
        `<circle cx="${n(bx)}" cy="${n(by)}" r="1.8" fill="${C.proc}">` +
        `<animate attributeName="opacity" values="1;.2;1" dur="${n(1.4 + k * 0.3)}s" repeatCount="indefinite"/></circle>`
    }
  }
  const names =
    running.length === 0
      ? 'nothing running in the background'
      : running.slice(0, 5).map(proc => `${proc.kind}: ${clip(proc.label, 40)}`).join('; ')

  return {
    depth: depthOf(WORKS),
    svg:
      `<g><title>${esc(`Works yard: ${names}`)}</title>` +
      prism(gx, gy, size, size, 11, running.length === 0 ? mix(WORKS_COLOR, C.tile, 0.5) : WORKS_COLOR) +
      windows({ gx, gy, size, height: 11 }, running.length === 0 ? C.faint : C.proc) +
      stacks +
      `</g>`,
  }
}

// ------------------------------------------------------------------ the city

const tree = (gx: number, gy: number, r: number): Drawable => {
  const x = sx(gx, gy)
  const y = sy(gx, gy)

  return {
    depth: gx + gy,
    svg:
      `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x)}" y2="${n(y - 6)}" stroke="${C.faint}" stroke-width="1"/>` +
      `<circle cx="${n(x)}" cy="${n(y - 8)}" r="${r}" fill="${mix(C.done, C.bg, 0.55)}"/>`,
  }
}

// A district's lots: as few and as large as its tasks allow, with a tree or
// two where a lot is left over.
const lotsOf = (
  district: District,
  slot: Slot,
  all: readonly Task[],
): { lots: Map<string, Lot>; trees: Drawable[] } => {
  const bx = slot[0] * PITCH
  const by = slot[1] * PITCH
  const shown = district.tasks.slice(0, 16)
  const side = shown.length <= 1 ? 1 : shown.length <= 4 ? 2 : shown.length <= 9 ? 3 : 4
  const cell = (BLOCK - 0.6) / side
  // Lots fill from the front corner back, which keeps the back corner, under
  // the name of the block behind, free for longest.
  const corner = (index: number, size: number): readonly [number, number] => {
    const from = side * side - 1 - index

    return [
      bx + 0.3 + (from % side) * cell + (cell - size) / 2,
      by + 0.3 + Math.floor(from / side) * cell + (cell - size) / 2,
    ]
  }
  const lots = new Map<string, Lot>()
  shown.forEach((task, index) => {
    const isSub = task.parentId !== undefined
    const size = Math.min(1.25, cell * 0.64) * (isSub ? 0.72 : 1)
    const subs = all.filter(one => one.parentId === task.id).length
    const tall = (15 + (hash(task.id) % 11) + Math.min(28, subs * 7)) * Math.min(1.5, Math.max(1, size / 0.8))
    const [gx, gy] = corner(index, size)
    lots.set(task.id, { gx, gy, size, height: isSub ? tall * 0.7 : tall })
  })
  const trees: Drawable[] = []
  for (let index = side * side - 1; index >= shown.length && trees.length < 2; index -= 1) {
    const [gx, gy] = corner(index, 0)
    trees.push(tree(gx, gy, 3 + (index % 2)))
  }

  return { lots, trees }
}

const draw = (m: CityInput, hasDetail: boolean, layout: CityLayout): string => {
  const isColumn = layout === 'column'
  // The column is drawn for a narrow slot: its words are set larger against
  // its buildings, so they stay readable once the surface scales it down.
  const type = isColumn ? 1.2 : 1
  const slots = isColumn ? COLUMN : SLOTS
  const districts = districtsOf(m.tasks).slice(0, slots.length)
  const used: Slot[] = [[0, 0], ...districts.map((_, index) => slots[index] ?? ([0, 0] as const))]
  const isUsed = (i: number, j: number): boolean => used.some(slot => slot[0] === i && slot[1] === j)

  let ground = ''
  const things: Drawable[] = []
  const people: Drawable[] = []
  const labels: string[] = []
  const overlays: string[] = []

  // Each block sits on a pad of road; neighbours' pads join into streets.
  for (const [i, j] of used) {
    ground += tile(i * PITCH - 0.5, j * PITCH - 0.5, BLOCK + 1, BLOCK + 1, 0, `fill="${C.road}" stroke="${C.road}" stroke-width="4" stroke-linejoin="round"`)
  }
  const mark = `stroke="${C.roadMark}" stroke-width=".8" stroke-dasharray="3 4"`
  for (const [i, j] of used) {
    const bx = i * PITCH
    const by = j * PITCH
    if (isUsed(i + 1, j)) ground += seg([bx + BLOCK + 0.5, by + 0.2, 0], [bx + BLOCK + 0.5, by + BLOCK - 0.2, 0], mark)
    if (isUsed(i, j + 1)) ground += seg([bx + 0.2, by + BLOCK + 0.5, 0], [bx + BLOCK - 0.2, by + BLOCK + 0.5, 0], mark)
    ground += tile(bx, by, BLOCK, BLOCK, 0, `fill="${C.tile}" stroke="${C.tileEdge}" stroke-width=".6"`)
  }

  // The civic block: hall, plant, library and works around a small square.
  const running = m.procs.filter(proc => proc.status === 'running')
  things.push(cityHall(m), powerPlant(m), library(m), works(running))

  // Districts: a block per work area, a building per task.
  const where = new Map<string, Lot>()
  const roofs = new Map<string, number>()
  districts.forEach((district, index) => {
    const slot = slots[index] ?? ([0, 0] as const)
    const bx = slot[0] * PITCH
    const by = slot[1] * PITCH
    const { lots, trees } = lotsOf(district, slot, m.tasks)
    things.push(...trees)
    for (const task of district.tasks) {
      const lot = lots.get(task.id)
      if (lot === undefined) continue
      where.set(task.id, lot)
      roofs.set(task.id, roofOf(task, lot))
      things.push({
        depth: depthOf(lot),
        svg: building(task, lot, isBlocked(task, m.tasks), hasDetail),
      })
    }
    const stats = taskStats(district.tasks)
    const x = sx(bx + BLOCK, by + BLOCK)
    const y = sy(bx + BLOCK, by + BLOCK) + 12
    const hidden = district.tasks.length - lots.size
    labels.push(
      label(x, y, `${clip(district.area, 10).toUpperCase()}  ${stats.done}/${stats.total}${hidden > 0 ? ` +${hidden}` : ''}`, { size: 8.5 * type, fill: C.text, hasPill: true }) +
        `<rect x="${n(x - 18)}" y="${n(y + 4.5)}" width="36" height="2.4" rx="1.2" fill="${C.faint}"/>` +
        `<rect x="${n(x - 18)}" y="${n(y + 4.5)}" width="${n(stats.total === 0 ? 0 : (36 * stats.done) / stats.total)}" height="2.4" rx="1.2" fill="${C.done}"/>`,
    )
  })

  // What waits on what: a dashed arc from the blocker to the blocked.
  let arcs = 0
  for (const task of m.tasks) {
    const to = where.get(task.id)
    if (to === undefined || task.status === 'completed') continue
    for (const id of task.blockedBy) {
      const from = where.get(id)
      const blocker = m.tasks.find(one => one.id === id)
      if (from === undefined || blocker === undefined || blocker.status === 'completed' || arcs >= 12) continue
      arcs += 1
      const x1 = sx(from.gx + from.size / 2, from.gy + from.size / 2)
      const y1 = sy(from.gx + from.size / 2, from.gy + from.size / 2) - (roofs.get(id) ?? 0)
      const x2 = sx(to.gx + to.size / 2, to.gy + to.size / 2)
      const y2 = sy(to.gx + to.size / 2, to.gy + to.size / 2) - (roofs.get(task.id) ?? 0)
      overlays.push(
        `<path d="M${n(x1)} ${n(y1)}Q${n((x1 + x2) / 2)} ${n(Math.min(y1, y2) - 24)} ${n(x2)} ${n(y2)}" fill="none" stroke="${C.fail}" stroke-width=".9" stroke-dasharray="2.5 2.5" opacity=".75"/>` +
          `<circle cx="${n(x2)}" cy="${n(y2)}" r="1.7" fill="${C.fail}"/>`,
      )
    }
  }

  // People are drawn over the buildings so nobody is hidden: the main
  // session in the square before City Hall, each agent on the roof of the
  // task it works on, the rest lined up beside the main session.
  const square = [BLOCK - 0.05, BLOCK - 0.05] as const
  const mayorX = sx(square[0], square[1])
  const mayorY = sy(square[0], square[1])
  people.push({
    depth: square[0] + square[1],
    svg: avatar(mayorX, mayorY, 'main', m.usage.mainFamilies, {
      isLive: m.turn.isWorking,
      title: `Main session · ${m.turn.isWorking ? 'working' : 'idle'} · ${m.turn.tools} tool calls this prompt`,
    }),
  })
  const live = m.agents.filter(isLive).slice(-24)
  const standing = new Map<string, readonly [number, number]>()
  const crowd = new Map<string, number>()
  let loose = 0
  for (const run of live) {
    const lot = run.taskId === undefined ? undefined : where.get(run.taskId)
    let x: number
    let y: number
    let depth: number
    if (lot === undefined || run.taskId === undefined) {
      if (loose >= 6) continue
      const step = (Math.floor(loose / 2) + 1) * 1.25
      const gx = square[0] - (loose % 2 === 0 ? step : 0)
      const gy = square[1] - (loose % 2 === 0 ? 0 : step)
      loose += 1
      x = sx(gx, gy)
      y = sy(gx, gy)
      depth = gx + gy
    } else {
      const beside = crowd.get(run.taskId) ?? 0
      crowd.set(run.taskId, beside + 1)
      x = sx(lot.gx + lot.size / 2, lot.gy + lot.size / 2) + (beside % 2 === 0 ? 1 : -1) * Math.ceil(beside / 2) * 11
      y = sy(lot.gx + lot.size / 2, lot.gy + lot.size / 2) - (roofs.get(run.taskId) ?? 0)
      depth = depthOf(lot)
    }
    if (run.agentId !== undefined) standing.set(run.agentId, [x, y])
    const parent = run.parentAgentId === undefined ? undefined : standing.get(run.parentAgentId)
    const [px, py] = parent ?? [mayorX, mayorY]
    overlays.push(
      `<line x1="${n(px)}" y1="${n(py - 8)}" x2="${n(x)}" y2="${n(y - 8)}" stroke="${C.agent}" stroke-width=".7" stroke-dasharray="1.5 3" opacity=".5"/>`,
    )
    people.push({
      depth,
      svg: avatar(x, y, run.type, run.families, {
        isLive: true,
        title: `${run.name === undefined ? '' : `${clip(run.name, 24)}: `}${clip(run.label, 60)} · ${run.type} · ${run.tools} tool calls · ${compact(run.tokens)} tokens`,
      }),
    })
  }

  // The view is as wide as its layout ever gets and as tall as what is built.
  // The column keeps its key above City Hall, where the avenue has it beside.
  const minX = isColumn ? -73 : -158
  const maxX = -minX
  const minY = isColumn ? -146 : -94
  const maxY =
    Math.max(...used.map(slot => sy(slot[0] * PITCH + BLOCK, slot[1] * PITCH + BLOCK))) +
    (isColumn ? 60 : 48)
  const boxW = maxX - minX
  const boxH = maxY - minY
  // Drawn larger than any pane that picks the layout: a surface scales a
  // drawing down to its slot, never up.
  const scale = isColumn ? 3 : Math.min(840 / boxW, 660 / boxH, 2.6)

  // The key: each civic building by its color, with the figure it stands for.
  const keyX = minX + (isColumn ? 7 : 12)
  const keyY = minY + 16
  const { expected } = m.turn
  const spent = expected === null ? undefined : gaugeOf(m.turn.tokens, expected.tokens)
  const spentColor = spent === undefined ? C.muted : spent.state === 'over' ? C.fail : spent.state === 'within' ? C.run : C.done
  const skillCount = Object.keys(m.skills.used).length
  const rows: readonly (readonly [string, string, string, number | undefined])[] = [
    [HALL_COLOR, `main session ${m.turn.isWorking ? 'working' : 'idle'}`, C.muted, undefined],
    [PLANT_COLOR, `context ${m.usage.contextPercent}%`, levelColor(m.usage.contextPercent), m.usage.contextPercent / 100],
    [
      spentColor,
      expected === null ? 'prompt: none yet' : `prompt ${compact(m.turn.tokens)}/${compact(expected.tokens.high)}`,
      spentColor,
      spent?.share,
    ],
    [WORKS_COLOR, `background ${running.length} running`, C.muted, undefined],
    [LIBRARY_COLOR, `skills ${skillCount} used`, C.muted, undefined],
  ]
  const key = rows
    .map(([swatch, text, color, share], index) => {
      const y = keyY + index * 10.5 * type

      return (
        `<rect x="${n(keyX)}" y="${n(y - 5.6)}" width="6" height="6" rx="1.5" fill="${swatch}"/>` +
        label(keyX + 10, y, text, { anchor: 'start', size: 7.5 * type, fill: C.muted }) +
        (share === undefined ? '' : meter(keyX + (isColumn ? 100 : 88), y - 4.4, share, color))
      )
    })
    .join('')

  const legend = [
    [mix(C.done, C.tile, 0.42), 'done'],
    [mix(C.run, C.tile, 0.45), 'in progress'],
    [C.faint, 'planned'],
    [C.fail, 'blocked'],
  ]
    .map(
      ([color = C.muted, name = ''], index) => {
        // Four across where there is room, two rows of two in the column.
        const x = keyX + (isColumn ? (index % 2) * 66 : index * 50)
        const y = maxY - (isColumn ? 27 - Math.floor(index / 2) * 11 : 16)

        return (
          `<rect x="${n(x)}" y="${n(y)}" width="6" height="6" rx="1.5" fill="${color}"/>` +
          label(x + 9, y + 5.5, name, { anchor: 'start', size: 7 * type })
        )
      },
    )
    .join('')

  if (districts.length === 0) {
    labels.push(
      label(0, sy(BLOCK, BLOCK) + 28, isColumn ? 'districts appear with tasks' : 'districts appear with the first tasks', { size: 8 * type }),
    )
  }

  things.sort((a, b) => a.depth - b.depth)
  people.sort((a, b) => a.depth - b.depth)

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(minX)} ${n(minY)} ${n(boxW)} ${n(boxH)}" width="${Math.round(boxW * scale)}" height="${Math.round(boxH * scale)}">` +
    `<rect x="${n(minX)}" y="${n(minY)}" width="${n(boxW)}" height="${n(boxH)}" rx="10" fill="${C.bg}"/>` +
    ground +
    things.map(thing => thing.svg).join('') +
    overlays.join('') +
    people.map(person => person.svg).join('') +
    labels.join('') +
    key +
    legend +
    `</svg>`
  )
}

const LIMIT = 131072

// Tooltips are the one part of the drawing whose length the tasks decide.
const untitled = (svg: string): string => svg.replace(/<title>[^<]*<\/title>/g, '')

// A city too large for the surface's limit is drawn again without the detail
// on its buildings, and without its tooltips if that is still too large.
export const renderCity = (m: CityInput, layout: CityLayout = 'avenue'): string => {
  const full = draw(m, true, layout)
  if (full.length <= 120_000) return full
  const plain = draw(m, false, layout)

  return plain.length < LIMIT ? plain : untitled(plain)
}

export const cityAlt = (m: CityInput): string => {
  const stats = taskStats(m.tasks)
  const districts = districtsOf(m.tasks)
  const live = m.agents.filter(isLive).length
  const name = m.project?.name ?? 'the project'

  return (
    `City map of ${name}: ${districts.length} district${districts.length === 1 ? '' : 's'}, ` +
    `${stats.done} of ${stats.total} task${stats.total === 1 ? '' : 's'} done, ` +
    `${live} agent${live === 1 ? '' : 's'} working, context window ${m.usage.contextPercent}% full.`
  )
}
