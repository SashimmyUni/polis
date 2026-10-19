import { expect, test } from 'claude-code/testing'

import { newProject } from '../hooks/logic'
import { REPORT_FILE, reportOf } from '../hooks/report'
import type { ReportInput } from '../hooks/report'
import type { AgentRun, FileHit, TaskStatus, Usage } from '../types'

// 2026-10-12 14:30 UTC.
const NOW = Date.UTC(2026, 9, 12, 14, 30)

const MINUTE = 60_000

const USAGE: Usage = {
  contextTokens: 84_000,
  contextWindow: 200_000,
  contextPercent: 42,
  rateLimits: [],
  costUsd: 1.234,
  sessionTokens: 1_200_000,
  mainFamilies: {},
  zoneLimit: 150_000,
  zoneAnnounced: 'inside',
  zoneOwed: 'inside',
}

const task = (
  id: string,
  subject: string,
  status: TaskStatus,
  extra: Partial<ReportInput['tasks'][number]> = {},
): ReportInput['tasks'][number] => ({
  id,
  subject,
  status,
  area: 'general',
  blockedBy: [],
  source: 'task',
  ...extra,
})

const agent = (key: string): AgentRun => ({
  key,
  label: 'Check the parser',
  type: 'worker',
  status: 'done',
  tools: 4,
  families: {},
  tokens: 1000,
  startedAt: 0,
})

// A session that has done nothing yet.
const EMPTY: ReportInput = {
  now: NOW,
  project: null,
  tasks: [],
  agents: [],
  files: [],
  usage: { ...USAGE, contextTokens: 0, contextPercent: 0, costUsd: 0, sessionTokens: 0 },
}

const files = (count: number, root: string): FileHit[] =>
  Array.from({ length: count }, (_, index) => ({ path: `${root}/src/f${index + 1}.ts`, edits: index + 1 }))

const FULL: ReportInput = {
  now: NOW,
  project: { ...newProject('C:\\work\\atlas', 0), name: 'Atlas', phase: 'Parser rewrite' },
  root: 'C:\\work\\atlas',
  tasks: [
    task('1', 'Write the lexer', 'completed', { area: 'backend', verdict: { state: 'passed', by: 'verifier' } }),
    task('2', 'Write the parser', 'completed', { area: 'backend', verdict: { state: 'failed', by: 'verifier' } }),
    task('2a', 'Handle comments', 'completed', { area: 'backend', parentId: '2' }),
    task('2b', 'Handle strings', 'pending', { area: 'backend', parentId: '2' }),
    task('2c', 'Handle escapes', 'pending', { area: 'backend', parentId: '2b' }),
    task('3', 'Document the grammar', 'completed', { area: 'docs' }),
    task('4', 'Wire the CLI', 'in_progress', { area: 'ops' }),
    task('4a', 'Parse the flags', 'completed', { area: 'ops', parentId: '4' }),
    task('4b', 'Print the help', 'in_progress', { area: 'ops', parentId: '4' }),
    task('5', 'Publish a release', 'pending', { area: 'ops' }),
    task('6', 'Profile the lexer', 'pending'),
  ],
  agents: [agent('a'), agent('b'), agent('c')],
  files: [
    { path: 'C:\\work\\atlas\\README.md', edits: 1 },
    { path: 'c:\\work\\atlas\\tests\\lexer.test.ts', edits: 3 },
    { path: 'C:\\work\\atlas\\hooks\\lexer.ts', edits: 7 },
  ],
  usage: USAGE,
  turns: 14,
  checks: [
    { kind: 'tests', state: 'passed', command: 'npm test', at: NOW - 2 * MINUTE },
    { kind: 'lint', state: 'failed', command: 'npm run lint | tail', at: NOW - 5 * MINUTE },
    { kind: 'types', state: 'stale', command: 'tsc -p .', at: NOW - 60 * MINUTE },
  ],
  git: { branch: 'feature/parser', files: 3, added: 120, removed: 30, untracked: 1 },
  limits: [
    { label: '5-hour limit', percentUsed: 31, note: 'resets in 2h' },
    { label: 'Weekly', percentUsed: 8 },
  ],
}

