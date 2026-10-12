import type { Check, CheckKind } from '../types'
import { about, clip, elapsed } from './logic'

export type { Check, CheckKind } from '../types'

export type CheckState = 'passed' | 'failed' | 'stale'

// The order the kinds are shown in.
export const CHECK_KINDS: readonly CheckKind[] = ['test', 'lint', 'types', 'build']

export const CHECK_LABEL: { [K in CheckKind]: string } = {
  test: 'tests',
  lint: 'lint',
  types: 'types',
  build: 'build',
}

export const CHECK_MARK: { [S in CheckState]: string } = {
  passed: '✔',
  failed: '✘',
  stale: '◌',
}

// ------------------------------------------------------------------ commands

// Where a script name or sub-command may sit: after flags, some of which take
// a value, and after `run` or a workspace for the script runners.
const FLAGS =
  '(?:(?:--filter|--workspace|--prefix|--cwd|-F|-w|-C)\\s+\\S+\\s+|-\\S+\\s+|workspace\\s+\\S+\\s+)*'

// A script of a runner (`npm run test:unit`, `yarn lint`, `bun test`): the
// name starts with one of the words, so `testing` or `lint-staged` do not
// count as `test` and `lint` only by their separator.
const script = (names: string): RegExp =>
  new RegExp(`^${FLAGS}(?:run(?:-script)?\\s+${FLAGS})?(?:${names})(?:[:._-]\\S*)?(?:\\s|$)`)

// The first word that is no flag (or `+toolchain`): `cargo +nightly test`.
const sub = (names: string): RegExp =>
  new RegExp(`^(?:(?:\\+|-)\\S*\\s+)*(?:${names})(?:\\s|$)`)

// A goal or target anywhere in the arguments, for tools that take several.
const goal = (names: string): RegExp => new RegExp(`(?:^|\\s)(?:${names})(?:\\s|$)`)

const target = (names: string): RegExp =>
  new RegExp(`(?:^|\\s)(?:${names})(?:[:._-]\\S*)?(?:\\s|$)`)

const RUNNERS = /^(npm|pnpm|yarn|bun|turbo)$/
const MAVEN = /^(mvn|mvnw)$/
const GRADLE = /^(gradle|gradlew)$/
const MAKE = /^(make|gmake|just)$/

type Rule = readonly [kind: CheckKind, executable: RegExp, args?: RegExp]

// The one table of what counts as a check. The executable is its name alone,
// lower case, without directory or `.exe`; the arguments, when given, must
// match the words after it joined by spaces. Add a tool by adding a row.
const RULES: readonly Rule[] = [
  ['test', RUNNERS, script('test')],
  ['lint', RUNNERS, script('lint')],
  ['types', RUNNERS, script('typecheck|type-check|check-types|check:types|tsc')],
  ['build', RUNNERS, script('build')],

  ['test', /^(vitest|jest|mocha|ava|pytest|py\.test|tox|nox|unittest|rspec|phpunit|ctest)$/],
  ['test', /^playwright$/, sub('test')],
  ['test', /^cypress$/, sub('run')],
  ['test', /^claude$/, /^plugin\s+test(?:\s|$)/],
  ['test', /^cargo$/, sub('test|t|nextest')],
  ['test', /^go$/, sub('test')],
  ['test', /^dotnet$/, sub('test')],
  ['test', MAVEN, goal('test|verify')],
  ['test', GRADLE, goal('(?:[\\w-]*:)*test')],
  ['test', /^(deno|swift|flutter|mix|composer)$/, sub('test')],
  ['test', /^rake$/, sub('test|spec')],
  ['test', /^php$/, /^artisan\s+test(?:\s|$)/],
  ['test', MAKE, target('tests?|check')],

  ['lint', /^(eslint|oxlint|stylelint|tslint|flake8|pylint|pycodestyle|rubocop|golangci-lint)$/],
  ['lint', /^claude$/, /^plugin\s+validate(?:\s|$)/],
  ['lint', /^ruff$/, sub('check')],
  ['lint', /^biome$/, sub('lint|check|ci')],
  ['lint', /^deno$/, sub('lint')],
  ['lint', /^cargo$/, sub('clippy')],
  ['lint', /^go$/, sub('vet')],
  ['lint', MAKE, target('lint')],

  ['types', /^(tsc|vue-tsc|tsgo|mypy|pyright|basedpyright|pyre)$/],
  ['types', /^cargo$/, sub('check|c')],
  ['types', /^deno$/, sub('check')],

  ['build', /^(vite|next|ng|nuxt|nuxi|astro|swift|dotnet|go)$/, sub('build')],
  ['build', /^cargo$/, sub('build|b')],
  ['build', /^(webpack|rollup|tsup|esbuild)$/],
  ['build', /^cmake$/, goal('--build')],
  ['build', MAVEN, goal('package|compile')],
  ['build', GRADLE, goal('(?:[\\w-]*:)*(?:build|assemble)')],
  ['build', MAKE, target('build')],
]

