// The check command: whether the mod is healthy. It runs each stage in order,
// stops at the first that fails, names it and prints its full output. When
// every stage passes it prints one line per stage. The pre-commit hook and CI
// both run it (CI first has the engine write the types the type-check needs),
// so anything that guards the mod should call it rather than repeat it.
//   node tools/check.ts
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// precondition, when a stage has one, runs before its command and returns why
// the stage cannot run, or nothing when it can.
type Stage = { name: string; command: string; precondition?: () => string | undefined }

const GENERATED_TYPES = join(root, '.claude-plugin', 'types', 'tsconfig.json')

const typesPresent = (): string | undefined =>
  existsSync(GENERATED_TYPES)
    ? undefined
    : `the engine-generated types are missing (${GENERATED_TYPES}).\n` +
      'Claude Code writes .claude-plugin/types/ when an interactive session loads the mod from this folder\n' +
      '(for example `claude --plugin-dir .`, or the desktop app with this folder in CLAUDE_CODE_PLUGIN_DIRS).\n' +
      'Print mode writes them only with CLAUDE_CODE_PLUGIN_DIR_WATCH=1 (confirmed signed out on an ubuntu\n' +
      'runner), as CI does:\n' +
      '`CLAUDE_CODE_PLUGIN_DIR_WATCH=1 claude -p ok --plugin-dir . --allowedTools Glob,Grep` (Glob and Grep, so the\n' +
      'types have them on Linux too). If another copy of polis loads first, this folder is skipped;\n' +
      'copying .claude-plugin/types/ from a copy of the mod that has it also works.'

const STAGES: Stage[] = [
  // Strict, so warnings the runtime tolerates still fail.
  { name: 'validation', command: 'claude plugin validate --strict .' },
  // Against the API types the engine writes beside the mod (gitignored), with
  // a pinned TypeScript from npx so no global install is needed.
  {
    name: 'type-check',
    command: 'npx --yes --package typescript@5.9.3 -- tsc --noEmit -p tsconfig.json',
    precondition: typesPresent,
  },
  { name: 'tests', command: 'claude plugin test .' },
]

for (const stage of STAGES) {
  const unmet = stage.precondition?.()
  if (unmet) {
    console.error(`check failed at the ${stage.name} stage: ${unmet}`)
    process.exit(1)
  }
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
