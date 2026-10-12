import { expect, test } from 'claude-code/testing'

import {
  CHECK_KINDS,
  CHECK_LABEL,
  CHECK_MARK,
  checkLines,
  checksLine,
  checksOf,
  hasFreshTests,
  noteEdit,
  outcomeOf,
  recordChecks,
  stateOf,
} from '../hooks/checks'
import type { Check, CheckKind } from '../hooks/checks'

const check = (kind: CheckKind, extra: Partial<Check> = {}): Check => ({
  kind,
  hasPassed: true,
  at: 0,
  ms: 1000,
  command: `run ${kind}`,
  editsSince: 0,
  ...extra,
})

const ran = { hasPassed: true, at: 1000, ms: 4100, command: 'npm test' }

test('the kinds are shown in a fixed order with a label and a mark each', () => {
  expect(CHECK_KINDS).toEqual(['test', 'lint', 'types', 'build'])
  expect(CHECK_LABEL).toEqual({ test: 'tests', lint: 'lint', types: 'types', build: 'build' })
  expect(CHECK_MARK).toEqual({ passed: '✔', failed: '✘', stale: '◌' })
})

test('a command that runs a check is classified', () => {
  const table: [string, CheckKind[]][] = [
    ['npm test', ['test']],
    ['npm run test', ['test']],
    ['npm run test:unit', ['test']],
    ['npm run test -- --watch=false', ['test']],
    ['npm run-script test', ['test']],
    ['npm --silent run lint', ['lint']],
    ['pnpm test', ['test']],
    ['pnpm run lint:fix', ['lint']],
    ['pnpm --filter web run build', ['build']],
    ['pnpm -r build', ['build']],
    ['yarn test', ['test']],
    ['yarn workspace app build:prod', ['build']],
    ['yarn typecheck', ['types']],
    ['bun test', ['test']],
    ['bun run type-check', ['types']],
    ['bun run check-types', ['types']],
    ['npm run build', ['build']],
    ['turbo run build', ['build']],
    ['npx vitest run', ['test']],
    ['npx -y jest --ci', ['test']],
    ['npx --no-install tsc --noEmit', ['types']],
    ['bunx eslint .', ['lint']],
    ['pnpm exec vitest', ['test']],
    ['pnpm dlx mocha', ['test']],
    ['npm exec -- tsc -p .', ['types']],
    ['vitest', ['test']],
    ['jest src', ['test']],
    ['mocha test/*.js', ['test']],
    ['playwright test', ['test']],
    ['npx playwright test --project=chromium', ['test']],
    ['pytest -q', ['test']],
    ['python -m pytest tests', ['test']],
    ['python3 -m unittest discover', ['test']],
    ['py -m pytest', ['test']],
    ['uv run pytest', ['test']],
    ['poetry run mypy src', ['types']],
    ['tox -e py312', ['test']],
    ['cargo test', ['test']],
    ['cargo +nightly test --release', ['test']],
    ['cargo build --release', ['build']],
    ['cargo check', ['types']],
    ['cargo clippy -- -D warnings', ['lint']],
    ['go test ./...', ['test']],
    ['go build ./cmd/app', ['build']],
    ['go vet ./...', ['lint']],
    ['dotnet test', ['test']],
    ['dotnet build -c Release', ['build']],
    ['mvn test', ['test']],
    ['mvn -q clean package', ['build']],
    ['./mvnw test', ['test']],
    ['gradle test', ['test']],
    ['./gradlew build', ['build']],
    ['./gradlew :app:test', ['test']],
    ['tsc', ['types']],
    ['tsc --noEmit -p tsconfig.json', ['types']],
    ['eslint src --fix', ['lint']],
    ['biome lint .', ['lint']],
    ['biome check --write', ['lint']],
    ['ruff check .', ['lint']],
    ['flake8 src', ['lint']],
    ['mypy .', ['types']],
    ['pyright', ['types']],
    ['make test', ['test']],
    ['make -j4 lint', ['lint']],
    ['make build', ['build']],
    ['make check', ['test']],
    ['make test-unit', ['test']],
    ['claude plugin test .', ['test']],
    ['claude plugin validate .', ['lint']],
  ]
  for (const [command, kinds] of table) {
    expect({ command, kinds: checksOf(command) }).toEqual({ command, kinds })
  }
})