test('session report: a full session, in order', () => {
  expect(REPORT_FILE).toBe('polis-report.md')

  const report = reportOf(FULL)
  expect(report).toBe(
    [
      '# Atlas — session report',
      '',
      // The project tool's free-text phase is not shown.
      '2026-10-12 · branch feature/parser (3 files changed, +120 -30, 1 untracked)',
      '',
      '## Summary',
      '',
      '- Tasks: 3 of 6 done (1 verified, 1 failed its check) · 1 in progress · 2 waiting',
      '- Files: 3 files edited, 11 edits',
      '- Checks: tests passed · lint failed · types stale',
      '- Cost: $1.23 · 1.2M tokens · 3 agents · 14 prompts',
      '',
      '## Done',
      '',
      '- [x] Write the lexer (backend) — verified',
      '- [x] Write the parser (backend) — failed its check',
      '  - [x] Handle comments (backend)',
      '  - [ ] Handle strings (backend)',
      '    - [ ] Handle escapes (backend)',
      '- [x] Document the grammar (docs)',
      '',
      '## In progress',
      '',
      '- Wire the CLI (ops)',
      '  - [x] Parse the flags (ops)',
      '  - [ ] Print the help (ops)',
      '',
      '## Not started',
      '',
      '- Publish a release (ops)',
      '- Profile the lexer (general)',
      '',
      '## Files changed',
      '',
      '- `hooks/lexer.ts` — 7 edits',
      '- `tests/lexer.test.ts` — 3 edits',
      '- `README.md` — 1 edit',
      '',
      '## Checks',
      '',
      '| Check | Result | Command | When |',
      '| --- | --- | --- | --- |',
      '| tests | passed | `npm test` | 2m ago |',
      '| lint | failed | `npm run lint \\| tail` | 5m ago |',
      '| types | stale | `tsc -p .` | 1h ago |',
      '',
      '## Usage',
      '',
      '- Context window: 42% (84k of 200k tokens)',
      '- 5-hour limit: 31% used (resets in 2h)',
      '- Weekly: 8% used',
      '- Session cost: $1.23 (1.2M tokens)',
      '',
    ].join('\n'),
  )

  // Something a person pastes unchanged: no markup of the page's own, no emoji.
  expect(report).not.toMatch(/<[a-z/!]/i)
  expect(report).not.toMatch(/\p{Extended_Pictographic}/u)
  expect(report).not.toMatch(/[ \t]+$/m)
})

test('session report: an empty session is a short report', () => {
  const report = reportOf(EMPTY)
  expect(report).toBe(
    [
      '# Session report',
      '',
      '2026-10-12',
      '',
      '## Summary',
      '',
      '- Cost: $0.00 · 0 tokens · no agents',
      '',
      '## Usage',
      '',
      '- Context window: 0% (0 of 200k tokens)',
      '- Session cost: $0.00 (0 tokens)',
      '',
    ].join('\n'),
  )
  for (const heading of ['## Done', '## In progress', '## Not started', '## Files changed', '## Checks']) {
    expect(report).not.toContain(heading)
  }
})

test('session report: a task carries its verdict, and the summary counts them', () => {
  const report = reportOf({
    ...EMPTY,
    tasks: [
      task('1', 'Passed one', 'completed', { verdict: { state: 'passed', by: 'verifier' } }),
      task('2', 'Failed one', 'completed', { verdict: { state: 'failed', by: 'verifier' } }),
      task('3', 'Failed two', 'completed', { verdict: { state: 'failed', by: 'tests' } }),
      task('4', 'Never checked', 'completed'),
      task('5', 'Reopened after a failure', 'in_progress', { verdict: { state: 'failed', by: 'tests' } }),
    ],
  })
  expect(report).toContain('- Tasks: 4 of 5 done (1 verified, 2 failed their check) · 1 in progress\n')
  expect(report).toContain('- [x] Passed one (general) — verified\n')
  expect(report).toContain('- [x] Failed one (general) — failed its check\n')
  expect(report).toContain('- [x] Failed two (general) — failed its check\n')
  expect(report).toContain('- [x] Never checked (general)\n')
  expect(report).toContain('- Reopened after a failure (general) — failed its check\n')

  const plain = reportOf({ ...EMPTY, tasks: [task('1', 'Plain', 'completed')] })
  expect(plain).toContain('- Tasks: 1 of 1 done\n')
  expect(plain).not.toContain('verified')
})

