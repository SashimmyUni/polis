// PROTOTYPE, throwaway: answers "One meaning per color and glyph, and where the
// legend lives" (https://github.com/SashimmyUni/polis/issues/19). Not part of
// the mod; lives on a throwaway branch only.
//   node --import ./tools/ts-resolve.mjs tools/prototype-one-meaning.ts <out.html>
// Draws the busy scene's band, status line, four views and city twice: as the
// code colours them today (Before) and under one meaning per colour and glyph
// (After), with three places for the legend (?variant=A|B|C).
import { writeFileSync } from 'node:fs'

import { renderCity } from '../hooks/city'
import { C } from '../hooks/theme'

import { busy } from './scenes'

const cityBefore = renderCity(busy)
// After, approximately: in progress turns blue (working now), the library and
// works yard lose their identity hues. The plant's fill still follows the old
// percent scale here; the real build follows the smart-zone scale.
const palette = C as { -readonly [key in keyof typeof C]: string }
palette.run = '#8ea6e0'
palette.skill = '#6b7385'
palette.proc = '#6b7385'
// A second copy of the module, so its constants are computed from the new palette.
const fresh: string = '../hooks/city.ts?after'
const { renderCity: renderAfter } = (await import(fresh)) as typeof import('../hooks/city')
const cityAfter = renderAfter(busy)

