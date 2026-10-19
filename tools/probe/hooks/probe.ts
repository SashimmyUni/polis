// The probe: a mod that only writes down what the engine hands it, one JSON
// line per event, so a fact Polis would build on (does this tool reach
// tool.call, does prompt.submit carry the command, does one session see
// another's store) is read from a real host rather than assumed. Run it with
// tools/probe.ts, which sets PROBE_LOG and PROBE_ROLE.
import type { EngineInterface, Register } from 'claude-code'

// Long inputs are cut so a log stays readable.
const clip = (value: unknown): string => {
  const text = JSON.stringify(value) ?? 'undefined'
  return text.length > 400 ? `${text.slice(0, 400)}…` : text
}

const lines: string[] = []
let log = ''

async function write($: EngineInterface, event: string, fields: Record<string, unknown>): Promise<void> {
  // A failed write is dropped: the probe never holds up the session it watches.
  try {
    lines.push(clip({ at: await $.clock.now(), event, ...fields }))
    if (log !== '') await $.fs.write(log, lines.join('\n') + '\n')
  } catch {}
}

// With a role, the session pings the store every 500 ms and notes what the
// other sessions wrote: whether one running session sees another's store.
async function pingStore($: EngineInterface, role: string, n: number): Promise<void> {
  await $.store.set(`probe:${role}`, { n })
  const others = (await $.store.keys()).filter((key) => key.startsWith('probe:') && key !== `probe:${role}`)
  const seen: Record<string, unknown> = {}
  for (const key of others) seen[key] = await $.store.get(key)
  await write($, 'store', { role, wrote: n, seen })
}

export const register: Register = (on) => {
  on('session.start', async ($, e, next) => {
    log = (await $.env.get('PROBE_LOG')) ?? ''
    const role = (await $.env.get('PROBE_ROLE')) ?? ''
    await write($, 'session.start', { session: await $.session.id(), repo: await $.session.repo() })
    if (role !== '') {
      let n = 0
      $.clock.every(500, async () => {
        n += 1
        await pingStore($, role, n)
      })
    }
    return next(e)
  })

  on('prompt.submit', async ($, e, next) => {
    await write($, 'prompt.submit', { text: e.text, command: e.command })
    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    await write($, 'tool.call', { tool: e.tool, agentId: e.agentId, input: e })
    return next(e)
  })

  on('skill.prompt', async ($, e, next) => {
    await write($, 'skill.prompt', { skill: e.skill, source: e.source })
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await write($, 'turn.complete', { reason: e.reason, agentId: e.agentId, answer: e.answer })
    return next(e)
  })

  on('session.end', async ($, e, next) => {
    await write($, 'session.end', { reason: e.reason })
    return next(e)
  })
}
