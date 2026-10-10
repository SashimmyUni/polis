// Development only: draws the city for a few made-up sessions into one HTML
// page, so its look can be judged in a browser without a live session. The
// sessions live in tools/scenes.ts, shared with tools/manual-images.ts.
//   node --import ./tools/ts-resolve.mjs tools/preview.ts <out.html>
// or bundled:
//   esbuild tools/preview.ts --bundle --platform=node --outfile=<tmp>/preview.cjs
//   node <tmp>/preview.cjs <out.html>
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { cityAlt, renderCity } from '../hooks/city'
import { avatarSvg } from '../hooks/icons'

import { busy, icons, scenes } from './scenes'

const html = `<!doctype html><meta charset="utf-8"><title>Polis preview</title>
<style>body{background:#0e1014;color:#c9cfdb;font:14px system-ui;margin:24px}h2{font-size:14px;color:#7b8496;margin:28px 0 8px}
.row{display:flex;gap:12px;align-items:center}.narrow{width:420px}.narrow svg{width:100%;height:auto}</style>
<h2>Agent icons</h2><div class="row">${icons.map(([type, families]) => avatarSvg(type, families, true)).join('')}</div>
${scenes
  .map(([name, scene]) => {
    const svg = renderCity(scene)

    return `<h2>${name} · ${svg.length} characters · ${cityAlt(scene)}</h2>${svg}`
  })
  .join('\n')}
<h2>A busy project at pane width (420px)</h2><div class="narrow">${renderCity(busy)}</div>`

const out = process.argv[2] ?? 'preview.html'
writeFileSync(out, html)

// One page per scene too, each at the width of a side pane and at full width.
const page = (body: string): string =>
  `<!doctype html><meta charset="utf-8"><body style="background:#0e1014;margin:12px">${body}`
const beside = (name: string): string => join(dirname(out), name)
scenes.forEach(([, scene], index) => {
  const svg = renderCity(scene)
  // The one-block-wide layout, at two widths a narrow dock might have.
  const column = renderCity(scene, 'column').replace(/ width="[0-9]+" height="[0-9]+"/, ' width="100%"')
  writeFileSync(
    beside(`column${index}.html`),
    page(`<div style="display:flex;gap:24px;align-items:flex-start"><div style="width:176px">${column}</div><div style="width:300px">${column}</div></div>`),
  )
  writeFileSync(beside(`scene${index}.html`), page(svg))
  writeFileSync(
    beside(`pane${index}.html`),
    page(`<div style="width:420px">${svg.replace(/ width="[0-9]+" height="[0-9]+"/, ' width="100%"')}</div>`),
  )
})
