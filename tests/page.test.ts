import { expect, test } from 'claude-code/testing'

import { renderCity } from '../hooks/city'
import { PAGE_REFRESH_SECONDS, cityPage } from '../hooks/page'
import { C } from '../hooks/theme'
import { base, busy, scenes, small } from '../tools/scenes'

// A project name no page may carry as it stands.
const HOSTILE = 'a<b>&"c'

test('the page is one whole document that reloads itself', () => {
  const page = cityPage(busy, 'atlas')

  expect(page.startsWith('<!doctype html>')).toBe(true)
  expect(page.trimEnd().endsWith('</html>')).toBe(true)
  expect(page).toContain('<meta charset="utf-8">')
  expect(page).toContain('<meta name="viewport"')
  expect(PAGE_REFRESH_SECONDS).toBe(3)
  expect(page).toContain(`<meta http-equiv="refresh" content="${PAGE_REFRESH_SECONDS}">`)
  expect(page).toContain('<title>Polis · atlas</title>')
  // One of each: a second document or drawing inside it would be a mistake.
  expect(page.split('<!doctype').length).toBe(2)
  expect(page.split('<title>Polis').length).toBe(2)
})

test('the page is painted in the palette, on html as well as body', () => {
  const page = cityPage(small, 'atlas')

  expect(page).toContain(`html,body{background:${C.bg}}`)
  expect(page).toContain(`color:${C.text}`)
  expect(page).toContain(`color:${C.muted}`)
})

test('the page carries the city, scaled to the window', () => {
  for (const [, scene] of scenes) {
    const page = cityPage(scene, 'atlas')
    const svg = renderCity(scene, 'avenue')
    const fixed = / width="[0-9]+" height="[0-9]+"/

    expect(svg).toMatch(fixed)
    expect(page.split('<svg ').length).toBe(2)
    expect(page).toContain('</svg>')
    expect(page).toContain(' width="100%">')
    // The drawing whole, but for the fixed size it came with.
    expect(page).toContain(svg.slice(svg.indexOf('>') + 1))
    expect(page).toContain(svg.slice(0, svg.search(fixed)))
    expect(page.slice(page.indexOf('<svg '), page.indexOf('>', page.indexOf('<svg ')))).not.toMatch(fixed)
  }
})

test('the header names the project and says what the city shows', () => {
  const page = cityPage(busy, 'atlas')

  expect(page).toContain('<h1>atlas</h1>')
  expect(page).toContain('City map of atlas: 6 districts')
  expect(page).toContain('6 agents working, context window 71% full.')
})

test('a project name is escaped wherever it appears', () => {
  const named = { ...small, project: { ...busy.project!, name: HOSTILE } }
  const page = cityPage(named, HOSTILE)

  expect(page).not.toContain(HOSTILE)
  expect(page).not.toContain('<b>')
  expect(page).toContain('<title>Polis · a&lt;b&gt;&amp;&quot;c</title>')
  expect(page).toContain('<h1>a&lt;b&gt;&amp;&quot;c</h1>')
  // The sentence under it names the project too.
  expect(page).toContain('City map of a&lt;b&gt;&amp;&quot;c:')
})

test('the same session gives the same page, whatever the time', () => {
  for (const [, scene] of scenes) {
    const page = cityPage(scene, 'atlas')

    expect(cityPage(scene, 'atlas')).toBe(page)
    // The clock moving on alone is no reason to write the file again.
    expect(cityPage({ ...scene, now: scene.now + 86_400_000 }, 'atlas')).toBe(page)
  }
  expect(cityPage(small, 'atlas')).not.toBe(cityPage(base, 'atlas'))
})

test('no page carries a value that failed to compute', () => {
  for (const [, scene] of scenes) {
    for (const name of ['atlas', '', HOSTILE]) {
      const page = cityPage(scene, name)

      expect(page).not.toContain('NaN')
      expect(page).not.toContain('undefined')
      expect(page).not.toContain('[object')
    }
  }
})

test('the header says what needs the person, the smart-zone state and the tasks done', () => {
  const waiting = {
    ...small,
    waits: [{ kind: 'permission' as const, at: 0, tool: 'Write' }],
    usage: { ...small.usage, contextTokens: 125_000 },
  }
  const page = cityPage(waiting, 'atlas')
  const header = page.slice(page.indexOf('<header>'), page.indexOf('</header>'))

  expect(header).toContain('<span class="needs">▲ needs you: permission for Write</span>')
  expect(header).toContain('<span class="caution">ctx 125k: smart-zone caution</span>')
  expect(header).toMatch(/<span>\d+\/\d+ tasks done<\/span>/)

  const past = cityPage({ ...small, usage: { ...small.usage, contextTokens: 160_000 } }, 'atlas')
  expect(past).toContain('<span class="out">ctx 160k: out of the smart zone</span>')
  // Inside the smart zone the reading is quiet, and with nothing waiting the session's state stands first.
  const calm = cityPage(small, 'atlas')
  expect(calm).toContain('<span>ctx 68k</span>')
  expect(calm).toMatch(/<h1>atlas<\/h1><span>(working|your turn|idle)<\/span>/)
})
