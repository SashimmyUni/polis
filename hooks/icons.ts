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

// The figures are small chibi characters of our own, each agent type dressed
// after a shonen archetype: a straw-hatted captain, headband ninja, a
// blindfolded sorcerer. Drawn around feet at (0, 0). The heads are drawn for
// a face centered at -13.5 and set on the shoulders by `HEAD_LIFT`.
const SKIN = '#f3d6bd'
const INK = '#2a2d38'
const STRAW = '#e6cd8a'
const WHITE = '#eef1f7'
const WOOD = '#a98862'
const LEATHER = '#6f5a3e'
const PAPER = '#ece6d6'
const STEEL = '#aeb6c4'
const DENIM = '#50648a'
const SPIKES = 'M-6.8-14.6l-1.6-4.2 3 1.6.6-4.4 2.7 3.1 2.1-4.1 2.1 4.1 2.7-3.1.6 4.4 3-1.6-1.6 4.2z'
const HEAD_LIFT = -3

const eyes =
  [-2.4, 2.4]
    .map(
      cx =>
        `<ellipse cx="${cx}" cy="-12.8" rx="1" ry="1.5" fill="${INK}"/>` +
        `<circle cx="${n(cx + 0.3)}" cy="-13.4" r=".4" fill="#fff"/>` +
        `<circle cx="${n(cx * 1.7)}" cy="-10.7" r="1" fill="#e79aa6" opacity=".55"/>`,
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
    `<path d="${SPIKES}" fill="${WHITE}"/>` +
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

// A long coat's tails, over the legs.
const tails = (color: string): string =>
  `<path d="M-4.4-3.4l-.8 2.6h2.4l.2-2.6zM4.4-3.4l.8 2.6h-2.4l-.2-2.6z" fill="${mix(color, C.bg, 0.3)}"/>`

// What each job wears, drawn over a torso in its type's color: the clothes
// say what the agent is for, as the color says which type it is.
const OUTFITS: { [icon: string]: (color: string) => string } = {
  // The captain: an open coat with epaulettes and gold buttons, a red sash.
  'a-main': color =>
    `<path d="M-1.9-10.6l1.9 4.6 1.9-4.6z" fill="${WHITE}"/>` +
    `<rect x="-4.5" y="-5.2" width="9" height="1.4" fill="${C.fail}"/>` +
    `<path d="M-5.5-10.1h2.6v1.1h-2.6zM2.9-10.1h2.6v1.1h-2.6z" fill="${STRAW}"/>` +
    tails(color) +
    `<circle cx="2.7" cy="-7.5" r=".5" fill="${STRAW}"/><circle cx="2.7" cy="-6.2" r=".5" fill="${STRAW}"/>`,
  // The scout travels light: a zipped jacket, a scarf, a pouch on the belt.
  'a-explore': color =>
    `<path d="M0-9v5.6" stroke="${mix(color, C.bg, 0.4)}" stroke-width=".5"/>` +
    `<rect x="-4.5" y="-4.9" width="9" height="1.1" fill="${LEATHER}"/>` +
    `<rect x="1.5" y="-5.5" width="2.3" height="2.2" rx=".4" fill="${WOOD}"/>` +
    `<path d="M-4.4-10.4q4.4 2.2 8.8 0l.2 1.6q-4.6 2.2-9.2 0z" fill="${WHITE}"/>` +
    `<path d="M-1-8.7l-1.5 2.9h1.7l.8-1.5.8 1.5h1.7L1-8.7z" fill="${mix(WHITE, C.bg, 0.14)}"/>`,
  // The architect: a long coat, with pens in its breast pocket.
  'a-plan': color =>
    `<path d="M0-8.4v5.2" stroke="${INK}" stroke-width=".5" opacity=".6"/>` +
    tails(color) +
    `<rect x="1.3" y="-6.8" width="2.6" height="2" rx=".3" fill="${mix(color, C.bg, 0.3)}"/>` +
    `<path d="M1.9-6.8v-1.2" stroke="${C.run}" stroke-width=".6" stroke-linecap="round"/>` +
    `<path d="M3.1-6.8v-1.2" stroke="${C.proc}" stroke-width=".6" stroke-linecap="round"/>`,
  // The builder: denim overalls over the shirt, and a tool belt.
  'a-worker': () =>
    `<path d="M-2.2-8.4L-3.3-10.3M2.2-8.4L3.3-10.3" stroke="${DENIM}" stroke-width="1.2"/>` +
    `<rect x="-2.8" y="-8.4" width="5.6" height="5.2" fill="${DENIM}"/>` +
    `<rect x="-1.3" y="-7.4" width="2.6" height="1.7" rx=".3" fill="none" stroke="${mix(DENIM, WHITE, 0.45)}" stroke-width=".4"/>` +
    `<circle cx="-2.2" cy="-8" r=".4" fill="${STRAW}"/><circle cx="2.2" cy="-8" r=".4" fill="${STRAW}"/>` +
    `<rect x="-4.5" y="-4.6" width="9" height="1.1" fill="${LEATHER}"/>` +
    `<rect x="-4.3" y="-4.9" width="2" height="2.3" rx=".3" fill="${WOOD}"/>`,
  // The inspector: a buttoned uniform and a pass on a lanyard, with a check.
  'a-verifier': color =>
    `<path d="M-1.7-8.2L0-6.4 1.7-8.2" fill="none" stroke="${WHITE}" stroke-width=".4"/>` +
    `<rect x="-1.4" y="-6.7" width="2.8" height="2.6" rx=".4" fill="${WHITE}"/>` +
    `<path d="M-.8-5.4l.6.7 1.1-1.5" fill="none" stroke="${mix(color, INK, 0.55)}" stroke-width=".55" stroke-linecap="round" stroke-linejoin="round"/>` +
    `<circle cx="3.1" cy="-6.6" r=".6" fill="${STRAW}"/>`,
  // The deckhand: a striped shirt and a red neckerchief.
  'a-general': () =>
    `<path d="M-4.8-8.3h9.6M-4.6-6.7h9.2M-4.4-5.1h8.8" stroke="${WHITE}" stroke-width=".8" opacity=".85"/>` +
    `<path d="M-1.7-10.4L0-8.2 1.7-10.4z" fill="${C.fail}"/>`,
}

type Held = {
  /** What it is called in a tooltip. */
  name: string
  /** Carried at the side, hanging from the hand, where the rest are held up. */
  isCarried?: boolean
  /** Drawn around the grip at (0, 0), for the figure's right hand. */
  draw: (color: string) => string
}

// What a figure holds for each family of tools it uses: the tool of that
// trade, in the family's color. Unknown tools are nothing to hold.
const HELD: Partial<Record<ToolFamily, Held>> = {
  search: {
    name: 'a lens',
    draw: color =>
      `<line x1="0" y1=".4" x2="1.9" y2="-2.3" stroke="${WOOD}" stroke-width="1.2" stroke-linecap="round"/>` +
      `<circle cx="3.5" cy="-4.5" r="2.7" fill="${color}" fill-opacity=".28" stroke="${color}" stroke-width="1"/>` +
      `<path d="M2.2-5.4a1.9 1.9 0 0 1 1.6-1.1" fill="none" stroke="#fff" stroke-width=".5" stroke-linecap="round" opacity=".8"/>`,
  },
  read: {
    name: 'a book',
    draw: color =>
      `<path d="M-2.6-4.6q1.9-.9 3.6.1 1.7-1 3.6-.1v4.3q-1.9-.9-3.6.1-1.7-1-3.6-.1z" fill="${PAPER}" stroke="${color}" stroke-width=".7" stroke-linejoin="round"/>` +
      `<path d="M1-4.5v4.4" stroke="${color}" stroke-width=".5"/>`,
  },
  edit: {
    name: 'a hammer',
    draw: color =>
      `<line x1="-.4" y1="1" x2="2.2" y2="-4.6" stroke="${WOOD}" stroke-width="1.2" stroke-linecap="round"/>` +
      `<path d="M.4-6.5L4.8-4.5 4-2.7-.4-4.7z" fill="${color}"/>`,
  },
  shell: {
    name: 'a toolbox',
    isCarried: true,
    draw: color =>
      `<path d="M-1.7 1.3q1.7-2.8 3.4 0" fill="none" stroke="${STEEL}" stroke-width=".8"/>` +
      `<rect x="-3.2" y="1.2" width="6.4" height="3.6" rx=".6" fill="${color}"/>` +
      `<path d="M-3.2 2.5h6.4" stroke="${mix(color, INK, 0.45)}" stroke-width=".5"/>` +
      `<rect x="-.7" y="2" width="1.4" height="1" rx=".2" fill="${STEEL}"/>`,
  },
  web: {
    name: 'a globe',
    draw: color =>
      `<circle cx="2.6" cy="-3.4" r="3" fill="${color}" fill-opacity=".25" stroke="${color}" stroke-width=".9"/>` +
      `<path d="M-.4-3.4h6M2.6-6.4q-2 3 0 6M2.6-6.4q2 3 0 6" fill="none" stroke="${color}" stroke-width=".6"/>`,
  },
  mcp: {
    name: 'a plug',
    draw: color =>
      `<path d="M0 .6q2.6 2.4 4.4.4" fill="none" stroke="${mix(color, INK, 0.3)}" stroke-width=".8" stroke-linecap="round"/>` +
      `<rect x="-.2" y="-4.2" width="3.6" height="3.6" rx=".8" fill="${color}"/>` +
      `<path d="M.8-4.2v-1.8M2.4-4.2v-1.8" stroke="${STEEL}" stroke-width=".8" stroke-linecap="round"/>`,
  },
  skill: {
    name: 'a scroll',
    draw: color =>
      `<rect x="-1" y="-5.6" width="5.6" height="4.6" fill="${PAPER}"/>` +
      `<rect x="-1.6" y="-6.4" width="6.8" height="1.5" rx=".75" fill="${color}"/>` +
      `<rect x="-1.6" y="-1.6" width="6.8" height="1.5" rx=".75" fill="${color}"/>` +
      `<path d="M.3-3.9h3M.3-2.9h2" stroke="${color}" stroke-width=".45"/>`,
  },
  delegate: {
    name: 'a megaphone',
    draw: color =>
      `<path d="M1-1.4v1.6" stroke="${STEEL}" stroke-width=".8" stroke-linecap="round"/>` +
      `<path d="M.2-2.6l1.6-.3 3.6-2.5v6.6l-3.6-2.5-1.6-.3z" fill="${color}"/>` +
      `<path d="M6.3-3.6q1 1.5 0 3" fill="none" stroke="${color}" stroke-width=".6" stroke-linecap="round"/>`,
  },
  plan: {
    name: 'pen and paper',
    draw: color =>
      `<rect x="-1.4" y="-6" width="5.6" height="6.6" rx=".6" fill="${WOOD}"/>` +
      `<rect x="-.7" y="-5.2" width="4.2" height="5.2" fill="${PAPER}"/>` +
      `<rect x=".3" y="-6.5" width="2.2" height="1.1" rx=".4" fill="${STEEL}"/>` +
      `<path d="M0-4h2.8M0-2.9h2.8M0-1.8h1.8" stroke="${color}" stroke-width=".45"/>` +
      `<path d="M4.7-3.4l1.3-3.2" stroke="${C.run}" stroke-width=".8" stroke-linecap="round"/>`,
  },
}

// The two families an agent has used most that there is something to hold
// for: the first goes in its right hand, the second in its left.
export const heldOf = (families: FamilyCounts): ToolFamily[] =>
  topFamilies(families, 4)
    .filter(family => HELD[family] !== undefined)
    .slice(0, 2)

const heldNames = (families: FamilyCounts): string =>
  heldOf(families)
    .map(family => `${HELD[family]?.name ?? ''} (${FAMILY_LABEL[family]})`)
    .join(' and ')

export type AvatarOptions = {
  /** Bobs, works its tool and pulses while the agent is working. */
  isLive: boolean
  /** Drawn without its clothes' detail and without motion, for a drawing short of room. */
  isPlain?: boolean
  /** Drawn faint: an agent that has finished. */
  isFaded?: boolean
  /** Drawn without any motion at all, for a surface or a person that wants none. */
  isStill?: boolean
  title?: string
  /** Ends the tooltip, after what the figure holds. */
  note?: string
}

// One agent, feet at (x, y): a chibi figure in its type's color, dressed
// for its job, holding the tools of the two trades it has plied most.
export const avatar = (
  x: number,
  y: number,
  type: string,
  families: FamilyCounts,
  options: AvatarOptions,
): string => {
  const look = lookOf(type)
  const head = HEADS[look.icon] ?? HEADS['a-general'] ?? ''
  const outfit = OUTFITS[look.icon] ?? OUTFITS['a-general']
  const sleeve = mix(look.color, C.bg, 0.2)
  const legs = look.icon === 'a-worker' ? DENIM : mix(INK, look.color, 0.25)
  const [right, left] = heldOf(families)
  const holding = heldNames(families)
  const isMoving = options.isLive && options.isPlain !== true && options.isStill !== true

  // An arm from the shoulder to a hand: held up with what it holds, or down
  // at the side when it is empty or carries something. `side` -1 mirrors it
  // into the figure's left arm. A working figure works its right-hand tool.
  const arm = (side: 1 | -1, family: ToolFamily | undefined): string => {
    const item = family === undefined ? undefined : HELD[family]
    const isUp = item !== undefined && item.isCarried !== true
    const hx = isUp ? 7.2 : 6.1
    const hy = isUp ? -6.2 : -4.4
    const work =
      isMoving && side === 1
        ? `<animateTransform attributeName="transform" type="rotate" values="-8;8;-8" dur="1.3s" repeatCount="indefinite"/>`
        : ''

    return (
      `<g${side < 0 ? ' transform="scale(-1 1)"' : ''}>` +
      `<line x1="4.6" y1="-8.8" x2="${hx}" y2="${hy}" stroke="${sleeve}" stroke-width="2.1" stroke-linecap="round"/>` +
      (item === undefined || family === undefined
        ? ''
        : `<g transform="translate(${hx} ${hy})"><g>${work}${item.draw(FAMILY_COLOR[family])}</g></g>`) +
      `<circle cx="${hx}" cy="${hy}" r="1.2" fill="${SKIN}"/>` +
      `</g>`
    )
  }

  const pulse = isMoving
    ? `<circle cx="0" cy="${-13.5 + HEAD_LIFT}" r="8" fill="none" stroke="${look.color}" stroke-width=".8">` +
      `<animate attributeName="r" values="8;12;8" dur="2.4s" repeatCount="indefinite"/>` +
      `<animate attributeName="opacity" values=".7;0;.7" dur="2.4s" repeatCount="indefinite"/></circle>`
    : ''
  const title =
    options.title === undefined
      ? ''
      : `<title>${esc(options.title + (holding === '' ? '' : ` · holding ${holding}`) + (options.note === undefined ? '' : ` · ${options.note}`))}</title>`

  return (
    `<g transform="translate(${n(x)} ${n(y)})"${options.isFaded === true ? ' opacity=".45"' : ''}>` +
    title +
    `<ellipse cx="0" cy="0" rx="6.5" ry="2.2" fill="#000" opacity=".28"/>` +
    // A working figure bobs on its feet, each type at its own pace.
    `<g>` +
    (isMoving
      ? `<animateTransform attributeName="transform" type="translate" values="0 0;0 -1.4;0 0" dur="${n(1 + (type.length % 5) * 0.14)}s" repeatCount="indefinite"/>`
      : '') +
    `<path d="M-3.7-3.4h3.2v2.6h-3.2zM.5-3.4h3.2v2.6h-3.2z" fill="${legs}"/>` +
    `<path d="M-4.1-1h3.8v1h-3.8zM.3-1h3.8v1h-3.8z" fill="${INK}"/>` +
    `<path d="M-5-9.6q5-2.4 10 0l-.7 6.4h-8.6z" fill="${look.color}"/>` +
    `<rect x="-2.6" y="-11.4" width="5.2" height="1.8" fill="${SKIN}"/>` +
    (outfit === undefined || options.isPlain === true ? '' : outfit(look.color)) +
    `<g transform="translate(0 ${HEAD_LIFT})">` +
    (COLLARED.has(look.icon) ? collar : '') +
    `<circle cx="0" cy="-13.5" r="6.6" fill="${SKIN}"/>` +
    head +
    `</g>` +
    arm(-1, left) +
    arm(1, right) +
    `</g>` +
    pulse +
    `</g>`
  )
}

// An agent's icon by itself, for a card: the figure, as large as the card.
export const avatarSvg = (type: string, families: FamilyCounts, isLive: boolean, isStill = false): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48">` +
  `<rect width="48" height="48" rx="8" fill="${C.ground}"/>` +
  `<g transform="translate(24 45) scale(1.6)">${avatar(0, 0, type, families, { isLive, isStill })}</g>` +
  `</svg>`

export const avatarAlt = (type: string, families: FamilyCounts): string => {
  const holding = heldNames(families)

  return `${type} agent${holding === '' ? '' : ` holding ${holding}`}`
}