const page = `<title>One Meaning Per Mark</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
/* Layout: one column of terminal frames, a proposal table on top, a fixed switcher pill at the bottom. */
:root{
  color-scheme:dark;
  --bg:#0e1014;--frame:#14161c;--edge:#2b3140;
  --text:#c9cfdb;--muted:#7b8496;--faint:#4a5263;
  --rose:#d98c9a;--amber:#e0c38c;--blue:#8ea6e0;--sage:#8fbf9f;--teal:#7fc8c2;--violet:#b39ddb;
  --pill:#f2f4f8;--pill-ink:#14161c;
  --mono:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace;
  --sans:"IBM Plex Sans",system-ui,sans-serif;
}
body{background:var(--bg);color:var(--text);font:14px/1.5 var(--sans);padding-left:max(16px,env(safe-area-inset-left,0px));padding-right:max(16px,env(safe-area-inset-right,0px));padding-block:20px 96px}
main{max-width:980px;margin:0 auto;display:grid;gap:28px}
h1{font-size:20px;margin:0;text-wrap:balance}
h2{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:0 0 8px}
p{margin:0;max-width:68ch;color:var(--muted)}
.intro{display:grid;gap:8px}
.scroll{overflow-x:auto}
table{border-collapse:collapse;font-size:13px;min-width:560px}
th,td{text-align:left;padding:5px 10px;border-bottom:1px solid var(--edge);vertical-align:top}
th{color:var(--muted);font-weight:500}
.term{background:var(--frame);border:1px solid var(--edge);border-radius:6px;font:13px/1.55 var(--mono);padding:10px 12px;overflow-x:auto;white-space:pre}
.tabs{display:flex;gap:14px;margin-bottom:8px;font:13px var(--mono)}
.tabs span{color:var(--muted)}.tabs .on{color:var(--text);text-decoration:underline}
.btn{display:inline-block;border:1px solid var(--edge);border-radius:4px;padding:0 6px;color:var(--text)}
.btn.primary{background:var(--blue);color:var(--pill-ink);border-color:var(--blue)}
.city svg{width:100%;height:auto;display:block;border-radius:6px}
.r{color:var(--rose)}.a{color:var(--amber)}.b{color:var(--blue)}.g{color:var(--sage)}.m{color:var(--muted)}.f{color:var(--faint)}.t{color:var(--text)}.c{color:var(--teal)}.v{color:var(--violet)}
.h{font-weight:700}
.sw{display:inline-block;width:10px;height:10px;border-radius:2px;vertical-align:-1px;margin-right:6px}
/* The legend variants, set on <body>. */
.word,.key,.keybtn,.keypanel{display:none}
.vA .word{display:inline}
.vB .key{display:block}
.vC .keybtn{display:inline-block}
.vC.open .keypanel{display:block}
.before .only-after,.after .only-before{display:none}
.switch{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(14px + env(safe-area-inset-bottom,0px));display:flex;gap:6px;align-items:center;background:var(--pill);color:var(--pill-ink);border-radius:999px;padding:6px 8px;box-shadow:0 6px 24px #0008;font:13px var(--sans);z-index:5;max-width:calc(100% - 32px);flex-wrap:wrap;justify-content:center}
.switch button{font:inherit;border:0;background:transparent;color:inherit;padding:4px 10px;border-radius:999px;cursor:pointer}
.switch button[aria-pressed="true"]{background:var(--pill-ink);color:var(--pill)}
.switch button:focus-visible{outline:2px solid var(--blue)}
.switch .sep{width:1px;height:18px;background:#0003}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
<main>
<section class="intro">
<h1>One meaning per colour and glyph</h1>
<p>Prototype for “One meaning per color and glyph, and where the legend lives”. The busy scene drawn on every surviving surface. Flip <b>Before / After</b> to compare today’s marks with the proposal, and <b>A / B / C</b> to try three places for the legend. Arrow keys cycle the legend variant.</p>
</section>

<section>
<h2>The proposal: colour says state, never kind</h2>
<div class="scroll"><table>
<tr><th>Colour</th><th>One meaning</th><th>Carries</th><th>Leaves it (today’s extra meanings)</th></tr>
<tr><td><span class="sw" style="background:var(--rose)"></span>rose</td><td><b>act now</b></td><td>needs you · failed (check, agent, refuted task) · blocked · out of the smart zone · a limit warning firing</td><td>prompt over its range (→ amber)</td></tr>
<tr><td><span class="sw" style="background:var(--amber)"></span>amber</td><td><b>getting close</b></td><td>smart-zone caution · a limit past 70% · stale check · prompt growth past expected</td><td>in progress, running, worker agent, edit family, suggested skill, your turn, plant body</td></tr>
<tr><td><span class="sw" style="background:var(--blue)"></span>blue</td><td><b>working now</b></td><td>task in progress · agent or process running · main session working</td><td>headings, project name, main/general agent, read and delegate families, owner</td></tr>
<tr><td><span class="sw" style="background:var(--sage)"></span>sage</td><td><b>verified</b></td><td>verified task · check passed</td><td>done-unchecked, context low, prompt under range, verifier agent, shell family</td></tr>
<tr><td><span class="sw" style="background:var(--text)"></span>greys</td><td>everything else</td><td>done (unchecked) in text · planned and idle in muted · headings in bold text</td><td></td></tr>
<tr><td><span class="sw" style="background:var(--teal)"></span>teal <span class="sw" style="background:var(--violet);margin-left:4px"></span>violet</td><td><b>retired</b></td><td>kind (agent type, tool family) goes by glyph, not colour</td><td>processes, Explore, Plan, search/web/connectors/skills families</td></tr>
</table></div>
</section>

<section>
<h2>Glyphs: one each</h2>
<div class="scroll"><table>
<tr><th>Glyph</th><th>Means</th><th>Today it also means</th></tr>
<tr><td class="r">▲</td><td>needs you</td><td>(already single)</td></tr>
<tr><td class="f">○</td><td>planned</td><td>other session (Project view, gone)</td></tr>
<tr><td class="b">▶</td><td>in progress</td><td>▓ in the text city, scaffolding in the drawing (drawing keeps scaffolding)</td></tr>
<tr><td>✔</td><td>done (unchecked)</td><td>agent finished, check passed</td></tr>
<tr><td class="g">✔✔</td><td>verified</td><td></td></tr>
<tr><td class="r">✘</td><td>failed: a check, an agent, a task its check refuted</td><td>crossed-out building in the text city</td></tr>
<tr><td class="r">⊘</td><td>blocked (new; today a blocked task shows ○ and “waits on”)</td><td></td></tr>
<tr><td class="b">●</td><td>live: running agent or process</td><td>general-purpose agent glyph (→ ◇)</td></tr>
<tr><td class="a">◷</td><td>stale check (new)</td><td>◌ was stale check and agent starting; ◌ retired</td></tr>
<tr><td>◆</td><td>main session</td><td>project name, status-line prefix, pane title (all gone)</td></tr>
<tr><td>⚒ ◎ ▧ ⚖ ◇</td><td>agent kinds: worker, Explore, Plan, verifier, general</td><td>✓ verifier looked like ✔ (→ ⚖); ● general (→ ◇); the non-blocking-wait ◇ becomes plain text</td></tr>
<tr><td class="m">⌕ ▤ ✎ ❯ ◍ ⧉ ✦ ⇄ ☰</td><td>tool families, in muted, only on Agents</td><td>✦ library in the text city, ✧ suggested skill (both gone with Skills)</td></tr>
<tr><td class="m">retired</td><td colspan="2">⚡ (prompt on the band, power in the text city) · ✧ · ◌ · ✓ · ▓ ░</td></tr>
</table></div>
</section>

<section>
<h2>Band</h2>
<div class="term"><span class="r h">▲ needs you: permission for Bash</span>  <span class="t">next: /code-review</span>  <span class="a">ctx 142k</span>  <span class="m">8/18 tasks</span>  <span class="btn primary">City</span> <span class="btn">Hide</span></div>
<p style="margin-top:6px">The band is the same Before and After: the strip work already left it with rose, amber and greys. No legend fits on one line; every element is a word.</p>
</section>

<section>
<h2>Status line</h2>
<div class="term"><span class="r">▲ needs you: permission for Bash</span> <span class="m">·</span> <span class="t">next: /code-review</span> <span class="m">·</span> <span class="a">ctx 142k</span> <span class="m">·</span> <span class="m">8/18 tasks</span></div>
</section>

<section id="pane"></section>

<section>
<h2>City drawing (real render, busy scene)</h2>
<div class="city only-before">${cityBefore}</div>
<div class="city only-after">${cityAfter}</div>
<p style="margin-top:6px" class="only-after">Approximate: in-progress buildings and the working flag in blue; library and works yard in grey. The power plant still uses the old percent colours here; the decided smart-zone scale applies in the real build. Agent avatars keep their type colours in this render: an open question below.</p>
</section>

<section>
<h2>Open questions to react to</h2>
<p>1. Agent avatars in the drawing: keep their type hues (art) or take the state colour?<br>
2. Is <span class="r">⊘</span> right for blocked, or should blocked stay ○ in rose?<br>
3. Prompt growth past expected: amber (proposed) or rose as today?<br>
4. Which legend variant, and does the drawing keep its own key in every variant?</p>
</section>
</main>

<div class="switch" role="toolbar" aria-label="Prototype switcher">
<button id="pBefore" type="button">Before</button><button id="pAfter" type="button">After</button>
<span class="sep"></span>
<button id="prev" type="button" aria-label="Previous legend variant">←</button>
<button id="vA" type="button">A words</button><button id="vB" type="button">B footer</button><button id="vC" type="button">C on demand</button>
<button id="next" type="button" aria-label="Next legend variant">→</button>
</div>

<script>
// Two schemes: each state's glyph and colour class.
const S = {
  before: {
    task: { planned: ['○', 'm'], progress: ['▶', 'a'], done: ['✔', 'g'], verified: ['✔✔', 'g'], refuted: ['✘', 'r'], blocked: ['○', 'm'] },
    live: ['●', 'a'],
    check: { passed: ['✔', 'g'], failed: ['✘', 'r'], stale: ['◌', 'a'] },
    kind: { worker: ['⚒', 'a'], verifier: ['✓', 'g'], Explore: ['◎', 'c'], Plan: ['▧', 'v'], general: ['●', 'b'] },
    fam: { edit: 'a', shell: 'g', read: 'b', search: 'c', web: 'c', mcp: 'v', plan: 'm' },
    head: 'b h',
  },
  after: {
    task: { planned: ['○', 'f'], progress: ['▶', 'b'], done: ['✔', 't'], verified: ['✔✔', 'g'], refuted: ['✘', 'r'], blocked: ['⊘', 'r'] },
    live: ['●', 'b'],
    check: { passed: ['', 'g'], failed: ['✘', 'r'], stale: ['◷', 'a'] },
    kind: { worker: ['⚒', 't'], verifier: ['⚖', 't'], Explore: ['◎', 't'], Plan: ['▧', 't'], general: ['◇', 't'] },
    fam: { edit: 'm', shell: 'm', read: 'm', search: 'm', web: 'm', mcp: 'm', plan: 'm' },
    head: 't h',
  },
}
const WORD = { planned: 'planned', progress: 'in progress', done: 'done', verified: 'verified', refuted: 'failed its check', blocked: 'blocked' }
const FG = { edit: '✎', shell: '❯', read: '▤', search: '⌕', web: '◍', mcp: '⧉', plan: '☰' }
const TASKS = [
  ['api', [['verified', 'Define the schema'], ['progress', 'Build the endpoints', '', 'api-1'], ['done', 'Auth middleware', 1], ['progress', 'Rate limiting', 1], ['blocked', 'Write the client', 0, 'by Build the endpoints']]],
  ['ui', [['progress', 'Dashboard page'], ['planned', 'Settings page'], ['done', 'Design tokens'], ['refuted', 'Dark theme']]],
  ['tests', [['progress', 'Unit tests'], ['blocked', 'Integration tests', 0, 'by Build the endpoints, Dashboard page'], ['planned', 'Load tests']]],
  ['docs', [['verified', 'README'], ['blocked', 'API reference', 0, 'by Build the endpoints']]],
]
const AGENTS = [
  ['worker', 'api-1 · Build the endpoints', { edit: 12, shell: 5, read: 9 }],
  ['worker', 'Dashboard page', { edit: 8, read: 4, web: 2 }],
  ['verifier', 'Check the unit tests', { shell: 9, read: 6, search: 3 }],
  ['Explore', 'Find rate limit callers', { search: 14, read: 7 }],
  ['Plan', 'Plan the deploy', { read: 5, search: 2, plan: 3 }],
  ['general', 'CI pipeline', { shell: 7, edit: 3, mcp: 2 }],
]
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c])
const sp = (cls, text) => '<span class="' + cls + '">' + esc(text) + '</span>'
const word = (cls, text) => '<span class="word ' + cls + '">' + esc(text) + '</span>'
const pad = (s, n) => s + ' '.repeat(Math.max(1, n - [...s].length))

function key(s, items) {
  return '<span class="key">' + sp('m', '─'.repeat(40)) + '\\n' + items.map(([g, c, w]) => (g ? sp(c, g) + ' ' : '') + sp('m', w)).join(sp('m', '  ')) + '</span>'
}
function taskKey(s) { return key(s, Object.keys(WORD).map(k => [s.task[k][0], s.task[k][1], WORD[k]])) }

function tasksView(s, before) {
  let out = sp(s.head, 'PROGRESS') + '  ' + sp('t', '8 of 18 done') + sp('m', ' · ') + sp('g', '2 verified') + sp('m', ' · ') + sp('r', '1 failed its check') + '\\n'
  out += sp(s.head, 'GIT') + '       ' + sp('t', 'main · 3 changed') + '\\n'
  const c = s.check
  out += sp(s.head, 'CHECKS') + '    ' + (c.passed[0] ? sp(c.passed[1], c.passed[0]) + ' ' : '') + sp(before ? 't' : 'g', 'test passed') + sp('m', ' · ') + sp(c.failed[1], c.failed[0] + ' lint failed') + sp('m', ' · ') + sp(c.stale[1], c.stale[0] + ' types stale') + sp('m', ' (3 edits since)') + '\\n\\n'
  for (const [area, rows] of TASKS) {
    out += sp(before ? 'b' : 'm', area) + '\\n'
    for (const [st, name, sub, note] of rows) {
      const [g, cls] = s.task[st]
      const lead = sub ? '      ' : '  '
      out += lead + sp(cls, pad(g, 3)) + sp(st === 'planned' ? 'm' : 't', pad(name, 26 - (sub ? 4 : 0)))
      if (before && st === 'blocked') out += sp('m', 'waits on ' + note.replace('by ', ''))
      else out += word(cls, WORD[st]) + (note ? sp('m', ' ' + (st === 'blocked' && !before ? note : '· ' + note)) : '')
      out += '\\n'
    }
  }
  return out + taskKey(s)
}

function agentsView(s, before) {
  let out = sp(s.head, 'LIVE AGENTS') + '\\n'
  for (const [kind, label, fams] of AGENTS) {
    const [g, cls] = s.kind[kind]
    out += '  ' + sp(s.live[1], s.live[0]) + ' ' + sp(cls, g) + ' ' + word('m', pad(kind, 9)) + sp('t', pad(label, 30)) +
      Object.entries(fams).map(([f, n]) => sp(s.fam[f], FG[f] + n)).join(' ') + '\\n'
  }
  out += '\\n' + sp(s.head, 'PROCESSES') + '\\n'
  for (const [l, k] of [['npm run dev', 'shell'], ['Watch the build', 'monitor'], ['every 10 minutes', 'cron']])
    out += '  ' + sp(before ? 'c' : s.live[1], s.live[0]) + ' ' + sp('t', pad(l, 20)) + sp('m', k) + '\\n'
  const kinds = Object.entries(s.kind).map(([k, [g, c]]) => [g, c, k])
  return out + key(s, [[s.live[0], s.live[1], 'running'], ...kinds]) +
    '<span class="key">\\n' + Object.entries(FG).map(([f, g]) => sp(s.fam[f], g) + ' ' + sp('m', f)).join(sp('m', '  ')) + '</span>'
}

function bar(share, cls) { const n = Math.round(share * 16); return sp(cls, '█'.repeat(n)) + sp('f', '░'.repeat(16 - n)) }
function resourcesView(s, before) {
  if (before) return sp(s.head, 'CONTEXT WINDOW') + '  ' + bar(.71, 'a') + ' ' + sp('a', '71%') + '\\n' +
    sp(s.head, '5-HOUR LIMIT') + '    ' + bar(.92, 'r') + ' ' + sp('r', '92%') + sp('m', ' · resets 14:00') + '\\n' +
    sp(s.head, 'WEEKLY LIMIT') + '    ' + bar(.31, 'g') + ' ' + sp('g', '31%') + '\\n\\n' +
    sp(s.head, 'THIS PROMPT') + '     ' + sp('r', '410k / 330k') + sp('m', ' · L · sized by heuristic')
  return sp(s.head, 'CONTEXT') + '        ' + bar(142 / 150, 'a') + ' ' + sp('a', '142k of 150k') + word('m', ' · smart-zone caution') + sp('m', ' · window 200k') + '\\n' +
    sp(s.head, '5-HOUR LIMIT') + '   ' + bar(.92, 'r') + ' ' + sp('r', '92%') + sp('m', ' · resets 14:00') + '\\n' +
    sp(s.head, 'WEEKLY LIMIT') + '   ' + bar(.31, 'm') + ' ' + sp('m', '31%') + '\\n\\n' +
    sp(s.head, 'PROMPT GROWTH') + '  ' + sp('a', '410k') + sp('m', ' · expected up to 330k') + word('m', ' · past expected') +
    key(s, [['', 'm', 'muted: fine'], ['', 'a', 'amber: getting close'], ['', 'r', 'rose: act now']].map(([g, c, w]) => ['■', c, w]))
}

function cityView(s, before) {
  return sp('r h', '▲ needs you: permission for Bash · asked by api-1 · waiting 2m05s') + '\\n' +
    sp('t', 'next: /code-review') + '\\n' + sp('a', 'ctx 142k') + (before ? '' : word('m', ' · smart-zone caution')) + '\\n' +
    sp('m', '8/18 tasks') + '\\n' + sp('m', '(the city drawing follows below)')
}

const VIEWS = [['City', cityView], ['Tasks', tasksView], ['Agents', agentsView], ['Resources', resourcesView]]
function drawPane() {
  const before = document.body.classList.contains('before')
  const s = before ? S.before : S.after
  let html = '<h2>Pane, four views</h2><div style="display:grid;gap:14px">'
  for (const [name, fn] of VIEWS) {
    html += '<div><div class="tabs">' + VIEWS.map(([n]) => '<span class="' + (n === name ? 'on' : '') + '">' + n + '</span>').join('') +
      '<span class="btn keybtn" role="button" tabindex="0">? Key</span></div>' +
      '<div class="term">' + fn(s, before) + '</div>' +
      '<div class="term keypanel" style="margin-top:6px">' + allKey(s) + '</div></div>'
  }
  document.getElementById('pane').innerHTML = html + '</div>'
  for (const b of document.querySelectorAll('.keybtn')) {
    const t = () => document.body.classList.toggle('open')
    b.addEventListener('click', t)
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); t() } })
  }
}
function allKey(s) {
  const rows = Object.keys(WORD).map(k => sp(s.task[k][1], pad(s.task[k][0], 3)) + sp('t', WORD[k]))
  rows.push(sp(s.live[1], pad(s.live[0], 3)) + sp('t', 'running'))
  rows.push(sp(s.check.stale[1], pad(s.check.stale[0], 3)) + sp('t', 'stale check'))
  rows.push(sp('r', '▲  ') + sp('t', 'needs you'))
  rows.push('')
  rows.push(sp('r', '■ ') + sp('t', 'act now') + '   ' + sp('a', '■ ') + sp('t', 'getting close') + '   ' + sp('b', '■ ') + sp('t', 'working now') + '   ' + sp('g', '■ ') + sp('t', 'verified'))
  return sp('h t', 'KEY') + '\\n' + rows.join('\\n')
}

const VARIANTS = ['A', 'B', 'C']
const params = new URLSearchParams(location.search)
let variant = VARIANTS.includes(params.get('variant')) ? params.get('variant') : 'A'
let scheme = params.get('palette') === 'before' ? 'before' : 'after'
function apply() {
  document.body.classList.remove('vA', 'vB', 'vC', 'before', 'after')
  document.body.classList.add('v' + variant, scheme)
  for (const v of VARIANTS) document.getElementById('v' + v).setAttribute('aria-pressed', String(v === variant))
  document.getElementById('pBefore').setAttribute('aria-pressed', String(scheme === 'before'))
  document.getElementById('pAfter').setAttribute('aria-pressed', String(scheme === 'after'))
  try { history.replaceState(null, '', '?variant=' + variant + '&palette=' + scheme) } catch (e) {}
  drawPane()
}
const step = d => { variant = VARIANTS[(VARIANTS.indexOf(variant) + d + 3) % 3]; apply() }
document.getElementById('prev').onclick = () => step(-1)
document.getElementById('next').onclick = () => step(1)
for (const v of VARIANTS) document.getElementById('v' + v).onclick = () => { variant = v; apply() }
document.getElementById('pBefore').onclick = () => { scheme = 'before'; apply() }
document.getElementById('pAfter').onclick = () => { scheme = 'after'; apply() }
document.addEventListener('keydown', e => {
  if (e.target.closest && e.target.closest('input,textarea,[contenteditable]')) return
  if (e.key === 'ArrowLeft') step(-1)
  if (e.key === 'ArrowRight') step(1)
})
apply()
</script>
`

writeFileSync(process.argv[2] ?? 'prototype-one-meaning.html', page)
