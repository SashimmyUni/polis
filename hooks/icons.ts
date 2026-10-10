import type { FamilyCounts, ToolFamily } from '../types'
import { topFamilies } from './logic'
import { C, FAMILY_COLOR, FAMILY_LABEL, lookOf } from './theme'

// Every icon is drawn inline with its own colors: no <use>, no stylesheet,
// so the drawing reads the same as an image and in a sandboxed frame.

export const esc = (text: string): string =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export const n = (value: number): string => String(Math.round(value * 10) / 10)

const channel = (hex: string, at: number): number => parseInt(hex.slice(at, at + 2), 16)

// `a` blended toward `b` by `t` (0 is all `a`).
export const mix = (a: string, b: string, t: number): string => {
  const part = (at: number): string =>
    Math.round(channel(a, at) + (channel(b, at) - channel(a, at)) * t)
      .toString(16)
      .padStart(2, '0')

  return `#${part(1)}${part(3)}${part(5)}`
}

// Tool badges, on a 12 by 12 grid, stroked.
const TOOL_PATH: Record<ToolFamily, string> = {
  search: 'M8 8l2.6 2.6M8.4 5.2a3.2 3.2 0 1 1-6.4 0a3.2 3.2 0 0 1 6.4 0z',
  read: 'M6 3.4v6.8M6 3.4C5 2.6 3.2 2.4 2 2.8v6.6c1.2-.4 3-.2 4 .8M6 3.4c1-.8 2.8-1 4-.6v6.6c-1.2-.4-3-.2-4 .8',
  edit: 'M2.4 9.6l.6-2.4 5.2-5.2 1.8 1.8-5.2 5.2zM7.2 3l1.8 1.8',
  shell: 'M2.4 3.4l3 2.6-3 2.6M6.6 9h3.2',
  web: 'M10 6a4 4 0 1 1-8 0a4 4 0 0 1 8 0zM2 6h8M6 2c-2 2.2-2 5.8 0 8M6 2c2 2.2 2 5.8 0 8',
  mcp: 'M4.5 1.8v2.6M7.5 1.8v2.6M3.4 4.4h5.2v1.8a2.6 2.6 0 0 1-5.2 0zM6 8.8v1.6',
  skill: 'M6 1.6l1.3 3 3.2.3-2.4 2.1.7 3.1L6 8.5 3.2 10.1l.7-3.1L1.5 4.9l3.2-.3z',
  delegate: 'M2.4 4.4h6.8l-2-2M9.6 7.6H2.8l2 2',
  plan: 'M2.4 3.4h1M5 3.4h4.6M2.4 6h1M5 6h4.6M2.4 8.6h1M5 8.6h4.6',
  other: 'M5.2 6a.8.8 0 1 0 1.6 0a.8.8 0 1 0-1.6 0',
}

// The figures are small chibi characters of our own, each agent type dressed
// after a shonen archetype: a straw-hatted captain, headband ninja, a
// blindfolded sorcerer. Drawn around feet at (0, 0), head centered at -13.5.
const SKIN = '#f3d6bd'
const INK = '#2a2d38'
const STRAW = '#e6cd8a'
const SPIKES = 'M-6.8-14.6l-1.6-4.2 3 1.6.6-4.4 2.7 3.1 2.1-4.1 2.1 4.1 2.7-3.1.6 4.4 3-1.6-1.6 4.2z'

const eyes =
  [-2.4, 2.4]
    .map(
      cx =>
        `<ellipse cx="${cx}" cy="-12.8" rx="1" ry="1.5" fill="${INK}"/>` +
        `<circle cx="${cx + 0.3}" cy="-13.4" r=".4" fill="#fff"/>` +
        `<circle cx="${cx * 1.7}" cy="-10.7" r="1" fill="#e79aa6" opacity=".55"/>`,
    )
    .join('') +
  `<path d="M-1.2-10.1q1.2 1 2.4 0" fill="none" stroke="${INK}" stroke-width=".5" stroke-linecap="round"/>`

const headband = (band: string): string =>
  `<rect x="-6.6" y="-17.2" width="13.2" height="2.1" rx=".6" fill="${band}"/>` +
  `<rect x="-2.3" y="-17.1" width="4.6" height="1.9" rx=".4" fill="${C.text}"/>`

const collar = `<path d="M-4.4-5.4v-2.4q4.4 1.8 8.8 0v2.4q-4.4 1.6-8.8 0z" fill="${INK}"/>`