test('a command that only mentions the words runs no check', () => {
  const commands = [
    '',
    '   ',
    'echo "npm test"',
    "echo 'run pytest && cargo test'",
    'git commit -m "fix tests"',
    'git commit -m "npm run lint" && git push',
    'grep -r test .',
    'rg lint src',
    'cat package.json',
    'ls tests',
    'npm install',
    'npm ci',
    'npm run dev',
    'npm run start',
    'npm run testing-helpers',
    'npm install test',
    'pnpm add -D vitest',
    'yarn',
    'pip install pytest',
    'cargo run',
    'go run main.go',
    'git status',
    'cd tests',
    'ruff format .',
    'make install',
    'python script.py',
    'node build.js',
  ]
  for (const command of commands) {
    expect({ command, kinds: checksOf(command) }).toEqual({ command, kinds: [] })
  }
})

test('chained commands give every check once, in display order', () => {
  expect(checksOf('npm run build && npm test')).toEqual(['test', 'build'])
  expect(checksOf('npm run lint; npm run typecheck; npm test')).toEqual(['test', 'lint', 'types'])
  expect(checksOf('tsc --noEmit | tail -20')).toEqual(['types'])
  expect(checksOf('npm test && npm test')).toEqual(['test'])
  expect(checksOf('npm test || echo failed')).toEqual(['test'])
  expect(checksOf('npm run lint\nnpm test')).toEqual(['test', 'lint'])
  expect(checksOf('npm run lint \\\n  && npm test')).toEqual(['test', 'lint'])
  expect(checksOf('npm test &')).toEqual(['test'])
  expect(checksOf('(cd web && npm test)')).toEqual(['test'])
  expect(checksOf('npm test 2>&1 | tail')).toEqual(['test'])
  expect(checksOf('npm test > out.txt 2>&1')).toEqual(['test'])
  expect(checksOf('echo "a && npm test" && ls')).toEqual([])
})

test('a prefix, an environment assignment or a path does not hide the check', () => {
  expect(checksOf('cd web && npm test')).toEqual(['test'])
  expect(checksOf('cd "C:\\My Projects\\app" && npm run build')).toEqual(['build'])
  expect(checksOf('CI=1 npm test')).toEqual(['test'])
  expect(checksOf('CI=1 NODE_ENV=test npx -y vitest run')).toEqual(['test'])
  expect(checksOf('cross-env CI=1 jest')).toEqual(['test'])
  expect(checksOf('env FOO=1 pytest')).toEqual(['test'])
  expect(checksOf('time cargo test')).toEqual(['test'])
  expect(checksOf('"C:\\Program Files\\nodejs\\npm.cmd" test')).toEqual(['test'])
  expect(checksOf('& "C:\\Program Files\\nodejs\\npm.cmd" run lint')).toEqual(['lint'])
  expect(checksOf('node_modules/.bin/vitest run')).toEqual(['test'])
  expect(checksOf('.\\node_modules\\.bin\\tsc.cmd --noEmit')).toEqual(['types'])
  expect(checksOf('/usr/bin/pytest')).toEqual(['test'])
  expect(checksOf('bash -c "npm test && npm run lint"')).toEqual(['test', 'lint'])
  expect(checksOf("sh -lc 'cd app && cargo build'")).toEqual(['build'])
  expect(checksOf('powershell -Command npm test')).toEqual(['test'])
  expect(checksOf('pwsh -NoProfile -Command "dotnet build"')).toEqual(['build'])
  expect(checksOf('cmd /c npm run build')).toEqual(['build'])
  expect(checksOf('if npm test; then echo ok; fi')).toEqual(['test'])
  expect(checksOf('Set-Location web; npm run lint')).toEqual(['lint'])
})

