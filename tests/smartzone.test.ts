// The smart-zone warning as the person and Claude get it: the band's context
// reading, the toasts as context climbs, the status line, and the note added
// to the next prompt.
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, FoundElement } from 'claude-code/testing'
import type { On } from 'claude-code'

import { C } from '../hooks/theme'

const ROOT = '/work/atlas'

const START = { cwd: ROOT, surface: null, isInteractive: false } as const

type World = {
  toasts: string[]
  /** The last status line the mod set, or undefined once it cleared it. */
  status: () => string | undefined
}

// The engine beneath the mod for a session in /work/atlas.
const world = (on: On): World => {
  const toasts: string[] = []
  let line: string | undefined
  mock.clock(on)
  mock.store(on)
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.measure', (_, e) => ({ changed: e.changed }))
  on('session.repo', () => ({ value: null }))
  on('session.cwd', () => ({ value: ROOT }))
  on('session.id', () => ({ value: 'session-1' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200_000, tokens: 20_000, percent: 10 }, rateLimits: [] },
  }))
  on('fs.exists', () => ({ value: true }))
  on('fs.write', () => ({ value: undefined }))
  on('ui.panes', () => ({ value: [] }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.status', (_, e) => {
    line = e.text

    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push(e.text)

    return { value: undefined }
  })
  on('command.register', (_, e) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [] }))
  on('tool.register', (_, e) => ({ value: { tool: e.name } }))
  on('agent.register', (_, e) => ({ value: { agent: e.name } }))

  return { toasts, status: () => line }
}

const measure = ($: Engine, tokens: number, window = 200_000) =>
  $.session.measure({
    context: { window, tokens, percent: Math.round((tokens / window) * 100) },
    rateLimits: [],
    changed: ['context'],
  } as never)

const bandAt = (columns: number) =>
  ({
    plugin: 'polis',
    component: 'AbovePrompt',
    props: {
      hasSurvey: false,
      isWorking: false,
      maxRows: 6,
      bodyColumns: columns,
      scroll: { offset: 0, bodyRows: 6 },
      view: {},
    },
  }) as const

const banded = async ($: Engine, columns = 160): Promise<FoundElement[]> => {
  const ui = await $.ui.mount({ ...bandAt(columns), surface: 'terminal' })
  const texts = await ui.findAll({ type: 'Text' })
  await ui.unmount()

  return texts
}

const reading = async ($: Engine, columns = 160): Promise<FoundElement | undefined> =>
  (await banded($, columns)).find(one => one.text.startsWith('ctx '))

test('the band reads context in tokens: quiet, amber at the caution, red past the limit', async ($, on) => {
  world(on)
  await $.session.start(START)

  await measure($, 100_000)
  expect((await reading($))?.text).toBe('ctx 100k')
  expect((await reading($))?.props.color).toBe(C.muted)

  // The caution is 80% of the 150k limit: 120k.
  await measure($, 122_000)
  expect((await reading($))?.text).toBe('ctx 122k')
  expect((await reading($))?.props.color).toBe(C.run)

  await measure($, 151_000)
  expect((await reading($))?.text).toBe('ctx 151k · out of the smart zone')
  expect((await reading($))?.props.color).toBe(C.fail)
})

test('one toast per crossing, saying what to do, and none for the old window share', async ($, on) => {
  const here = world(on)
  await $.session.start(START)

  await measure($, 100_000)
  expect(here.toasts).toEqual([])
  await measure($, 121_000)
  await measure($, 130_000)
  expect(here.toasts).toHaveLength(1)
  expect(here.toasts[0]).toStartWith('Smart-zone caution: context 121k of 150k.')
  expect(here.toasts[0]).toContain('sub-agents')

  await measure($, 150_000)
  await measure($, 170_000)
  expect(here.toasts).toHaveLength(2)
  expect(here.toasts[1]).toStartWith('Out of the smart zone: context 150k is past 150k.')
  expect(here.toasts[1]).toContain('/compact or /clear')

  // 85% of the window: the old warning is gone.
  await measure($, 170_000)
  expect(here.toasts.some(one => one.includes('window'))).toBe(false)
})

test('a crossing straight past the limit warns once, and falling below the caution re-arms both', async ($, on) => {
  const here = world(on)
  await $.session.start(START)

  await measure($, 160_000)
  expect(here.toasts).toHaveLength(1)
  expect(here.toasts[0]).toStartWith('Out of the smart zone')
  // Down to the caution after a compact that kept much: no new warning.
  await measure($, 125_000)
  expect(here.toasts).toHaveLength(1)

  await measure($, 40_000)
  await measure($, 121_000)
  await measure($, 151_000)
  expect(here.toasts).toHaveLength(3)
  expect(here.toasts[1]).toStartWith('Smart-zone caution')
  expect(here.toasts[2]).toStartWith('Out of the smart zone')
})

test('the limit is the same on a 1M window, and 80% of a window too small to hold it', async ($, on) => {
  const here = world(on)
  await $.session.start(START)

  // A million-token window: still 150k, though that is 15% of it.
  await measure($, 151_000, 1_000_000)
  expect(here.toasts.at(-1)).toStartWith('Out of the smart zone: context 151k is past 150k.')

  await measure($, 10_000, 100_000)
  // On a 100k window the limit is 80k, its caution 64k.
  await measure($, 65_000, 100_000)
  expect(here.toasts.at(-1)).toStartWith('Smart-zone caution: context 65k of 80k.')
})

test('a custom smart-zone limit moves both levels', { options: { smartZone: 300_000 } }, async ($, on) => {
  const here = world(on)
  await $.session.start(START)

  await measure($, 200_000, 1_000_000)
  expect(here.toasts).toEqual([])
  expect((await reading($))?.props.color).toBe(C.muted)
  await measure($, 241_000, 1_000_000)
  expect(here.toasts).toHaveLength(1)
  expect(here.toasts[0]).toStartWith('Smart-zone caution: context 241k of 300k.')
})
