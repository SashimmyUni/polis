import { cityAlt, renderCity } from './city'
import type { CityInput } from './city'
import { esc } from './icons'
import { compact, isBlocking, sessionState, taskStats, topWait, waitMark, zoneMark, zoneOf } from './logic'
import { C } from './theme'

// The city as a page on disk, for a browser or an editor's preview tab left
// open beside the session. Nothing serves it: the page asks to be loaded
// again every few seconds and so picks up whatever was last written.
export const PAGE_REFRESH_SECONDS = 3

// The widest the drawing grows, so a very large window does not blow it up.
const MAX_WIDTH = 1100

// `html` carries the background too, so a reload never flashes white.
const STYLE =
  `html,body{background:${C.bg}}` +
  `body{margin:0;padding:12px 16px 20px;color:${C.text};font:13px/1.4 system-ui,-apple-system,'Segoe UI',sans-serif}` +
  `header,main{max-width:${MAX_WIDTH}px;margin:0 auto}` +
  `header{display:flex;flex-wrap:wrap;gap:2px 12px;align-items:baseline;padding:0 4px 8px}` +
  `h1{margin:0;font-size:14px;font-weight:600}` +
  `header span{color:${C.muted};white-space:nowrap}` +
  `header .needs,header .out{color:${C.fail};font-weight:600}` +
  `header .caution{color:${C.run}}` +
  `header a{color:${C.agent}}` +
  `p{margin:0;color:${C.muted};flex-basis:100%}` +
  `svg{display:block;width:100%;height:auto}`

// The drawing comes at a fixed size: here it takes the window's width, and
// its height follows from its viewBox.
const fluid = (svg: string): string => svg.replace(/ width="[0-9]+" height="[0-9]+"/, ' width="100%"')

// The facts a glance at the tab should give: what needs the person (or what
// the session is doing), where the context stands against the smart zone,
// and how many tasks are done.
const facts = (m: CityInput): string => {
  const top = topWait(m.waits ?? [])
  const spans: string[] = []
  if (top !== undefined && isBlocking(top)) {
    spans.push(`<span class="needs">${esc(waitMark(top))}</span>`)
  } else {
    spans.push(`<span>${sessionState(m.turn.isWorking, m.waits ?? [])}</span>`)
  }
  const tokens = m.usage.contextTokens
  if (tokens > 0) {
    const level = zoneOf(tokens, m.usage.zoneLimit)
    const text = zoneMark(level, tokens) ?? `ctx ${compact(tokens)}`
    spans.push(level === 'inside' ? `<span>${esc(text)}</span>` : `<span class="${level}">${esc(text)}</span>`)
  }
  const stats = taskStats(m.tasks)
  if (stats.total > 0) spans.push(`<span>${stats.done}/${stats.total} tasks done</span>`)

  return spans.join('')
}

// The two pages on disk: the current city, and the full one with the archive.
export const PAGE_FILES = { current: 'city.html', full: 'city-full.html' } as const

// The way to the other page, at the end of the header.
const other = (isFull: boolean): string =>
  isFull ? `<a href="${PAGE_FILES.current}">current city</a>` : `<a href="${PAGE_FILES.full}">full city</a>`

// One whole document. The same input always gives the same text (the drawing's moving parts are set to a fixed clock,
// nothing random), so the caller can skip a write that would change nothing. An
// input with an archive is the full city's page.
export const cityPage = (m: CityInput, name: string): string =>
  `<!doctype html>\n` +
  `<html lang="en">\n` +
  `<head>\n` +
  `<meta charset="utf-8">\n` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
  `<meta name="color-scheme" content="dark">\n` +
  `<meta http-equiv="refresh" content="${PAGE_REFRESH_SECONDS}">\n` +
  `<title>Polis · ${esc(name)}${m.archive === undefined ? '' : ' · full city'}</title>\n` +
  `<style>${STYLE}</style>\n` +
  `</head>\n` +
  `<body>\n` +
  `<header><h1>${esc(name)}</h1>${facts(m)}<span>${other(m.archive !== undefined)}</span><p>${esc(cityAlt(m))}</p></header>\n` +
  `<main>${fluid(renderCity({ ...m, now: 0 }, 'avenue'))}</main>\n` +
  `</body>\n` +
  `</html>\n`