// What goes on and around the head, by the look's icon name.
const HEADS: { [icon: string]: string } = {
  // The captain: a straw hat with a red band over dark hair.
  'a-main':
    eyes +
    `<path d="M-6.4-14.2q6.4-4.6 12.8 0v-2.4h-12.8z" fill="${INK}"/>` +
    `<ellipse cx="0" cy="-17" rx="9.4" ry="2.1" fill="${STRAW}"/>` +
    `<path d="M-5.2-17.2a5.2 4.8 0 0 1 10.4 0z" fill="${STRAW}"/>` +
    `<rect x="-5.2" y="-18.6" width="10.4" height="1.4" fill="${C.fail}"/>`,
  // The scout: a blond ninja with a forehead protector.
  'a-explore': eyes + `<path d="${SPIKES}" fill="#e9c96b"/>` + headband('#3a4254'),
  // The planner: a white-haired sorcerer who works blindfolded.
  'a-plan':
    `<path d="M-1.4-10.1q1.4 1.2 2.8 0" fill="none" stroke="${INK}" stroke-width=".5" stroke-linecap="round"/>` +
    `<path d="${SPIKES}" fill="#eef1f7"/>` +
    `<rect x="-6.6" y="-14.6" width="13.2" height="2.9" rx=".9" fill="${INK}"/>`,
  // The worker: a dark-haired ninja.
  'a-worker': eyes + `<path d="${SPIKES}" fill="#3b3f4d"/>` + headband(C.agent),
  // The verifier: a sorcery student with a fringe.
  'a-verifier':
    eyes +
    `<path d="M-6.7-13.2a6.7 6.7 0 0 1 13.4 0q-1.6-3.2-4.2-2.6-2.6 1.4-5.6-.2-2.2.4-3.6 2.8z" fill="#3b3f4d"/>`,
  // Everyone else: a deckhand in a bandana.
  'a-general':
    eyes +
    `<path d="M-6.7-14.4a6.7 6.7 0 0 1 13.4 0q-6.7-2.4-13.4 0z" fill="${C.fail}"/>` +
    `<path d="M6.2-15.4l3.2-1.2-.6 2.9z" fill="${C.fail}"/>`,
}

// The sorcerers wear a high dark collar.
const COLLARED = new Set(['a-plan', 'a-verifier'])

export const toolIcon = (family: ToolFamily, x: number, y: number, size: number, color: string): string =>
  `<path transform="translate(${n(x)} ${n(y)}) scale(${n(size / 12)})" d="${TOOL_PATH[family]}" ` +
  `fill="none" stroke="${color}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>`

export type AvatarOptions = {
  /** Pulses while the agent is working. */
  isLive: boolean
  /** Drawn faint: an agent that has finished. */
  isFaded?: boolean
  title?: string
}

// One agent, feet at (x, y): a chibi figure in its type's color and
// costume, with the tools it has used most carried above its head.
export const avatar = (
  x: number,
  y: number,
  type: string,
  families: FamilyCounts,
  options: AvatarOptions,
): string => {
  const look = lookOf(type)
  const top = topFamilies(families, 3)
  const head = HEADS[look.icon] ?? HEADS['a-general'] ?? ''
  const badges = top
    .map((family, index) => {
      const bx = (index - (top.length - 1) / 2) * 11.5
      const by = -34 - (top.length === 3 && index === 1 ? 3 : 0)
      const color = FAMILY_COLOR[family]

      return (
        `<line x1="${n(bx * 0.4)}" y1="-23" x2="${n(bx)}" y2="${n(by + 5)}" stroke="${C.faint}" stroke-width=".6"/>` +
        `<circle cx="${n(bx)}" cy="${n(by)}" r="5.2" fill="${C.tile}" stroke="${color}" stroke-width=".9"/>` +
        toolIcon(family, bx - 3.6, by - 3.6, 7.2, color)
      )
    })
    .join('')
  const pulse = options.isLive
    ? `<circle cx="0" cy="-13.5" r="8" fill="none" stroke="${look.color}" stroke-width=".8">` +
      `<animate attributeName="r" values="8;12;8" dur="2.4s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values=".7;0;.7" dur="2.4s" repeatCount="indefinite"/></circle>`
    : ''

  return (
    `<g transform="translate(${n(x)} ${n(y)})"${options.isFaded === true ? ' opacity=".45"' : ''}>` +
    (options.title === undefined ? '' : `<title>${esc(options.title)}</title>`) +
    `<ellipse cx="0" cy="0" rx="6" ry="2.2" fill="#000" opacity=".28"/>` +
    `<path d="M-4.4 0v-5a4.4 4.4 0 0 1 8.8 0V0z" fill="${look.color}"/>` +
    (COLLARED.has(look.icon) ? collar : '') +
    `<circle cx="0" cy="-13.5" r="6.6" fill="${SKIN}"/>` +
    head +
    pulse +
    badges +
    `</g>`
  )
}

// An agent's icon by itself, for a card: the avatar with its badges.
export const avatarSvg = (type: string, families: FamilyCounts, isLive: boolean): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">` +
  `<rect width="48" height="48" rx="8" fill="${C.ground}"/>` +
  avatar(24, 45, type, families, { isLive }) +
  `</svg>`

export const avatarAlt = (type: string, families: FamilyCounts): string => {
  const tools = topFamilies(families, 3).map(family => FAMILY_LABEL[family])

  return `${type} agent${tools.length === 0 ? '' : ` equipped with ${tools.join(', ')}`}`
}
