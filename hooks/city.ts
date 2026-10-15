import type { AgentRun, Archive, ArchiveEntry, Check, Proc, Project, Skills, Task, Turn, Usage, Wait } from '../types'
import { CHECK_KINDS, CHECK_LABEL, stateOf } from './checks'
import { avatar, esc, mix, n } from './icons'
import {
  clip,
  compact,
  districtsOf,
  gaugeOf,
  isBlocked,
  isBlocking,
  isLive,
  progressOf,
  sessionState,
  taskStats,
  topWait,
  waitText,
} from './logic'
import type { District } from './logic'
import { C } from './theme'
import { standingOf, verdictNote } from './verify'

export type CityInput = {
  now: number
  tasks: Task[]
  agents: AgentRun[]
  procs: Proc[]
  turn: Turn
  usage: Usage
  project: Project | null
  skills: Skills
  /** The last run of each kind of check: a lamp on the civic block for each. */
  checks?: Check[]
  /** What the person is wanted for: a blocking wait raises a bubble over the main session. */
  waits?: Wait[]
  /** Drawn without any motion, with what only moved into view left out or fixed. */
  isStill?: boolean
  /** The full city: the archive's finished work not on the board, drawn beside it. */
  archive?: Archive
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

// A pane wider than it is tall gets the districts fanned out to both sides
// in front of City Hall instead.
const WIDE: readonly Slot[] = [
  [1, 0],
  [0, 1],
  [1, 1],
  [2, 0],
  [0, 2],
  [2, 1],
  [1, 2],
  [3, 0],
  [0, 3],
  [2, 2],
  [3, 1],
]

export type CityLayout = 'avenue' | 'column' | 'wide'

const slotsOf = (layout: CityLayout): readonly Slot[] =>
  layout === 'column' ? COLUMN : layout === 'wide' ? WIDE : SLOTS

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
  inner = '',
): string =>
  `<line x1="${n(sx(a[0], a[1]))}" y1="${n(sy(a[0], a[1]) - a[2])}" x2="${n(sx(b[0], b[1]))}" y2="${n(sy(b[0], b[1]) - b[2])}" ${rest}${inner === '' ? '/>' : `>${inner}</line>`}`

// A long loop resumes from where the clock says it is, so a redraw does not
// send the boat and the cars back to their start.
const loop = (now: number, dur: number, shift = 0): string => {
  const into = (((now / 1000 + shift) % dur) + dur) % dur

  return `dur="${dur}s" begin="${into < 0.05 ? '0' : `-${n(into)}`}s" repeatCount="indefinite"`
}

const LIGHT = '#f4e3b5'
const NIGHT = '#dfe6f5'
const MOON = '#ece6cf'
const WATER = '#1c2c40'

// A box standing on the grid: its two front faces and its top.
const prism = (gx: number, gy: number, w: number, d: number, h: number, color: string, base = 0): string =>
  `<polygon points="${at(gx, gy + d, base)} ${at(gx + w, gy + d, base)} ${at(gx + w, gy + d, base + h)} ${at(gx, gy + d, base + h)}" fill="${mix(color, C.bg, 0.22)}"/>` +
  `<polygon points="${at(gx + w, gy, base)} ${at(gx + w, gy + d, base)} ${at(gx + w, gy + d, base + h)} ${at(gx + w, gy, base + h)}" fill="${mix(color, C.bg, 0.48)}"/>` +
  tile(gx, gy, w, d, base + h, `fill="${mix(color, '#ffffff', 0.1)}"`)

// Rows of lit windows across both front faces.
// A building with a seed has one floor where the lights go off and on.
const windows = (lot: Lot, color: string, seed = -1, isStill = false): string => {
  const { gx, gy, size } = lot
  const rows = Math.max(1, Math.ceil((lot.height - 8) / 6.5))
  const dark = seed % 3 === 0 ? (seed >> 2) % rows : -1
  let out = ''
  let row = 0
  for (let z = 5; z < lot.height - 3; z += 6.5) {
    const flick =
      row === dark && !isStill
        ? `<animate attributeName="opacity" values=".9;.15;.15;.9;.9" keyTimes="0;.03;.3;.33;1" dur="${7 + (seed % 7)}s" repeatCount="indefinite"/>`
        : ''
    out +=
      seg([gx + size * 0.16, gy + size, z], [gx + size * 0.84, gy + size, z], `stroke="${color}" stroke-width="2" stroke-dasharray="2.2 2.2" opacity=".9"`, flick) +
      seg([gx + size, gy + size * 0.84, z], [gx + size, gy + size * 0.16, z], `stroke="${color}" stroke-width="2" stroke-dasharray="2.2 2.2" opacity=".5"`)
    row += 1
  }

  return out
}

// What stands on a finished roof, so that no two streets look alike: a mast
// with a beacon, a stair hut, a garden, a neon sign, or nothing.
const rooftop = (lot: Lot, seed: number, color: string, isStill: boolean): string => {
  const { gx, gy, size, height } = lot
  const kind = seed % 5
  if (kind === 0) {
    const x = sx(gx + size * 0.3, gy + size * 0.3)
    const y = sy(gx + size * 0.3, gy + size * 0.3) - height

    return (
      `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x)}" y2="${n(y - 8)}" stroke="${C.muted}" stroke-width=".7"/>` +
      `<circle cx="${n(x)}" cy="${n(y - 8.6)}" r="1" fill="${C.text}">${isStill ? '' : `<animate attributeName="opacity" values="1;.1;1" dur="${n(2 + (seed % 4) * 0.4)}s" repeatCount="indefinite"/>`}</circle>`
    )
  }
  if (kind === 1) return prism(gx + size * 0.12, gy + size * 0.12, size * 0.38, size * 0.38, 3.5, mix(color, C.muted, 0.3), height)
  if (kind === 2) return tile(gx + size * 0.18, gy + size * 0.18, size * 0.64, size * 0.64, height, `fill="${mix(C.done, C.bg, 0.3)}"`)
  if (kind === 3) {
    return seg(
      [gx + size * 0.2, gy + size, height - 2.4],
      [gx + size * 0.8, gy + size, height - 2.4],
      `stroke="${seed % 2 === 0 ? C.skill : C.proc}" stroke-width="1.5" stroke-linecap="round"`,
      isStill ? '' : `<animate attributeName="opacity" values="1;.4;1" dur="${n(2.6 + (seed % 5) * 0.5)}s" repeatCount="indefinite"/>`,
    )
  }

  return ''
}