// A command line cut into the words of each simple command in it. Quotes keep
// a phrase in one word and hide the operators inside it, so that
// `echo "npm test && x"` stays one command; a backslash is a path separator
// here, as the mod is used on Windows too.
const segmentsOf = (command: string): string[][] => {
  const segments: string[][] = []
  let words: string[] = []
  let word = ''
  let isOpen = false
  let quote = ''
  const endWord = (): void => {
    if (isOpen) words.push(word)
    word = ''
    isOpen = false
  }
  const endSegment = (): void => {
    endWord()
    if (words.length > 0) segments.push(words)
    words = []
  }
  for (let at = 0; at < command.length; at++) {
    const char = command[at] ?? ''
    const next = command[at + 1]
    if (quote !== '') {
      if (char === quote) quote = ''
      else if (char === '\\' && quote === '"' && next === '"') {
        word += '"'
        at++
      } else word += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      isOpen = true
    } else if (char === '\\' && (next === '\n' || next === '\r')) {
      // A continued line is still one command.
      at += next === '\r' && command[at + 2] === '\n' ? 2 : 1
    } else if (char === '\n' || char === '\r' || ';|()'.includes(char)) {
      endSegment()
    } else if (char === '&') {
      // `2>&1` and `&>` are redirections; any other `&` ends a command.
      if (command[at - 1] === '>' || command[at - 1] === '<' || next === '>') {
        word += char
        isOpen = true
      } else endSegment()
    } else if (/\s/.test(char)) {
      endWord()
    } else {
      word += char
      isOpen = true
    }
  }
  endSegment()

  return segments
}

const exeOf = (word: string): string =>
  (word.split(/[\\/]/).pop() ?? '').toLowerCase().replace(/\.(exe|cmd|bat|ps1)$/, '')

const ASSIGNMENT = /^[A-Za-z_]\w*=/
const KEYWORDS = new Set(['if', 'then', 'else', 'elif', 'do', 'while', 'until', '!', '{', '}'])
// Words that only run what follows them.
const PREFIXES = new Set(['sudo', 'time', 'nohup', 'command', 'exec', 'env', 'nice', 'call', 'cross-env'])
const FETCHERS = new Set(['npx', 'bunx', 'pnpx'])
const MANAGERS = new Set(['npm', 'pnpm', 'yarn', 'bun'])
const ENVIRONMENTS = new Set(['uv', 'poetry', 'pipenv', 'pdm', 'hatch', 'rye'])

// The words after leading flags, `--` included; a flag that takes a value
// takes the next word too.
const withoutFlags = (words: readonly string[], valued: readonly string[] = []): string[] => {
  let at = 0
  while ((words[at] ?? '').startsWith('-')) {
    const flag = words[at] ?? ''
    at += flag === '--' ? 1 : valued.includes(flag) ? 2 : 1
    if (flag === '--') break
  }

  return words.slice(at)
}

