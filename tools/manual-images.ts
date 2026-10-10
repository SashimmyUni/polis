// Development only: draws the pictures of the user manual into docs/images/.
// Each is the mod's own renderer run on a made-up session from
// tools/scenes.ts, so the pictures match the product. Run from the repository
// root with Node alone (no node_modules):
//   node --import ./tools/ts-resolve.mjs tools/manual-images.ts
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { renderCity } from '../hooks/city'
import { avatar, avatarAlt, esc, n } from '../hooks/icons'
import { C } from '../hooks/theme'

import { base, busy, full, icons, small, states } from './scenes'

// The same type the city sets its words in.
const FONT = `font-family="system-ui, -apple-system, 'Segoe UI', sans-serif"`

// Six agents side by side on the palette's background, each with the name of
// its type under it. The figures are the very ones the city stands on its
// roofs, drawn larger.
const agentIcons = (): string => {
  const cell = 112
  const pad = 16
  const feet = 122
  const zoom = 2.6
  const width = pad * 2 + cell * icons.length
  const height = 164
  const figures = icons
    .map(([type, families], index) => {
      const x = pad + cell * index + cell / 2

      return (
        `<rect x="${n(x - cell / 2 + 4)}" y="${n(pad - 4)}" width="${n(cell - 8)}" height="${n(height - pad * 2 + 8)}" rx="8" fill="${C.ground}"/>` +
        `<g transform="translate(${n(x)} ${n(feet)}) scale(${zoom})">` +
        avatar(0, 0, type, families, { isLive: true, title: avatarAlt(type, families) }) +
        `</g>` +
        `<text x="${n(x)}" y="${n(feet + 22)}" ${FONT} font-size="12" fill="${C.muted}" text-anchor="middle">${esc(type)}</text>`
      )
    })
    .join('')

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">` +
    `<title>Agent icons</title>` +
    `<rect width="${width}" height="${height}" rx="10" fill="${C.bg}"/>` +
    figures +
    `</svg>`
  )
}

// What would make a picture wrong: not a whole SVG, a number that failed to
// compute, an attribute written twice on one element, or tags that do not nest.
const problems = (svg: string): string[] => {
  const found: string[] = []
  if (!svg.startsWith('<svg')) found.push('does not begin with <svg')
  if (!svg.endsWith('</svg>')) found.push('does not end with </svg>')
  for (const word of ['NaN', 'undefined', 'Infinity']) if (svg.includes(word)) found.push(`contains ${word}`)
  const open: string[] = []
  for (const [, closing, name = '', rest = '', selfClosing] of svg.matchAll(/<(\/?)([A-Za-z][\w:-]*)([^<>]*?)(\/?)>/g)) {
    if (closing === '/') {
      if (open.pop() !== name) found.push(`</${name}> closes a different element`)
      continue
    }
    const names = [...rest.replace(/"[^"]*"/g, '""').matchAll(/\s([\w:-]+)=/g)].map(match => match[1])
    const twice = names.find((one, index) => names.indexOf(one) !== index)
    if (twice !== undefined) found.push(`<${name}> repeats ${twice}`)
    if (selfClosing !== '/') open.push(name)
  }
  if (open.length > 0) found.push(`never closed: ${open.join(', ')}`)

  return found
}

const pictures: [string, string][] = [
  ['city-new.svg', renderCity(base)],
  ['building-states.svg', renderCity(states)],
  ['city-one-district.svg', renderCity(small)],
  ['city-busy.svg', renderCity(busy)],
  ['city-full.svg', renderCity(full)],
  ['city-narrow.svg', renderCity(busy, 'column')],
  ['agent-icons.svg', agentIcons()],
]

const dir = fileURLToPath(new URL('../docs/images/', import.meta.url))
mkdirSync(dir, { recursive: true })
let failed = false
for (const [name, svg] of pictures) {
  const wrong = problems(svg)
  if (wrong.length > 0) failed = true
  writeFileSync(join(dir, name), svg)
  console.log(`${name}: ${svg.length} characters${wrong.length === 0 ? '' : ` — ${wrong.join('; ')}`}`)
}
if (failed) process.exitCode = 1