test('the outcome of a clean, a failed, a backgrounded, an interrupted and a denied call', () => {
  const clean = {
    result: { stdout: 'ok', stderr: '', interrupted: false },
    text: 'ok',
    ref: 3,
  }
  expect(outcomeOf(clean)).toBe(true)
  expect(outcomeOf(clean, { command: 'npm test' })).toBe(true)
  expect(outcomeOf(clean, { command: 'npm test', run_in_background: false })).toBe(true)
  // A hook's own answer carries no text.
  expect(outcomeOf({ result: { stdout: '', stderr: '', interrupted: false } })).toBe(true)
  expect(outcomeOf({ result: { stdout: 'x', stderr: '', interrupted: false, returnCodeInterpretation: 'No matches' } })).toBe(true)

  const failed = {
    isError: true,
    result: 'Exit code 1\nFAIL src/a.test.ts',
    text: 'Exit code 1\nFAIL src/a.test.ts',
  }
  expect(outcomeOf(failed)).toBe(false)
  expect(outcomeOf({ isError: true, result: undefined, text: 'Exit code 137' })).toBe(false)
  expect(outcomeOf({ isError: true, result: 'Exit code 2' })).toBe(false)
  expect(outcomeOf({ isError: true, result: undefined, text: 'Error: spawn ENOENT' })).toBe(false)
  expect(outcomeOf({ isError: true, result: undefined })).toBe(false)
  // A failing run that prints the word still failed.
  expect(outcomeOf({ isError: true, text: 'Exit code 1\ntest was interrupted' })).toBe(false)

  expect(
    outcomeOf({ result: { stdout: '', stderr: '', interrupted: false, backgroundTaskId: 'b1' }, text: 'x' }),
  ).toBeUndefined()
  expect(outcomeOf(clean, { command: 'npm test', run_in_background: true })).toBeUndefined()
  expect(
    outcomeOf({ result: { stdout: '', stderr: '', interrupted: false, timedOutAfterMs: 120000 } }),
  ).toBeUndefined()
  expect(
    outcomeOf({ result: { stdout: '', stderr: '', interrupted: false, backgroundedByUser: true } }),
  ).toBeUndefined()

  expect(outcomeOf({ result: { stdout: 'half', stderr: '', interrupted: true }, text: 'half' })).toBeUndefined()
  expect(outcomeOf({ isError: true, text: '[Request interrupted by user for tool use]' })).toBeUndefined()
  expect(outcomeOf({ isError: true, text: 'Command was aborted before completion' })).toBeUndefined()

  expect(outcomeOf({ deny: 'blocked by policy' })).toBe(false)
  expect(outcomeOf({ deny: 'no' }, { command: 'npm test', run_in_background: true })).toBe(false)
})

test('an answer of no known shape has no outcome', () => {
  expect(outcomeOf(undefined)).toBeUndefined()
  expect(outcomeOf(null)).toBeUndefined()
  expect(outcomeOf('done')).toBeUndefined()
  expect(outcomeOf(42)).toBeUndefined()
  expect(outcomeOf({})).toBeUndefined()
  expect(outcomeOf({ result: { rows: [] } })).toBeUndefined()
  expect(outcomeOf({ result: 'text only' })).toBe(true)
})

test('running a check replaces its kind and keeps the others in order', () => {
  const before = [check('lint', { at: 5, editsSince: 2 }), check('build')]
  const copy = JSON.parse(JSON.stringify(before)) as Check[]
  const after = recordChecks(before, ['test', 'types'], ran)
  expect(after.map(one => one.kind)).toEqual(['test', 'lint', 'types', 'build'])
  expect(after[0]).toEqual({ kind: 'test', ...ran, editsSince: 0 })
  expect(after[2]).toEqual({ kind: 'types', ...ran, editsSince: 0 })
  expect(after[1]).toEqual(before[0])
  expect(after[3]).toEqual(before[1])
  // The input is left as it was.
  expect(before).toEqual(copy)

  const again = recordChecks(after, ['lint'], { hasPassed: false, at: 9, ms: 10, command: 'eslint .' })
  expect(again.map(one => one.kind)).toEqual(['test', 'lint', 'types', 'build'])
  expect(again[1]).toEqual({ kind: 'lint', hasPassed: false, at: 9, ms: 10, command: 'eslint .', editsSince: 0 })
  expect(recordChecks([], [], ran)).toEqual([])
  expect(recordChecks([], ['build'], ran)).toHaveLength(1)
})