test('session report: paths print relative to the root, with forward slashes', () => {
  const hit = (path: string, edits: number): FileHit => ({ path, edits })
  const windows = reportOf({
    ...EMPTY,
    // A trailing separator on the root, mixed separators in the paths, a
    // lower-case drive letter: all one folder to Windows.
    root: 'C:\\Users\\jimmy\\proj\\',
    files: [
      hit('C:\\Users\\jimmy\\proj\\src\\a.ts', 6),
      hit('c:\\users\\jimmy\\proj\\src\\deep\\b.ts', 5),
      hit('C:/Users/jimmy/proj/c.ts', 4),
      hit('D:\\other\\d.ts', 3),
      hit('C:\\Users\\jimmy\\project2\\e.ts', 2),
    ],
  })
  expect(windows).toContain('- `src/a.ts` — 6 edits\n')
  expect(windows).toContain('- `src/deep/b.ts` — 5 edits\n')
  expect(windows).toContain('- `c.ts` — 4 edits\n')
  // Outside the root, and a sibling that only shares its start: left whole.
  expect(windows).toContain('- `D:/other/d.ts` — 3 edits\n')
  expect(windows).toContain('- `C:/Users/jimmy/project2/e.ts` — 2 edits\n')
  expect(windows).not.toContain('\\')

  const posix = reportOf({
    ...EMPTY,
    root: '/work/atlas',
    files: [hit('/work/atlas/x.ts', 2), hit('/work/Atlas/y.ts', 1)],
  })
  expect(posix).toContain('- `x.ts` — 2 edits\n')
  expect(posix).toContain('- `/work/Atlas/y.ts` — 1 edit\n')

  const bare = reportOf({ ...EMPTY, files: [hit('C:\\a\\b.ts', 1)] })
  expect(bare).toContain('- `C:/a/b.ts` — 1 edit\n')
})

test('session report: the fifteen most-edited files, then how many more', () => {
  const report = reportOf({ ...EMPTY, root: '/w', files: files(20, '/w') })
  const listed = report.split('\n').filter(line => line.startsWith('- `'))
  expect(listed).toHaveLength(15)
  expect(listed[0]).toBe('- `src/f20.ts` — 20 edits')
  expect(listed[14]).toBe('- `src/f6.ts` — 6 edits')
  expect(report).not.toContain('src/f5.ts')
  expect(report).toContain('- `src/f6.ts` — 6 edits\n- and 5 more\n')
  expect(report).toContain('- Files: 20 files edited, 210 edits\n')

  const exact = reportOf({ ...EMPTY, root: '/w', files: files(15, '/w') })
  expect(exact).toContain('- `src/f1.ts` — 1 edit\n')
  expect(exact).not.toContain(' more')
})