// Scaffolding up to the height the building will reach, with a crane on top.
const scaffold = (lot: Lot, from: number, color: string, isStill: boolean): string => {
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
    `<path d="M${n(mx)} ${n(my)}v-10h-13" fill="none" stroke="${color}" stroke-width=".9"/>` +
    // The crane's load, going up and down on its cable.
    `<line x1="${n(mx - 10)}" y1="${n(my - 10)}" x2="${n(mx - 10)}" y2="${n(my - 5)}" stroke="${color}" stroke-width=".6">${isStill ? '' : `<animate attributeName="y2" values="${n(my - 7)};${n(my - 1)};${n(my - 7)}" dur="5s" repeatCount="indefinite"/>`}</line>` +
    `<rect x="${n(mx - 11.3)}" y="${n(my - 5)}" width="2.6" height="2" fill="${color}">${isStill ? '' : `<animate attributeName="y" values="${n(my - 7)};${n(my - 1)};${n(my - 7)}" dur="5s" repeatCount="indefinite"/>`}</rect>` +
    `<circle cx="${n(mx)}" cy="${n(my - 10)}" r="1.7" fill="${color}">${isStill ? '' : `<animate attributeName="opacity" values="1;.15;1" dur="1.6s" repeatCount="indefinite"/>`}</circle>`
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

// What stands on a finished roof to tell how it stands with its checks: a
// sage pennant when something confirmed it, a rose cross when it was refuted.
// Work nobody checked has no mark, and its body and windows are quieter.
const verdictMark = (lot: Lot, standing: 'verified' | 'refuted'): string => {
  const { gx, gy, size, height } = lot
  if (standing === 'refuted') {
    const rest = `stroke="${C.fail}" stroke-width="1.7" stroke-linecap="round"`

    return (
      seg([gx + size * 0.28, gy + size * 0.28, height], [gx + size * 0.72, gy + size * 0.72, height], rest) +
      seg([gx + size * 0.72, gy + size * 0.28, height], [gx + size * 0.28, gy + size * 0.72, height], rest)
    )
  }
  const x = sx(gx + size * 0.85, gy + size * 0.15)
  const y = sy(gx + size * 0.85, gy + size * 0.15) - height

  return (
    `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x)}" y2="${n(y - 8)}" stroke="${C.muted}" stroke-width=".7"/>` +
    `<path d="M${n(x)} ${n(y - 8)}l6 2.2l-6 2.2z" fill="${C.done}"/>`
  )
}

const building = (task: Task, lot: Lot, blocked: boolean, hasDetail: boolean, isStill: boolean): string => {
  const { gx, gy, size, height } = lot
  const owner = task.owner === undefined ? '' : ` · ${clip(task.owner, 24)}`
  const note = verdictNote(task)
  const title = `<title>${esc(`${clip(task.subject, 80)} · ${blocked ? 'blocked' : STATUS_WORD[task.status]}${owner} · ${task.area}${note === '' ? '' : ` · ${note}`}`)}</title>`
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
      (hasDetail ? scaffold(lot, roofOf(task, lot), color, isStill) : '') +
      `</g>`
    )
  }

  // Finished buildings differ a little in shade, in the light of their
  // windows and in what stands on the roof.
  const seed = hash(task.id)
  const standing = standingOf(task)
  const checked = mix(C.done, C.tile, 0.36 + (seed % 4) * 0.045)
  // Done but not checked reads quieter: a paler, greyer body and windows
  // that are barely lit.
  const body = standing === 'unchecked' ? mix(checked, C.muted, 0.42) : checked
  const lit = seed % 4 === 1 ? mix(C.agent, '#ffffff', 0.35) : mix(C.run, '#ffffff', 0.25)
  const glass = standing === 'unchecked' ? mix(lit, C.tile, 0.82) : lit

  return (
    `<g>${title}${prism(gx, gy, size, size, height, body)}` +
    (hasDetail ? windows(lot, glass, standing === 'unchecked' ? -1 : seed, isStill) + rooftop(lot, seed, body, isStill) : '') +
    (standing === 'verified' || standing === 'refuted' ? verdictMark(lot, standing) : '') +
    `</g>`
  )
}

// Archived work: a finished building drawn quieter, with barely lit windows
// and nothing on its roof, so that this week's work still stands out.
const ARCHIVED = mix(mix(C.done, C.tile, 0.55), C.muted, 0.55)

const archivedBuilding = (entry: ArchiveEntry, lot: Lot, hasDetail: boolean): string =>
  `<g><title>${esc(`${clip(entry.subject, 80)} · archived · ${entry.area}`)}</title>` +
  prism(lot.gx, lot.gy, lot.size, lot.size, lot.height, ARCHIVED) +
  (hasDetail ? windows(lot, mix(C.run, C.tile, 0.85)) : '') +
  `</g>`