test('an edit makes every check one edit older', () => {
  const before = [check('test'), check('lint', { editsSince: 2 })]
  const after = noteEdit(before)
  expect(after.map(one => one.editsSince)).toEqual([1, 3])
  expect(before.map(one => one.editsSince)).toEqual([0, 2])
  expect(noteEdit(noteEdit(before)).map(one => one.editsSince)).toEqual([2, 4])

  const none: Check[] = []
  expect(noteEdit(none)).toBe(none)
})

test('a check passes, goes stale with an edit, and stays failed once failed', () => {
  expect(stateOf(check('test'))).toBe('passed')
  expect(stateOf(check('test', { editsSince: 1 }))).toBe('stale')
  expect(stateOf(check('test', { editsSince: 9 }))).toBe('stale')
  expect(stateOf(check('test', { hasPassed: false }))).toBe('failed')
  expect(stateOf(check('test', { hasPassed: false, editsSince: 4 }))).toBe('failed')

  let checks = recordChecks([], ['test'], ran)
  expect(stateOf(checks[0] as Check)).toBe('passed')
  checks = noteEdit(checks)
  expect(stateOf(checks[0] as Check)).toBe('stale')
  checks = recordChecks(checks, ['test'], ran)
  expect(stateOf(checks[0] as Check)).toBe('passed')
  checks = noteEdit(recordChecks(checks, ['test'], { ...ran, hasPassed: false }))
  expect(stateOf(checks[0] as Check)).toBe('failed')
})

test('fresh tests are tests that passed with no edit since', () => {
  expect(hasFreshTests([])).toBe(false)
  expect(hasFreshTests([check('lint'), check('build')])).toBe(false)
  expect(hasFreshTests([check('test')])).toBe(true)
  expect(hasFreshTests([check('test', { editsSince: 1 })])).toBe(false)
  expect(hasFreshTests([check('test', { hasPassed: false })])).toBe(false)
  expect(hasFreshTests([check('lint', { editsSince: 3 }), check('test')])).toBe(true)
})

test('the compact line names only the kinds that ran', () => {
  expect(checksLine([])).toBe('')
  expect(checksLine([check('lint', { hasPassed: false })])).toBe('lint ✘')
  expect(
    checksLine([
      check('types', { editsSince: 3 }),
      check('lint', { hasPassed: false }),
      check('test'),
    ]),
  ).toBe('tests ✔ · lint ✘ · types ◌')
  expect(checksLine([check('build'), check('test')])).toBe('tests ✔ · build ✔')
})

test('the lines of the Checks section say how long ago and what ran', () => {
  const now = 20 * 60_000
  const lines = checkLines(
    [
      check('types', { at: now - 12 * 60_000, editsSince: 3, command: 'tsc --noEmit' }),
      check('test', { at: now - 2 * 60_000, ms: 4100, command: 'npm test' }),
      check('lint', { at: now - 5 * 60_000, ms: 2000, hasPassed: false, command: 'npm run lint' }),
    ],
    now,
  )
  expect(lines).toEqual([
    '✔ tests   passed 2m ago · 4.1s · npm test',
    '✘ lint    failed 5m ago · 2.0s · npm run lint',
    '◌ types   stale: 3 edits since it passed 12m ago · tsc --noEmit',
  ])
  expect(checkLines([], now)).toEqual([])

  const [fresh, one, long, hour] = [
    checkLines([check('build', { at: now - 20_000, ms: 340 })], now),
    checkLines([check('build', { at: now - 90_000, editsSince: 1 })], now),
    checkLines([check('test', { at: now, ms: 75_000, command: 'x'.repeat(80) })], now),
    checkLines([check('test', { at: 0, ms: 12_300 })], 135 * 60_000),
  ]
  expect(fresh).toEqual(['✔ build   passed just now · 340ms · run build'])
  expect(one).toEqual(['◌ build   stale: 1 edit since it passed 2m ago · run build'])
  expect(long[0]).toBe(`✔ tests   passed just now · 1m15s · ${'x'.repeat(47)}…`)
  expect(hour[0]).toBe('✔ tests   passed 2h15m ago · 12s · run test')
  // A clock that went back never prints a negative time.
  expect(checkLines([check('test', { at: now + 5000 })], now)[0]).toContain('just now')
})
