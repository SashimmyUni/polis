// Runs the probe mod (tools/probe/) in real headless sessions and prints what
// the engine handed it, one JSON line per event. Use it to check an engine
// fact before building on it, rather than trusting a test's stand-in.
//   node tools/probe.ts "<prompt>"                one session
//   node tools/probe.ts --sessions 2 "<prompt>"   two at once, 3 s apart, each
//                                                 pinging the store (is it shared?)
// Each session is `claude -p` with the probe loaded through --plugin-dir; a
// signed-in run spends one model turn per session. The logs land in a fresh
// folder under the system temp directory, named on the last line.
//
// Known so far:
// - The store is shared between running sessions: each saw the other's writes
//   within one 500 ms ping, and writes to different keys never clobbered
//   each other (#52).
// - A mod's store file is named from where the mod was loaded, so a copy
//   loaded with --plugin-dir keeps a store apart from the installed copy.
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const PROBE = join(root, 'tools', 'probe')

const args = process.argv.slice(2)
const at = args.indexOf('--sessions')
const count = at === -1 ? 1 : Number(args[at + 1])
const prompt = args.filter((_, i) => at === -1 || (i !== at && i !== at + 1)).join(' ')
if (prompt === '' || !Number.isInteger(count) || count < 1) {
  console.error('usage: node tools/probe.ts [--sessions N] "<prompt>"')
  process.exit(2)
}

const out = mkdtempSync(join(tmpdir(), 'polis-probe-'))
const quote = (text: string): string => `"${text.replace(/(["\\$`])/g, '\\$1')}"`

const run = (role: string): Promise<void> =>
  new Promise((done) => {
    const log = join(out, `${role}.log`)
    const env = { ...process.env, PROBE_LOG: log, ...(count > 1 ? { PROBE_ROLE: role } : {}) }
    const child = spawn(`claude -p ${quote(prompt)} --plugin-dir ${quote(PROBE)} --no-session-persistence`, {
      cwd: root,
      shell: true,
      env,
      stdio: 'ignore',
    })
    child.on('exit', () => done())
  })

const roles = Array.from({ length: count }, (_, i) => String.fromCharCode(97 + i))
const runs: Promise<void>[] = []
for (const role of roles) {
  runs.push(run(role))
  if (role !== roles.at(-1)) await new Promise((wait) => setTimeout(wait, 3000))
}
await Promise.all(runs)

for (const role of roles) {
  const log = join(out, `${role}.log`)
  console.log(`--- session ${role}`)
  console.log(existsSync(log) ? readFileSync(log, 'utf8').trimEnd() : '(no events: did the probe load?)')
}
console.log(`logs: ${out}`)