// A district's oldest work: three towers on one lot, taller the more they
// stand for.
const oldTown = (lot: Lot, count: number, area: string): string => {
  const grown = Math.min(1, Math.log10(count + 1) / 4)
  const towers = [
    [0.05, 0.05, 0.5, 1],
    [0.5, 0.1, 0.4, 0.7],
    [0.1, 0.55, 0.38, 0.55],
  ] as const
  const body = mix(ARCHIVED, C.bg, 0.25)

  return (
    `<g><title>${esc(`Old town: ${count.toLocaleString('en-US')} done in ${area}`)}</title>` +
    towers
      .map(([dx, dy, side, share]) =>
        prism(lot.gx + lot.size * dx, lot.gy + lot.size * dy, lot.size * side, lot.size * side, (10 + 46 * grown) * share, body),
      )
      .join('') +
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
  const flag = (bend: number): string =>
    `M${n(cx)} ${n(cy - 17)}q5 ${n(bend)} 10 3.2q-5 ${n(-bend)} -10 3.2z`
  const top = topWait(m.waits ?? [])
  const needsYou = top !== undefined && isBlocking(top)
  const wave = m.turn.isWorking && m.isStill !== true
    ? `<animate attributeName="d" values="${flag(-1.6)};${flag(3)};${flag(-1.6)}" dur="1.4s" repeatCount="indefinite"/>`
    : ''

  return {
    depth: depthOf(HALL),
    svg:
      `<g><title>${esc(`City hall: the main session, ${m.turn.isWorking ? 'working' : 'idle'}${needsYou ? ` · needs you: ${waitText(top)}` : ''}`)}</title>` +
      prism(gx, gy, size, size, 20, HALL_COLOR) +
      columns +
      prism(gx + 0.4, gy + 0.4, 0.9, 0.9, 10, mix(C.agent, C.tile, 0.34), 20) +
      prism(gx + 0.65, gy + 0.65, 0.4, 0.4, 6, mix(C.agent, C.tile, 0.22), 30) +
      `<line x1="${n(cx)}" y1="${n(cy)}" x2="${n(cx)}" y2="${n(cy - 17)}" stroke="${C.muted}" stroke-width=".9"/>` +
      `<path d="${flag(-1.6)}" fill="${needsYou ? C.fail : m.turn.isWorking ? C.run : C.muted}">${wave}</path>` +
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
  // Still, the smoke is three puffs hung one above the other.
  const smoke = m.turn.isWorking && m.isStill === true
    ? [0, 1, 2]
        .map(
          k =>
            `<circle cx="${n(tx)}" cy="${n(ty - 5 - k * 6)}" r="${n(2 + k * 0.8)}" fill="${C.muted}" opacity="${n(0.45 - k * 0.12)}"/>`,
        )
        .join('')
    : m.turn.isWorking
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

const works = (running: readonly Proc[], isStill: boolean): Drawable => {
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
        (isStill ? '' : `<animate attributeName="opacity" values="1;.2;1" dur="${n(1.4 + k * 0.3)}s" repeatCount="indefinite"/>`) +
        `</circle>`
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

const tree = (gx: number, gy: number, r: number, isStill: boolean): Drawable => {
  const x = sx(gx, gy)
  const y = sy(gx, gy)

  // Three kinds by where the tree stands: a round crown, a cherry in blossom
  // that sheds petals, a conifer. All of them sway.
  const kind = Math.round(gx * 7 + gy * 13) % 3
  const pivot = `${n(x)} ${n(y)}`
  const sway = isStill
    ? ''
    : `<animateTransform attributeName="transform" type="rotate" values="-2.5 ${pivot};2.5 ${pivot};-2.5 ${pivot}" dur="${n(4.5 + kind)}s" repeatCount="indefinite"/>`
  const blossom = mix(C.fail, C.bg, 0.38)
  const crown =
    kind === 0
      ? `<circle cx="${n(x)}" cy="${n(y - 8)}" r="${r}" fill="${mix(C.done, C.bg, 0.55)}"/>` +
        `<circle cx="${n(x - 1)}" cy="${n(y - 9)}" r="${n(r * 0.45)}" fill="${mix(C.done, C.bg, 0.4)}"/>`
      : kind === 1
        ? `<circle cx="${n(x - 1.7)}" cy="${n(y - 7.6)}" r="${n(r * 0.75)}" fill="${blossom}"/>` +
          `<circle cx="${n(x + 1.5)}" cy="${n(y - 8.6)}" r="${n(r * 0.8)}" fill="${mix(C.fail, C.bg, 0.25)}"/>`
        : `<path d="M${n(x - r)} ${n(y - 4)}L${n(x)} ${n(y - 15)}L${n(x + r)} ${n(y - 4)}z" fill="${mix(C.proc, C.bg, 0.6)}"/>`
  const petals =
    kind === 1 && isStill
      ? [[1, -4], [3.4, 0]]
          .map(([dx = 0, dy = 0]) => `<circle cx="${n(x + dx)}" cy="${n(y + dy)}" r=".7" fill="${mix(C.fail, '#ffffff', 0.25)}" opacity=".8"/>`)
          .join('')
      : kind === 1
      ? [0, 1.7]
          .map(delay => {
            const fall = `dur="3.4s" begin="${delay}s" repeatCount="indefinite"`

            return (
              `<circle r=".7" fill="${mix(C.fail, '#ffffff', 0.25)}" opacity="0">` +
              `<animate attributeName="cx" values="${n(x - 2)};${n(x + 4)}" ${fall}/>` +
              `<animate attributeName="cy" values="${n(y - 8)};${n(y + 1)}" ${fall}/>` +
              `<animate attributeName="opacity" values=".9;0" ${fall}/></circle>`
            )
          })
          .join('')
      : ''

  return {
    depth: gx + gy,
    svg:
      `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x)}" y2="${n(y - 6)}" stroke="${C.faint}" stroke-width="1"/>` +
      `<g>${sway}${crown}</g>` +
      petals,
  }
}

// ------------------------------------------------------------------ ambience

// The screen height at which the line of grid row `gy` passes under `x`.
const bankY = (x: number, gy: number): number => (x * TH) / TW + gy * TH

// A canal runs past the back of the city, behind City Hall.
const CANAL = { start: -1.2, end: 14, near: -0.9, far: -4.5 } as const

type Moon = readonly [x: number, y: number, r: number]

type View = { minX: number; minY: number; maxX: number; isColumn: boolean; moon: Moon }

// The night over the city: stars, a cloud, a shooting star now and then, and
// a moon that fills as the project gets done.
const sky = (m: CityInput, view: View, percent: number): string => {
  const { minX, minY, maxX, isColumn } = view
  const [mx, my, mr] = view.moon
  let seed = 11
  const next = (): number => {
    seed = (seed * 137 + 187) % 1021

    return seed / 1021
  }
  let stars = ''
  const count = Math.max(40, Math.min(130, Math.round((maxX - minX) / 4.5)))
  for (let k = 0; k < count; k += 1) {
    const x = minX + 6 + next() * (maxX - minX - 12)
    const y = minY + 5 + next() * ((isColumn ? 4 : 14) - minY)
    // Clear of the words: the column's key at the top, the callouts beside
    // City Hall otherwise.
    const inKey = isColumn
      ? y < minY + 82
      : Math.abs(x) > 60 && Math.abs(x) < 172 && y > -20 && y < 34
    const overCity = y > Math.abs(x) / 2 - 16
    const overCanal = x > -8 && y > bankY(x, CANAL.far) - 4
    if (inKey || overCity || overCanal || Math.hypot(x - mx, y - my) < mr * 2.3) continue
    const twinkle =
      k % 3 === 0 && m.isStill !== true
        ? `<animate attributeName="opacity" values=".8;.15;.8" dur="${n(2.5 + next() * 4)}s" repeatCount="indefinite"/>`
        : ''
    stars += `<circle cx="${n(x)}" cy="${n(y)}" r="${n(0.45 + next() * 0.6)}" fill="${NIGHT}" opacity="${n(0.3 + next() * 0.5)}">${twinkle}</circle>`
  }

  const lit = Math.max(0.12, Math.min(1, percent / 100))
  const moon =
    `<g><title>${esc(`Moon: the project is ${percent}% done`)}</title>` +
    `<circle cx="${mx}" cy="${my}" r="${n(mr * 1.9)}" fill="${MOON}" opacity=".05"/>` +
    `<circle cx="${mx}" cy="${my}" r="${n(mr * 1.4)}" fill="${MOON}" opacity=".07"/>` +
    `<circle cx="${mx}" cy="${my}" r="${mr}" fill="${mix(C.faint, C.bg, 0.45)}"/>` +
    `<path d="M${mx} ${n(my - mr)}A${mr} ${mr} 0 0 1 ${mx} ${n(my + mr)}A${n(mr * Math.abs(1 - 2 * lit))} ${mr} 0 0 ${lit > 0.5 ? 1 : 0} ${mx} ${n(my - mr)}z" fill="${MOON}"/>` +
    `</g>`

  const drift = isColumn ? -52 : -74
  const cloud =
    `<g fill="${C.text}" opacity=".08"${m.isStill === true ? ` transform="translate(${n(minX + (maxX - minX) * 0.3)} ${drift})"` : ''}>` +
    (m.isStill === true
      ? ''
      : `<animateTransform attributeName="transform" type="translate" values="${n(minX - 40)} ${drift};${n(maxX + 40)} ${drift}" ${loop(m.now, 140, 50)}/>`) +
    `<ellipse rx="16" ry="5"/><ellipse cx="11" cy="-3" rx="10" ry="5"/><ellipse cx="-10" cy="-2" rx="9" ry="4"/></g>`

  const [from, to] = isColumn ? ['-15 -62', '-62 -44'] : ['104 -80', '52 -58']
  const fall = loop(m.now, 19, 5)
  const shooting =
    `<line x1="0" y1="0" x2="13" y2="-5.5" stroke="${NIGHT}" stroke-width=".8" stroke-linecap="round" opacity="0">` +
    `<animateTransform attributeName="transform" type="translate" values="${from};${to};${to}" keyTimes="0;.035;1" ${fall}/>` +
    `<animate attributeName="opacity" values="0;.9;0;0" keyTimes="0;.012;.035;1" ${fall}/></line>`

  // A shooting star is only there for a moment: still, there is none.
  return stars + moon + cloud + (m.isStill === true ? '' : shooting)
}

// The canal: slow waves, the moon on the water, a lighthouse on its islet
// and a small boat that sails up and down.
const canal = (m: CityInput, view: View): string => {
  const { start, end, near, far } = CANAL
  const [mx] = view.moon
  let out =
    tile(start, far, end - start, near - far, 0, `fill="${WATER}"`) +
    seg([start, near, 0], [end, near, 0], `stroke="${mix(WATER, C.text, 0.18)}" stroke-width="1"`)
  ;[-1.75, -2.7, -3.65].forEach((gy, k) => {
    out += seg(
      [start + 0.3, gy, 0],
      [end, gy, 0],
      `stroke="${mix(WATER, C.agent, 0.4)}" stroke-width=".7" stroke-linecap="round" stroke-dasharray="5 ${12 + k * 3}"`,
      m.isStill === true ? '' : `<animate attributeName="stroke-dashoffset" values="0;${17 + k * 3}" dur="${6 + k * 2}s" repeatCount="indefinite"/>`,
    )
  })
  if (!view.isColumn) {
    const top = bankY(mx, far) + 9
    ;[10, 7, 4].forEach((width, k) => {
      const y = n(top + k * 5.5)
      out +=
        `<line x1="${n(mx - width / 2)}" y1="${y}" x2="${n(mx + width / 2)}" y2="${y}" stroke="${MOON}" stroke-width="1" stroke-linecap="round" opacity=".4">` +
        (m.isStill === true ? '' : `<animate attributeName="opacity" values=".45;.1;.45" dur="${3 + k}s" repeatCount="indefinite"/>`) +
        `</line>`
    })
  }

  const lx = sx(-0.47, -3.82)
  const ly = sy(-0.47, -3.82) - 14.5
  out +=
    tile(-0.8, -4.15, 0.65, 0.65, 0, `fill="${mix(C.muted, C.bg, 0.62)}"`) +
    prism(-0.57, -3.92, 0.2, 0.2, 13, mix(C.text, C.tile, 0.35)) +
    `<circle cx="${n(lx)}" cy="${n(ly)}" r="5" fill="${LIGHT}" opacity=".3">${m.isStill === true ? '' : `<animate attributeName="opacity" values=".3;.04;.3" dur="3.6s" repeatCount="indefinite"/>`}</circle>` +
    `<circle cx="${n(lx)}" cy="${n(ly)}" r="1.3" fill="${LIGHT}"/>`

  // Still, the boat lies at the middle of its run.
  const middle = ((view.isColumn ? 1.7 : 7.2) - 0.5) / 2
  out +=
    (m.isStill === true
      ? `<g transform="translate(${n(sx(middle, -2.7))} ${n(sy(middle, -2.7))})">`
      : `<g><animateMotion path="M${at(-0.5, -2.7)}L${at(view.isColumn ? 1.7 : 7.2, -2.7)}" keyPoints="0;1;0" keyTimes="0;.5;1" calcMode="linear" ${loop(m.now, view.isColumn ? 40 : 80)}/>`) +
    `<g>${m.isStill === true ? '' : `<animateTransform attributeName="transform" type="translate" values="0 0;0 .9;0 0" dur="3s" repeatCount="indefinite"/>`}` +
    `<path d="M-4 0h8l-1.5 2.2h-5z" fill="${mix(C.run, C.bg, 0.35)}"/>` +
    `<line x1="0" y1="0" x2="0" y2="-8" stroke="${C.muted}" stroke-width=".6"/>` +
    `<path d="M.6-7.6l4.4 6.4h-4.4z" fill="${C.text}" opacity=".85"/>` +
    `<circle cx="-2.6" cy="-1" r=".7" fill="${LIGHT}"/></g></g>`

  return out
}

// A street lamp and the pool of light under it.
const lamp = (gx: number, gy: number): { pool: string; post: Drawable } => {
  const x = n(sx(gx, gy))
  const y = sy(gx, gy)

  return {
    pool: `<ellipse cx="${x}" cy="${n(y)}" rx="8" ry="4" fill="${LIGHT}" opacity=".06"/>`,
    post: {
      depth: gx + gy,
      svg:
        `<line x1="${x}" y1="${n(y)}" x2="${x}" y2="${n(y - 8)}" stroke="${C.faint}" stroke-width=".8"/>` +
        `<circle cx="${x}" cy="${n(y - 8.6)}" r="3.4" fill="${LIGHT}" opacity=".14"/>` +
        `<circle cx="${x}" cy="${n(y - 8.6)}" r="1.1" fill="${LIGHT}"/>`,
    },
  }
}

// A car going round a block: headlights one way round, tail lights the other.
const car = (slot: Slot, index: number, now: number): string => {
  const a = slot[0] * PITCH - 0.27
  const b = slot[1] * PITCH - 0.27
  const far = BLOCK + 0.54
  const ring = [at(a, b), at(a + far, b), at(a + far, b + far), at(a, b + far)]
  if (index % 2 === 1) ring.reverse()
  const color = index % 2 === 0 ? LIGHT : mix(C.fail, '#ffffff', 0.15)

  return (
    `<circle r="1.1" fill="${color}" stroke="${color}" stroke-opacity=".25" stroke-width="2.4">` +
    `<animateMotion path="M${ring.join('L')}z" ${loop(now, 17 + ((index * 5) % 11), index * 3)}/></circle>`
  )
}

// Every task done: fireworks over City Hall.
const fireworks = (isColumn: boolean, isStill: boolean): string =>
  (isColumn
    ? ([[-16, -50], [12, -57], [28, -44]] as const)
    : ([[-18, -58], [14, -66], [32, -50]] as const)
  )
    .map(([x, y], k) => {
      const burst = `dur="2.6s" begin="${n(k * 0.85)}s" repeatCount="indefinite"`
      const radius = isColumn ? 11 : 15
      // Still, each burst is held open, a ring of sparks at three quarters.
      if (isStill) {
        return `<circle cx="${x}" cy="${y}" r="${n(radius * 0.75)}" fill="none" stroke="${[C.run, C.fail, C.skill][k] ?? C.run}" stroke-width="1.6" stroke-linecap="round" pathLength="48" stroke-dasharray="1 5" opacity=".9"/>`
      }

      return (
        `<circle cx="${x}" cy="${y}" r="1" fill="none" stroke="${[C.run, C.fail, C.skill][k] ?? C.run}" stroke-width="1.6" stroke-linecap="round" pathLength="48" stroke-dasharray="1 5" opacity="0">` +
        `<animate attributeName="r" values="1;${isColumn ? 11 : 15}" ${burst}/>` +
        `<animate attributeName="opacity" values="0;1;0" keyTimes="0;.25;1" ${burst}/></circle>`
      )
    })
    .join('')

// A district's lots: as few and as large as its tasks allow, with a tree or
// two where a lot is left over.
const lotsOf = (
  district: Quarter,
  slot: Slot,
  all: readonly Task[],
  isStill: boolean,
): { lots: Map<string, Lot>; archived: Lot[]; town: Lot | undefined; trees: Drawable[] } => {
  const bx = slot[0] * PITCH
  const by = slot[1] * PITCH
  const shown = district.tasks.slice(0, 16)
  // The board's work in front, the archive's behind it, the old town last.
  const taken = shown.length + district.archived.length + (district.oldTown > 0 ? 1 : 0)
  const side = Math.max(1, Math.ceil(Math.sqrt(taken)))
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
  const size = Math.min(1.25, cell * 0.64)
  const archived = district.archived.map((entry, k): Lot => {
    const [gx, gy] = corner(shown.length + k, size)

    return { gx, gy, size, height: (12 + (hash(entry.id) % 8)) * Math.min(1.5, Math.max(1, size / 0.8)) }
  })
  const townSize = Math.min(1.6, cell * 0.86)
  const [tx, ty] = corner(taken - 1, townSize)
  const town = district.oldTown > 0 ? { gx: tx, gy: ty, size: townSize, height: 0 } : undefined
  const trees: Drawable[] = []
  for (let index = side * side - 1; index >= taken && trees.length < 2; index -= 1) {
    const [gx, gy] = corner(index, 0)
    trees.push(tree(gx, gy, 3 + (index % 2), isStill))
  }

  return { lots, archived, town, trees }
}

// A district as the drawing has it: the board's tasks, and in the full city
// the archive's newest finished work not on the board and how many older
// tasks its old town stands for.
type Quarter = District & { archived: ArchiveEntry[]; oldTown: number }

// How many archived buildings a district shows before the rest go to its old town.
const ARCHIVE_CAP = 24

// The districts to draw: the board's in the order their first task
// appeared, then those only the archive knows, newest first.
export const quartersOf = (m: CityInput, cap = ARCHIVE_CAP): Quarter[] => {
  const quarters: Quarter[] = districtsOf(m.tasks).map(district => ({ ...district, archived: [], oldTown: 0 }))
  if (m.archive === undefined) return quarters
  const find = (area: string): Quarter => {
    const found = quarters.find(one => one.area === area)
    if (found !== undefined) return found
    const made: Quarter = { area, tasks: [], archived: [], oldTown: 0 }
    quarters.push(made)

    return made
  }
  for (const entry of [...m.archive.entries].sort((a, b) => b.doneAt - a.doneAt)) {
    const quarter = find(entry.area)
    if (quarter.archived.length < cap) quarter.archived.push(entry)
    else quarter.oldTown += 1
  }
  for (const [area, count] of Object.entries(m.archive.folded)) find(area).oldTown += count

  return quarters
}

// The box a layout's drawing takes with this many districts, cropped to what
// is built: the blocks, the callouts beside City Hall (or the column's key
// above it), the sky over the roofs and the name plates under the front row.
const extentOf = (
  layout: CityLayout,
  count: number,
): { minX: number; maxX: number; minY: number; maxY: number } => {
  const isColumn = layout === 'column'
  const used: Slot[] = [[0, 0], ...slotsOf(layout).slice(0, count)]
  const left = Math.min(...used.map(slot => sx(slot[0] * PITCH - 0.5, slot[1] * PITCH + BLOCK + 0.5)))
  const right = Math.max(...used.map(slot => sx(slot[0] * PITCH + BLOCK + 0.5, slot[1] * PITCH - 0.5)))
  const front = Math.max(...used.map(slot => sy(slot[0] * PITCH + BLOCK, slot[1] * PITCH + BLOCK)))

  return {
    minX: isColumn ? -73 : Math.min(left - 24, -164),
    maxX: isColumn ? 73 : Math.max(right + 24, 164),
    minY: isColumn ? -146 : -86,
    maxY: front + (isColumn ? 60 : 46),
  }
}

// The layout that draws this city largest in a room of this shape (width
// over height). On a tie the wider layout stands.
export const layoutFor = (m: CityInput, aspect: number): CityLayout => {
  const count = quartersOf(m).length
  let best: CityLayout = 'wide'
  let most = 0
  for (const layout of ['wide', 'avenue', 'column'] as const) {
    const box = extentOf(layout, count)
    // The column lists its key in a corner instead of on the buildings, so
    // it has to draw the city a quarter larger to be worth it.
    const scale =
      Math.min(aspect / (box.maxX - box.minX), 1 / (box.maxY - box.minY)) / (layout === 'column' ? 1.25 : 1)
    if (scale > most * 1.02) {
      most = scale
      best = layout
    }
  }

  return best
}

// What a drawing too large for the surface gives up, one step at a time: the
// detail on its buildings, then the night and street life around them along
// with the detail and the motion of its figures.
type Shed = 0 | 1 | 2 | 3

// The speech bubble the main session raises when it waits on the person: a
// rose bubble with a `!`, over the head of the figure standing at (x, y).
const bubble = (x: number, y: number, text: string, isStill: boolean): string =>
  `<g transform="translate(${n(x)} ${n(y - 34)})"><title>${esc(`needs you: ${text}`)}</title>` +
  `<g>${isStill ? '' : `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1.8;0 0" dur="1.2s" repeatCount="indefinite"/>`}` +
  `<rect x="-7" y="-10" width="14" height="11" rx="3.4" fill="${C.fail}"/>` +
  `<path d="M-2 .5L0 5.4 2 .5z" fill="${C.fail}"/>` +
  `<text x="0" y="-1.6" ${FONT} font-size="9.5" font-weight="700" fill="${C.bg}" text-anchor="middle">!</text>` +
  `</g></g>`

// The signal mast on the civic block: one lamp for each check that has run,
// in the order the checks are listed. Sage is passed, rose failed, and a
// hollow amber ring stale. It stands on the ground at the block's right
// corner, clear of the plant, of the callout lines and of the figures.
const MAST: Place = { gx: 3.9, gy: 0.15, size: 0 }

const signalMast = (checks: readonly Check[]): string => {
  const lamps = CHECK_KINDS.flatMap(kind => {
    const check = checks.find(one => one.kind === kind)

    return check === undefined ? [] : [{ kind, check, state: stateOf(check) }]
  })
  if (lamps.length === 0) return ''
  const x = sx(MAST.gx, MAST.gy)
  const y = sy(MAST.gx, MAST.gy)
  const top = y - 8 - lamps.length * 5.4
  const edits = (count: number): string => `${count} ${count === 1 ? 'edit' : 'edits'}`

  return (
    `<ellipse cx="${n(x)}" cy="${n(y)}" rx="3.6" ry="1.5" fill="${C.faint}"/>` +
    `<line x1="${n(x)}" y1="${n(y)}" x2="${n(x)}" y2="${n(top)}" stroke="${C.muted}" stroke-width="1"/>` +
    lamps
      .map(({ kind, check, state }, index) => {
        const cy = top + 2.7 + index * 5.4
        const said =
          state === 'stale'
            ? `${CHECK_LABEL[kind]} stale: ${edits(check.editsSince)} since it passed`
            : `${CHECK_LABEL[kind]} ${state}`
        const lamp =
          state === 'stale'
            ? `<circle cx="${n(x)}" cy="${n(cy)}" r="1.9" fill="none" stroke="${C.run}" stroke-width="1.1"/>`
            : `<circle cx="${n(x)}" cy="${n(cy)}" r="2" fill="${state === 'passed' ? C.done : C.fail}"/>`

        return (
          `<g><title>${esc(said)}</title>` +
          `<rect x="${n(x - 3)}" y="${n(cy - 2.7)}" width="6" height="5.4" rx="1.4" fill="${C.bg}" stroke="${C.faint}" stroke-width=".5"/>` +
          lamp +
          `</g>`
        )
      })
      .join('')
  )
}

const draw = (m: CityInput, shed: Shed, layout: CityLayout, aspect?: number, cap = ARCHIVE_CAP): string => {
  const hasDetail = shed < 1
  const hasAmbience = shed < 2
  const isStill = m.isStill === true
  const isColumn = layout === 'column'
  // The column is drawn for a narrow slot: its words are set larger against
  // its buildings, so they stay readable once the surface scales it down.
  const type = isColumn ? 1.2 : 1
  const slots = slotsOf(layout)
  const districts = quartersOf(m, cap).slice(0, slots.length)
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
  // Street life: a lamp on a back street of each block, clear of the name
  // plates at the front corners, and a few cars going round.
  used.forEach(([i, j], index) => {
    if (!hasAmbience) return
    const light =
      index % 2 === 0
        ? lamp(i * PITCH + BLOCK * 0.75, j * PITCH - 0.25)
        : lamp(i * PITCH - 0.25, j * PITCH + BLOCK * 0.75)
    ground += light.pool
    things.push(light.post)
    if (index < 7 && !isStill) ground += car([i, j], index, m.now)
  })

  // The civic block: hall, plant, library and works around a small square.
  const running = m.procs.filter(proc => proc.status === 'running')
  things.push(cityHall(m), powerPlant(m), library(m), works(running, isStill))

  // Districts: a block per work area, a building per task.
  const where = new Map<string, Lot>()
  const roofs = new Map<string, number>()
  districts.forEach((district, index) => {
    const slot = slots[index] ?? ([0, 0] as const)
    const bx = slot[0] * PITCH
    const by = slot[1] * PITCH
    const { lots, archived, town, trees } = lotsOf(district, slot, m.tasks, isStill)
    things.push(...trees)
    district.archived.forEach((entry, k) => {
      const lot = archived[k]
      if (lot !== undefined) things.push({ depth: depthOf(lot), svg: archivedBuilding(entry, lot, hasDetail) })
    })
    if (town !== undefined) things.push({ depth: depthOf(town), svg: oldTown(town, district.oldTown, district.area) })
    for (const task of district.tasks) {
      const lot = lots.get(task.id)
      if (lot === undefined) continue
      where.set(task.id, lot)
      roofs.set(task.id, roofOf(task, lot))
      things.push({
        depth: depthOf(lot),
        svg: building(task, lot, isBlocked(task, m.tasks), hasDetail, isStill),
      })
    }
    const stats = taskStats(district.tasks)
    const x = sx(bx + BLOCK, by + BLOCK)
    const y = sy(bx + BLOCK, by + BLOCK) + 12
    const hidden = district.tasks.length - lots.size
    labels.push(
      label(x, y, `${clip(district.area, 10).toUpperCase()}  ${stats.done}/${stats.total}${hidden > 0 ? ` +${hidden}` : ''}`, { size: 8.5 * type, fill: C.text, hasPill: true }) +
        `<rect x="${n(x - 18)}" y="${n(y + 4.5)}" width="36" height="2.4" rx="1.2" fill="${C.faint}"/>` +
        `<rect x="${n(x - 18)}" y="${n(y + 4.5)}" width="${n(stats.total === 0 ? 0 : (36 * stats.done) / stats.total)}" height="2.4" rx="1.2" fill="${C.done}"/>` +
        (district.oldTown > 0
          ? label(x, y + 16 * type, `old town · ${district.oldTown.toLocaleString('en-US')} done`, { size: 7 * type, hasPill: true })
          : ''),
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
  const wait = topWait(m.waits ?? [])
  const needsYou = wait !== undefined && isBlocking(wait)
  const state = sessionState(m.turn.isWorking, m.waits ?? [])
  people.push({
    depth: square[0] + square[1],
    svg:
      avatar(mayorX, mayorY, 'main', m.usage.mainFamilies, {
        isLive: m.turn.isWorking,
        isPlain: !hasAmbience,
        isStill,
        title: `Main session · ${m.turn.isWorking ? 'working' : 'idle'} · ${m.turn.tools} tool calls this prompt`,
        ...(needsYou ? { note: waitText(wait) } : {}),
      }) + (needsYou ? bubble(mayorX, mayorY, waitText(wait), isStill) : ''),
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
      x = sx(lot.gx + lot.size / 2, lot.gy + lot.size / 2) + (beside % 2 === 0 ? 1 : -1) * Math.ceil(beside / 2) * 15
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
        isPlain: !hasAmbience,
        isStill,
        title: `${run.name === undefined ? '' : `${clip(run.name, 24)}: `}${clip(run.label, 60)} · ${run.type} · ${run.tools} tool calls · ${compact(run.tokens)} tokens`,
      }),
    })
  }

  // The view is cropped to what is built, then let out to the shape of the
  // room it is drawn into (`aspect`, width over height), so the city is as
  // large as its slot allows. The column keeps its key above City Hall.
  let { minX, maxX, minY } = extentOf(layout, districts.length)
  const { maxY } = extentOf(layout, districts.length)
  if (aspect !== undefined) {
    const spare = (maxY - minY) * aspect - (maxX - minX)
    if (spare > 0) {
      minX -= spare / 2
      maxX += spare / 2
    } else {
      minY += spare / aspect
    }
  }
  const boxW = maxX - minX
  const boxH = maxY - minY
  // Drawn larger than any slot: a surface scales a drawing down to its slot,
  // never up.
  const width = 1600

  // The key: each civic building by its color, with the figure it stands for.
  const keyX = minX + (isColumn ? 7 : 12)
  const keyY = minY + 16
  const { expected } = m.turn
  const spent = expected === null ? undefined : gaugeOf(m.turn.tokens, expected.tokens)
  const spentColor = spent === undefined ? C.muted : spent.state === 'over' ? C.fail : spent.state === 'within' ? C.run : C.done
  const skillCount = Object.keys(m.skills.used).length
  // The session's word: rose when it waits on the person, amber when the
  // turn is handed back, and plain otherwise.
  const sessionInk = state === 'needs you' ? C.fail : state === 'your turn' ? C.run : undefined
  const rows: readonly (readonly [string, string, string, number | undefined])[] = [
    [HALL_COLOR, state === 'your turn' ? 'your turn' : `main session ${state}`, C.muted, undefined],
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
        label(keyX + 10, y, text, { anchor: 'start', size: 7.5 * type, fill: index === 0 ? (sessionInk ?? C.muted) : C.muted }) +
        (share === undefined ? '' : meter(keyX + (isColumn ? 100 : 88), y - 4.4, share, color))
      )
    })
    .join('')

  const legend = [
    [C.done, 'verified'],
    [mix(mix(C.done, C.tile, 0.42), C.muted, 0.42), 'done'],
    [mix(C.run, C.tile, 0.45), 'in progress'],
    [C.faint, 'planned'],
    [C.fail, 'blocked'],
  ]
    .map(
      ([color = C.muted, name = ''], index) => {
        // Five across where there is room, in rows of two in the column.
        const x = keyX + (isColumn ? (index % 2) * 66 : index * 58)
        const y = maxY - (isColumn ? 38 - Math.floor(index / 2) * 11 : 16)
        // A check on the sage swatch: what a verified building stands for.
        const tick =
          name === 'verified'
            ? `<path d="M${n(x + 1.4)} ${n(y + 3.1)}l1.4 1.5 2.4-3" fill="none" stroke="${C.bg}" stroke-width=".9" stroke-linecap="round" stroke-linejoin="round"/>`
            : ''

        return (
          `<rect x="${n(x)}" y="${n(y)}" width="6" height="6" rx="1.5" fill="${color}"/>` +
          tick +
          label(x + 9, y + 5.5, name, { anchor: 'start', size: 7 * type })
        )
      },
    )
    .join('')

  // Where there is room beside City Hall the key is not a list in a corner
  // but a callout on each civic building, with a line to what it speaks of.
  const callout = (
    side: -1 | 1,
    y: number,
    swatch: string,
    text: string,
    to: readonly [number, number],
    share?: number,
    color: string = C.muted,
    ink: string = C.text,
  ): string => {
    const x = side * 70

    return (
      `<line x1="${x - side * 3}" y1="${n(y - 2.5)}" x2="${to[0]}" y2="${to[1]}" stroke="${swatch}" stroke-width=".6" opacity=".6"/>` +
      `<circle cx="${to[0]}" cy="${to[1]}" r="1.2" fill="${swatch}"/>` +
      label(x + side * 7, y, text, { anchor: side < 0 ? 'end' : 'start', size: 7.5, fill: ink, hasPill: true }) +
      `<rect x="${x - 3}" y="${n(y - 5.6)}" width="6" height="6" rx="1.5" fill="${swatch}"/>` +
      (share === undefined ? '' : meter(x + 7, y + 3.6, share, color))
    )
  }
  const callouts =
    callout(
      -1,
      -6,
      HALL_COLOR,
      state === 'your turn' ? 'your turn' : `session ${state}`,
      [-22, 6],
      undefined,
      C.muted,
      sessionInk ?? C.text,
    ) +
    callout(-1, 9, LIBRARY_COLOR, `skills ${skillCount} used`, [-46, 18]) +
    callout(-1, 24, WORKS_COLOR, `background ${running.length} running`, [-15, 38]) +
    callout(1, -9, PLANT_COLOR, `context ${m.usage.contextPercent}%`, [38.5, 2], m.usage.contextPercent / 100, levelColor(m.usage.contextPercent)) +
    callout(
      1,
      9,
      spentColor,
      expected === null ? 'prompt: none yet' : `prompt ${compact(m.turn.tokens)}/${compact(expected.tokens.high)}`,
      [33, -11],
      spent?.share,
      spentColor,
    )

  if (districts.length === 0) {
    labels.push(
      label(0, sy(BLOCK, BLOCK) + 28, isColumn ? 'districts appear with tasks' : 'districts appear with the first tasks', { size: 8 * type }),
    )
  }

  things.sort((a, b) => a.depth - b.depth)
  people.sort((a, b) => a.depth - b.depth)

  const view: View = { minX, minY, maxX, isColumn, moon: isColumn ? [-50, -48, 6.5] : [112, -64, 9] }
  const stats = taskStats(m.tasks)
  if (stats.total > 0 && stats.done === stats.total) overlays.push(fireworks(isColumn, isStill))
  overlays.push(signalMast(m.checks ?? []))

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${n(minX)} ${n(minY)} ${n(boxW)} ${n(boxH)}" width="${width}" height="${Math.round((width * boxH) / boxW)}">` +
    `<rect x="${n(minX)}" y="${n(minY)}" width="${n(boxW)}" height="${n(boxH)}" rx="10" fill="${C.bg}"/>` +
    (hasAmbience ? sky(m, view, progressOf(m.project, m.tasks).percent) + canal(m, view) : '') +
    ground +
    things.map(thing => thing.svg).join('') +
    overlays.join('') +
    people.map(person => person.svg).join('') +
    labels.join('') +
    (isColumn ? key : callouts) +
    legend +
    `</svg>`
  )
}

const LIMIT = 131072

// Tooltips are the one part of the drawing whose length the tasks decide.
const untitled = (svg: string): string => svg.replace(/<title>[^<]*<\/title>/g, '')

// A city too large for the surface's limit is drawn again with less: first
// without the detail on its buildings, then without the night and the street
// life either, and last without its tooltips.
const fitWith = (m: CityInput, layout: CityLayout, aspect: number | undefined, cap: number): { svg: string; shed: Shed } => {
  const full = draw(m, 0, layout, aspect, cap)
  if (full.length <= 120_000) return { svg: full, shed: 0 }
  const plain = draw(m, 1, layout, aspect, cap)
  if (plain.length < LIMIT) return { svg: plain, shed: 1 }
  const bare = draw(m, 2, layout, aspect, cap)

  return bare.length < LIMIT ? { svg: bare, shed: 2 } : { svg: untitled(bare), shed: 3 }
}

// The full city sheds the same way, and where that is not enough each
// district shows fewer archived buildings, the rest joining its old town.
export const fitCity = (
  m: CityInput,
  layout: CityLayout = 'avenue',
  aspect?: number,
): { svg: string; shed: Shed } => {
  let fitted = fitWith(m, layout, aspect, ARCHIVE_CAP)
  if (m.archive === undefined) return fitted
  for (const cap of [12, 6, 0]) {
    if (fitted.svg.length < LIMIT) break
    fitted = fitWith(m, layout, aspect, cap)
  }

  return fitted
}

// `aspect` is the shape of the room the drawing goes into, width over
// height; without it the drawing is cropped to the city alone.
export const renderCity = (m: CityInput, layout: CityLayout = 'avenue', aspect?: number): string =>
  fitCity(m, layout, aspect).svg

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