// What a wrapper runs: `npx vitest`, `pnpm exec tsc`, `uv run pytest`,
// `python -m pytest`. Undefined when the executable wraps nothing.
const unwrap = (exe: string, args: readonly string[]): string[] | undefined => {
  if (PREFIXES.has(exe)) return withoutFlags(args)
  if (FETCHERS.has(exe)) return withoutFlags(args, ['-p', '--package', '-c'])
  if (MANAGERS.has(exe) && ['exec', 'dlx', 'x'].includes(args[0] ?? '')) {
    return withoutFlags(args.slice(1), ['-p', '--package'])
  }
  if (ENVIRONMENTS.has(exe) && args[0] === 'run') {
    return withoutFlags(args.slice(1), ['--with', '-p', '--python'])
  }
  if (exe === 'bundle' && args[0] === 'exec') return withoutFlags(args.slice(1))
  if (/^(python[\d.]*|py|pypy[\d.]*)$/.test(exe)) {
    const at = args.indexOf('-m')

    return at === -1 ? undefined : args.slice(at + 1)
  }

  return undefined
}

// The command line a shell is told to run: `bash -c "npm test"`.
const inner = (exe: string, args: readonly string[]): string | undefined => {
  if (/^(bash|sh|zsh|dash|ksh|fish)$/.test(exe)) {
    const at = args.findIndex(word => /^-\w*c\w*$/.test(word))

    return at === -1 ? undefined : args[at + 1]
  }
  if (/^(pwsh|powershell)$/.test(exe)) {
    const at = args.findIndex(word => /^-c(ommand)?$/i.test(word))

    return at === -1 ? undefined : args.slice(at + 1).join(' ')
  }
  if (exe === 'cmd') {
    const at = args.findIndex(word => /^\/[ck]$/i.test(word))

    return at === -1 ? undefined : args.slice(at + 1).join(' ')
  }

  return undefined
}

const scan = (command: string, depth: number): Set<CheckKind> => {
  const found = new Set<CheckKind>()
  for (const words of segmentsOf(command)) {
    let rest = words
    // A wrapper may wrap another: `CI=1 npx -y vitest`.
    for (let hops = 0; hops < 8; hops++) {
      while (rest.length > 0 && (ASSIGNMENT.test(rest[0] ?? '') || KEYWORDS.has(rest[0] ?? ''))) {
        rest = rest.slice(1)
      }
      const exe = exeOf(rest[0] ?? '')
      const args = rest.slice(1)
      const wrapped = unwrap(exe, args)
      if (wrapped !== undefined) {
        rest = wrapped
        continue
      }
      const text = inner(exe, args)
      if (text !== undefined && depth < 3) {
        for (const kind of scan(text, depth + 1)) found.add(kind)
      }
      const joined = args.join(' ')
      for (const [kind, executable, pattern] of RULES) {
        if (executable.test(exe) && (pattern === undefined || pattern.test(joined))) found.add(kind)
      }
      break
    }
  }

  return found
}

// The checks a shell command runs, in display order. A command that only
// mentions them (`echo "npm test"`, `git commit -m "fix tests"`) runs none.
export const checksOf = (command: string): CheckKind[] => {
  const found = scan(command, 0)

  return CHECK_KINDS.filter(kind => found.has(kind))
}

// ------------------------------------------------------------------ outcomes

const bag = (value: unknown): { [key: string]: unknown } | undefined =>
  typeof value === 'object' && value !== null ? (value as { [key: string]: unknown }) : undefined

// An error that says nothing of an exit code and tells of a stop instead.
const STOPPED = /\b(interrupted|aborted|timed out)\b/i

