// The check command: whether the mod is healthy. It runs each stage in order,
// stops at the first that fails, names it and prints its full output. When
// every stage passes it prints one line per stage. CI runs this and nothing
// else, so anything that guards the mod should call it rather than repeat it.
//   node tools/check.ts
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

type Stage = { name: string; command: string }

const STAGES: Stage[] = [
  // Strict, so warnings the runtime tolerates still fail.
  { name: 'validation', command: 'claude plugin validate --strict .' },
  // The type check goes here, between validation and the tests.
  { name: 'tests', command: 'claude plugin test .' },
]

for (const stage of STAGES) {
  const started = Date.now()
  // Through the shell, so `claude` resolves however it is installed
  // (claude.exe, an npm .cmd shim on Windows, a script on Linux).
  const run = spawnSync(stage.command, { cwd: root, shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const seconds = ((Date.now() - started) / 1000).toFixed(1)

  if (run.status !== 0) {
    process.stdout.write(run.stdout ?? '')
    process.stderr.write(run.stderr ?? '')
    if (run.error) console.error(run.error.message)
    console.error(`\ncheck failed at the ${stage.name} stage (${stage.command}), exit ${run.status ?? 'none'}`)
    process.exit(1)
  }

  console.log(`ok  ${stage.name} (${seconds}s)`)
}
