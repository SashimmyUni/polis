import { cityAlt, renderCity } from './city'
import type { CityInput } from './city'
import { esc } from './icons'
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
  `p{margin:0;color:${C.muted}}` +
  `svg{display:block;width:100%;height:auto}`

// The drawing comes at a fixed size: here it takes the window's width, and
// its height follows from its viewBox.
const fluid = (svg: string): string => svg.replace(/ width="[0-9]+" height="[0-9]+"/, ' width="100%"')

// One whole document. The same input always gives the same text (the drawing's moving parts are set to a fixed clock,
// nothing random), so the caller can skip a write that would change nothing.
export const cityPage = (m: CityInput, name: string): string =>
  `<!doctype html>\n` +
  `<html lang="en">\n` +
  `<head>\n` +
  `<meta charset="utf-8">\n` +
  `<meta name="viewport" content="width=device-width, initial-scale=1">\n` +
  `<meta name="color-scheme" content="dark">\n` +
  `<meta http-equiv="refresh" content="${PAGE_REFRESH_SECONDS}">\n` +
  `<title>Polis · ${esc(name)}</title>\n` +
  `<style>${STYLE}</style>\n` +
  `</head>\n` +
  `<body>\n` +
  `<header><h1>${esc(name)}</h1><p>${esc(cityAlt(m))}</p></header>\n` +
  `<main>${fluid(renderCity({ ...m, now: 0 }, 'avenue'))}</main>\n` +
  `</body>\n` +
  `</html>\n`