// Whether a finished shell call reads as a success. A denied call and an
// error (a failing command reports `Exit code N`) read as failure; a call
// that went to the background, was interrupted or has a shape not known
// says nothing either way.
export const outcomeOf = (answer: unknown, input?: unknown): boolean | undefined => {
  const reply = bag(answer)
  if (reply === undefined) return undefined
  if (typeof reply.deny === 'string') return false
  const text =
    typeof reply.text === 'string' ? reply.text : typeof reply.result === 'string' ? reply.result : ''
  if (reply.isError === true) {
    if (/\bExit code \d+/.test(text)) return false

    return STOPPED.test(text) ? undefined : false
  }
  if (bag(input)?.run_in_background === true) return undefined
  const out = bag(reply.result)
  if (out !== undefined) {
    if (
      out.interrupted === true ||
      out.backgroundedByUser === true ||
      typeof out.backgroundTaskId === 'string' ||
      typeof out.timedOutAfterMs === 'number'
    ) {
      return undefined
    }
    if (typeof out.stdout === 'string' || typeof out.interrupted === 'boolean') return true
  }
  if (text === '' || /running in (the )?background/i.test(text)) return undefined

  return true
}

// -------------------------------------------------------------------- state

export const recordChecks = (
  checks: readonly Check[],
  kinds: readonly CheckKind[],
  run: { hasPassed: boolean; at: number; ms: number; command: string },
): Check[] => {
  const kept = checks.filter(check => !kinds.includes(check.kind))
  const added = kinds.map((kind): Check => ({ kind, ...run, editsSince: 0 }))
  const all = [...kept, ...added]

  return CHECK_KINDS.flatMap(kind => {
    const one = all.find(check => check.kind === kind)

    return one === undefined ? [] : [one]
  })
}

// One more file was edited, so every result is one edit older. With no checks
// the very array comes back, so that a store can skip the write.
export const noteEdit = (checks: readonly Check[]): Check[] =>
  checks.length === 0
    ? (checks as Check[])
    : checks.map(check => ({ ...check, editsSince: check.editsSince + 1 }))

// A failure stays a failure however much is edited after it: only running the
// check again can tell.
export const stateOf = (check: Check): CheckState => {
  if (!check.hasPassed) return 'failed'

  return check.editsSince > 0 ? 'stale' : 'passed'
}

// ---------------------------------------------------------------------- text

const checkOf = (checks: readonly Check[], kind: CheckKind): Check | undefined =>
  checks.find(check => check.kind === kind)

// For a band or a status row: only the kinds that have run.
export const checksLine = (checks: readonly Check[]): string =>
  CHECK_KINDS.flatMap(kind => {
    const check = checkOf(checks, kind)

    return check === undefined ? [] : [`${CHECK_LABEL[kind]} ${CHECK_MARK[stateOf(check)]}`]
  }).join(' · ')

const ago = (ms: number): string => (ms < 60_000 ? 'just now' : `${about(ms)} ago`)

// Tenths under ten seconds, where they still tell runs apart.
const took = (ms: number): string => {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`

  return ms < 10_000 ? `${(ms / 1000).toFixed(1)}s` : elapsed(ms)
}

const edits = (n: number): string => `${n} ${n === 1 ? 'edit' : 'edits'}`

// One line for each check that has run, for the Checks section.
export const checkLines = (checks: readonly Check[], now: number): string[] =>
  CHECK_KINDS.flatMap(kind => {
    const check = checkOf(checks, kind)
    if (check === undefined) return []
    const state = stateOf(check)
    const when = ago(now - check.at)
    const said =
      state === 'stale'
        ? [`stale: ${edits(check.editsSince)} since it passed ${when}`]
        : [`${state} ${when}`, took(check.ms)]
    const label = CHECK_LABEL[kind].padEnd(5)

    return [
      `${CHECK_MARK[state]} ${label}   ${[...said, clip(check.command, 48)].filter(part => part !== '').join(' · ')}`,
    ]
  })

// Tests that passed and have seen no edit since.
export const hasFreshTests = (checks: readonly Check[]): boolean => {
  const tests = checkOf(checks, 'test')

  return tests !== undefined && tests.hasPassed && tests.editsSince === 0
}
