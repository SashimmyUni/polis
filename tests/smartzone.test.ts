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

// What Claude reads beside each prompt the person sends, in order.
const prompted = (on: On): (readonly string[])[] => {
  const seen: (readonly string[])[] = []
  on('prompt.submit', (_, e) => {
    seen.push(e.context ?? [])

    return { text: e.text, ...(e.context === undefined ? {} : { context: e.context }) }
  })

  return seen
}

const send = ($: Engine, text = 'go on') => $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })

const COMPOSE = {
  model: 'claude',
  promptModel: 'claude',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
} as const

test('Claude is told of each crossing once, after the next prompt, and never in the system prompt', async ($, on) => {
  world(on)
  const seen = prompted(on)
  on('prompt.compose', () => ({ sections: [{ id: 'intro', text: 'Hello.', scope: 'shared' }] }))
  await $.session.start(START)

  await measure($, 100_000)
  await send($)
  expect(seen.at(-1)).toEqual([])

  await measure($, 125_000)
  await send($)
  expect(seen.at(-1)).toHaveLength(1)
  expect(seen.at(-1)?.[0]).toStartWith("Polis: this session's context is 125k, past the smart-zone caution (120k of a 150k limit).")
  expect(seen.at(-1)?.[0]).toContain('sub-agents')
  // Told once: the next prompt carries nothing.
  await send($)
  expect(seen.at(-1)).toEqual([])

  await measure($, 152_000)
  await send($)
  const note = seen.at(-1)?.[0] ?? ''
  expect(note).toContain('past the smart-zone limit of 150k')
  expect(note).toContain('/clear, after writing down what the next phase needs')
  expect(note).toContain('/compact when it does')
  expect(note).toContain('Never carry on past this point without saying so.')

  const composed = await $.prompt.compose(COMPOSE)
  expect(composed.sections.map(section => section.text).join(' ')).not.toContain('smart-zone')
})

test('two crossings before the next prompt are told as the higher one', async ($, on) => {
  world(on)
  const seen = prompted(on)
  await $.session.start(START)

  await measure($, 125_000)
  await measure($, 155_000)
  await send($)
  expect(seen.at(-1)).toHaveLength(1)
  expect(seen.at(-1)?.[0]).toContain('past the smart-zone limit')
  await send($)
  expect(seen.at(-1)).toEqual([])
})

test('a crossing undone by a compact before the next prompt is not told', async ($, on) => {
  world(on)
  const seen = prompted(on)
  await $.session.start(START)

  await measure($, 125_000)
  await measure($, 30_000)
  await send($)
  expect(seen.at(-1)).toEqual([])
})

test('with guidance off Claude is told nothing, and the person is still warned', { options: { guidance: false } }, async ($, on) => {
  const here = world(on)
  const seen = prompted(on)
  await $.session.start(START)

  await measure($, 155_000)
  await send($)
  expect(seen.at(-1)).toEqual([])
  expect(here.toasts).toHaveLength(1)
  expect((await reading($))?.text).toBe('ctx 155k · out of the smart zone')
})

test("where no band is drawn the status line carries the band's smart-zone reading, in its wording", async ($, on) => {
  const here = world(on)
  await $.session.start(START)

  await measure($, 100_000)
  expect(here.status()).toBe('ctx 100k')
  await measure($, 125_000)
  expect(here.status()).toBe('ctx 125k')
  await measure($, 151_000)
  expect(here.status()).toBe('ctx 151k · out of the smart zone')
  await measure($, 30_000)
  expect(here.status()).toBe('ctx 30k')
})

test('a band left showing keeps the status line clear, and hiding it brings the state back', async ($, on) => {
  const here = world(on)
  await $.session.start(START)
  await measure($, 151_000)
  const ui = await $.ui.mount({ ...bandAt(160), surface: 'terminal' })
  await measure($, 125_000)
  expect(here.status()).toBeUndefined()

  await ui.press({ key: 'hide' })
  expect(here.status()).toBe('ctx 125k')
  await ui.unmount()
})