test('session report: a section with nothing to say is left out', () => {
  // Tasks alone: no files, checks, git, limits, prompts, project.
  const tasksOnly = reportOf({ ...EMPTY, tasks: [task('1', 'Only a plan', 'pending')] })
  expect(tasksOnly).toContain('## Not started\n\n- Only a plan (general)\n')
  for (const heading of ['## Done', '## In progress', '## Files changed', '## Checks']) {
    expect(tasksOnly).not.toContain(heading)
  }
  expect(tasksOnly).toContain('- Tasks: 0 of 1 done · 1 waiting\n')
  expect(tasksOnly).not.toContain('- Files:')
  expect(tasksOnly).not.toContain('- Checks:')
  expect(tasksOnly).not.toContain('prompt')
  expect(tasksOnly).not.toContain('branch')

  // Checks alone.
  const checksOnly = reportOf({
    ...EMPTY,
    checks: [{ kind: 'tests', state: 'passed', command: 'npm test', at: NOW - 30_000 }],
  })
  expect(checksOnly).toContain('- Checks: tests passed\n')
  expect(checksOnly).toContain('## Checks\n\n| Check | Result | Command | When |\n')
  expect(checksOnly).toContain('| tests | passed | `npm test` | 30s ago |\n')
  expect(checksOnly).not.toContain('- Tasks:')
  expect(checksOnly).not.toContain('## Done')

  // The project's name, with nothing else; a git of `null` is none.
  const named = reportOf({
    ...EMPTY,
    project: { ...newProject('/work/atlas', 0), name: 'Atlas', phase: '' },
    git: null,
  })
  expect(named.startsWith('# Atlas — session report\n\n2026-10-12\n\n## Summary\n')).toBe(true)

  // Without limits the usage section holds the window and the cost.
  expect(reportOf(EMPTY).match(/^- /gm)).toHaveLength(3)
  expect(reportOf({ ...EMPTY, limits: [] })).toBe(reportOf(EMPTY))
})

test('session report: the details of the header, the checks and the cost', () => {
  const header = (git: ReportInput['git']): string => reportOf({ ...EMPTY, git }).split('\n')[2] ?? ''
  expect(header({ branch: 'main', files: 0, added: 0, removed: 0, untracked: 0 })).toBe(
    '2026-10-12 · branch main (clean)',
  )
  expect(header({ branch: 'main', files: 1, added: 4, removed: 0, untracked: 0 })).toBe(
    '2026-10-12 · branch main (1 file changed, +4 -0)',
  )
  expect(header({ branch: 'main', files: 0, added: 0, removed: 0, untracked: 2 })).toBe(
    '2026-10-12 · branch main (2 untracked)',
  )
  expect(header({ branch: '', files: 0, added: 0, removed: 0, untracked: 0 })).toBe(
    '2026-10-12 · detached HEAD (clean)',
  )

  // The date is the UTC day of `now`, and a `now` that is no date is left out.
  expect(reportOf({ ...EMPTY, now: Date.UTC(2026, 0, 1, 23, 59) })).toContain('\n\n2026-01-01\n')
  expect(reportOf({ ...EMPTY, now: Number.NaN }).startsWith('# Session report\n\n## Summary\n')).toBe(true)

  // Of a check that ran twice, the later run is the one told.
  const rerun = reportOf({
    ...EMPTY,
    checks: [
      { kind: 'tests', state: 'failed', command: 'npm test', at: NOW - 20 * MINUTE },
      { kind: 'tests', state: 'passed', command: 'npm test', at: NOW - 90_000 },
    ],
  })
  expect(rerun).toContain('- Checks: tests passed\n')
  expect(rerun).toContain('| tests | passed | `npm test` | 1m ago |\n')
  expect(rerun).not.toContain('failed')

  // When it ran: seconds, minutes, hours, days; and not in the future.
  const when = (ms: number): string =>
    reportOf({ ...EMPTY, checks: [{ kind: 'x', state: 'passed', command: '', at: NOW - ms }] })
      .split('\n')
      .find(line => line.startsWith('| x '))
      ?.split('|')[4]
      ?.trim() ?? ''
  expect(when(3_000)).toBe('just now')
  expect(when(-5_000)).toBe('just now')
  expect(when(45_000)).toBe('45s ago')
  expect(when(59 * MINUTE)).toBe('59m ago')
  expect(when(26 * 60 * MINUTE)).toBe('1d ago')

  // A singular is a singular.
  const one = reportOf({ ...EMPTY, agents: [agent('a')], turns: 1 })
  expect(one).toContain('- Cost: $0.00 · 0 tokens · 1 agent · 1 prompt\n')
})
