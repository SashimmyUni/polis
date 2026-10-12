import { expect, test } from 'claude-code/testing'

import {
  GIT_DIFF,
  GIT_STATUS,
  areaOfPath,
  areasOfFiles,
  gitLine,
  noteTouch,
  parseGit,
  taskOfEdit,
} from '../hooks/codemap'
import type { CodeTask, GitState } from '../hooks/codemap'
import type { AgentRun, AgentRunStatus, TaskStatus } from '../types'

const task = (id: string, status: TaskStatus, extra: Partial<CodeTask> = {}): CodeTask => ({
  id,
  subject: `Task ${id}`,
  status,
  area: 'general',
  blockedBy: [],
  source: 'task',
  ...extra,
})

const run = (key: string, status: AgentRunStatus, extra: Partial<AgentRun> = {}): AgentRun => ({
  key,
  label: key,
  type: 'general-purpose',
  status,
  tools: 0,
  families: {},
  tokens: 0,
  startedAt: 0,
  ...extra,
})

const state = (extra: Partial<GitState> = {}): GitState => ({
  branch: 'main',
  ahead: 0,
  behind: 0,
  files: 0,
  added: 0,
  removed: 0,
  untracked: 0,
  at: 0,
  ...extra,
})

const WIN = 'C:\\Work\\atlas'
const POSIX = '/work/atlas'

test('code area of a path: the directory its edits land in', () => {
  expect(areaOfPath('/work/atlas/server/db.ts', POSIX)).toBe('server')
  expect(areaOfPath('/work/atlas/server/deep/er/db.ts', POSIX)).toBe('server')
  expect(areaOfPath('server/db.ts', POSIX)).toBe('server')
  expect(areaOfPath('./server/db.ts', POSIX)).toBe('server')
  expect(areaOfPath('/work/atlas/./server/../ui/view.tsx', POSIX)).toBe('ui')

  // A file straight in the root, and a root written with a trailing separator.
  expect(areaOfPath('/work/atlas/README.md', POSIX)).toBe('root')
  expect(areaOfPath('/work/atlas/.gitignore', POSIX)).toBe('root')
  expect(areaOfPath('README.md', POSIX)).toBe('root')
  expect(areaOfPath('/work/atlas/server/db.ts', '/work/atlas/')).toBe('server')

  // Outside the root: elsewhere, a sibling that shares a prefix, the root itself,
  // a relative path that climbs out, and a root that differs in case on POSIX.
  expect(areaOfPath('/tmp/scratch/a.ts', POSIX)).toBeUndefined()
  expect(areaOfPath('/work/atlas-old/server/db.ts', POSIX)).toBeUndefined()
  expect(areaOfPath('/work/atlas', POSIX)).toBeUndefined()
  expect(areaOfPath('../other/a.ts', POSIX)).toBeUndefined()
  expect(areaOfPath('server/../../other/a.ts', POSIX)).toBeUndefined()
  expect(areaOfPath('/Work/Atlas/server/db.ts', POSIX)).toBeUndefined()
})

test('code area of a path: Windows separators and drive letters', () => {
  expect(areaOfPath('C:\\Work\\atlas\\server\\db.ts', WIN)).toBe('server')
  expect(areaOfPath('C:/Work/atlas/server/db.ts', WIN)).toBe('server')
  expect(areaOfPath('C:\\Work/atlas\\server/db.ts', 'C:/Work/atlas')).toBe('server')
  expect(areaOfPath('server\\db.ts', WIN)).toBe('server')
  expect(areaOfPath('C:\\Work\\atlas\\README.md', WIN)).toBe('root')
  expect(areaOfPath('C:\\Work\\atlas\\server\\db.ts', 'C:\\Work\\atlas\\')).toBe('server')

  // The drive and the folders of a Windows path differ in case without meaning more.
  expect(areaOfPath('c:\\work\\ATLAS\\server\\db.ts', WIN)).toBe('server')
  expect(areaOfPath('C:\\Work\\atlas\\Server\\db.ts', WIN)).toBe('server')

  expect(areaOfPath('D:\\Work\\atlas\\server\\db.ts', WIN)).toBeUndefined()
  expect(areaOfPath('C:\\Work\\atlas-old\\server\\db.ts', WIN)).toBeUndefined()
  expect(areaOfPath('C:\\Users\\jimmy\\notes.md', WIN)).toBeUndefined()
  expect(areaOfPath('..\\other\\a.ts', WIN)).toBeUndefined()
})

test('code area of a path: container directories pass the name on', () => {
  expect(areaOfPath('packages/web/src/x.ts', POSIX)).toBe('web')
  expect(areaOfPath('src/api/users.ts', POSIX)).toBe('api')
  expect(areaOfPath('src/index.ts', POSIX)).toBe('src')
  expect(areaOfPath('packages/web.ts', POSIX)).toBe('packages')
  expect(areaOfPath('crates/engine/src/lib.rs', POSIX)).toBe('engine')
  expect(areaOfPath('apps/admin/page.tsx', POSIX)).toBe('admin')
  expect(areaOfPath('internal/auth/token.go', POSIX)).toBe('auth')
  expect(areaOfPath('C:\\Work\\atlas\\packages\\web\\src\\x.ts', WIN)).toBe('web')
  expect(areaOfPath('C:\\Work\\atlas\\SRC\\Api\\users.ts', WIN)).toBe('api')

  // Every container the contract names.
  for (const dir of [
    'src', 'lib', 'app', 'apps', 'packages', 'libs', 'services', 'modules', 'crates',
    'cmd', 'internal', 'pkg', 'components',
  ]) {
    expect(areaOfPath(`${dir}/unit/a.ts`, POSIX)).toBe('unit')
  }
})

test('code area of a path: dot stripped, lower-cased, cut to 16 characters', () => {
  expect(areaOfPath('.github/workflows/ci.yml', POSIX)).toBe('github')
  expect(areaOfPath('src/.cache/x.json', POSIX)).toBe('cache')
  expect(areaOfPath('Docs/Guide.md', POSIX)).toBe('docs')
  expect(areaOfPath('a-very-long-directory-name/x.ts', POSIX)).toBe('a-very-long-dire')
  expect(areaOfPath('a-very-long-directory-name/x.ts', POSIX)?.length).toBe(16)
  expect(areaOfPath('.../x.ts', POSIX)).toBe('root')
})

test('an edit counts toward its task, which moves to the area it edits most', () => {
  const list = [task('1', 'in_progress'), task('2', 'pending')]
  const first = noteTouch(list, '1', 'api')
  expect(first[0]).toEqual({ ...list[0], area: 'api', areaFrom: 'code', touched: { api: 1 } })
  expect(first[1]).toEqual(list[1])
  expect(first.map(one => one.id)).toEqual(['1', '2'])

  // A busier area takes over only once it is ahead.
  const second = noteTouch(first, '1', 'ui')
  expect(second[0]?.area).toBe('api')
  expect(second[0]?.touched).toEqual({ api: 1, ui: 1 })
  const third = noteTouch(second, '1', 'ui')
  expect(third[0]?.area).toBe('ui')
  expect(third[0]?.areaFrom).toBe('code')
  expect(third[0]?.touched).toEqual({ api: 1, ui: 2 })
})

test('on a tie the area stays, and a tagged area is only counted', () => {
  const settled = [task('1', 'in_progress', { area: 'ui', areaFrom: 'code', touched: { api: 2, ui: 2 } })]
  // Level at 2 the task stays in ui, whatever a third area gets; an api edit
  // then leads (3 to 2); ui draws level again at 3 and api, now the current
  // area, is among the leaders.
  expect(noteTouch(settled, '1', 'docs')[0]?.area).toBe('ui')
  const ahead = noteTouch(settled, '1', 'api')
  expect(ahead[0]?.area).toBe('api')
  const level = noteTouch(ahead, '1', 'ui')
  expect(level[0]?.touched).toEqual({ api: 3, ui: 3 })
  expect(level[0]?.area).toBe('api')

  // Among leaders none of which is the current area, the first touched is taken.
  const away = [task('1', 'in_progress', { touched: { api: 1 } })]
  const tied = noteTouch(away, '1', 'ui')
  expect(tied[0]?.touched).toEqual({ api: 1, ui: 1 })
  expect(tied[0]?.area).toBe('api')

  // The model's tag stays, whatever the edits say.
  const tagged = [task('1', 'in_progress', { area: 'docs', areaFrom: 'tag' })]
  const edited = noteTouch(noteTouch(tagged, '1', 'api'), '1', 'api')
  expect(edited[0]?.area).toBe('docs')
  expect(edited[0]?.areaFrom).toBe('tag')
  expect(edited[0]?.touched).toEqual({ api: 2 })

  // A title guess gives way to the code.
  const guessed = [task('1', 'in_progress', { area: 'backend', areaFrom: 'title' })]
  expect(noteTouch(guessed, '1', 'server')[0]?.area).toBe('server')
  expect(noteTouch(guessed, '1', 'server')[0]?.areaFrom).toBe('code')
})

test('noting a touch never changes its input and ignores an unknown task', () => {
  const list = [
    task('1', 'in_progress', { touched: { api: 1 } }),
    task('2', 'pending'),
  ]
  const before = JSON.stringify(list)
  const next = noteTouch(list, '1', 'api')
  expect(JSON.stringify(list)).toBe(before)
  expect(next).not.toBe(list)
  expect(next[0]).not.toBe(list[0])
  expect(list[0]?.touched).toEqual({ api: 1 })
  expect(next[0]?.touched).toEqual({ api: 2 })

  const same = noteTouch(list, 'missing', 'api')
  expect(same).not.toBe(list)
  expect(same).toEqual(list)
  expect(JSON.stringify(list)).toBe(before)
  expect(noteTouch([], '1', 'api')).toEqual([])

  // An area named like something every object has is still just an area.
  const odd = noteTouch([task('1', 'in_progress')], '1', 'constructor')
  expect(odd[0]?.touched).toEqual({ constructor: 1 })
  expect(noteTouch(odd, '1', 'constructor')[0]?.touched).toEqual({ constructor: 2 })
})

test('an edit belongs to the task of the subagent that made it', () => {
  const tasks = [
    task('1', 'in_progress', { agentId: 'a1' }),
    task('2', 'in_progress', { agentId: 'a2' }),
    task('3', 'in_progress'),
  ]
  const agents = [
    run('k1', 'running', { agentId: 'a1', taskId: '2' }),
    run('k2', 'running', { agentId: 'a3' }),
  ]
  // The run's own match wins over the task that names the agent.
  expect(taskOfEdit(tasks, agents, 'a1')).toBe('2')
  // A run with no match falls back to what the agent recorded; a2 has no run at all.
  expect(taskOfEdit(tasks, agents, 'a2')).toBe('2')
  expect(taskOfEdit(tasks, agents, 'a3')).toBeUndefined()
  expect(taskOfEdit(tasks, agents, 'unknown')).toBeUndefined()

  // A run that has ended no longer speaks for the agent.
  const ended = [run('k1', 'done', { agentId: 'a1', taskId: '2' })]
  expect(taskOfEdit(tasks, ended, 'a1')).toBe('1')
  expect(taskOfEdit(tasks, [run('k1', 'failed', { agentId: 'a1', taskId: '2' })], 'a1')).toBe('1')
  expect(taskOfEdit(tasks, [run('k1', 'starting', { agentId: 'a1', taskId: '2' })], 'a1')).toBe('2')

  // Only an in-progress task counts as recorded by the agent; the last of several.
  const mixed = [
    task('1', 'completed', { agentId: 'a1' }),
    task('2', 'in_progress', { agentId: 'a1' }),
    task('3', 'in_progress', { agentId: 'a1' }),
    task('4', 'pending', { agentId: 'a1' }),
  ]
  expect(taskOfEdit(mixed, [], 'a1')).toBe('3')
  expect(taskOfEdit([task('1', 'pending', { agentId: 'a1' })], [], 'a1')).toBeUndefined()
})

test('an edit by the main loop belongs to the in-progress task nobody else holds', () => {
  const tasks = [
    task('1', 'completed'),
    task('2', 'in_progress', { agentId: 'a1' }),
    task('3', 'in_progress'),
    task('4', 'in_progress'),
    task('5', 'pending'),
  ]
  // Two are the main loop's own: the last in list order.
  expect(taskOfEdit(tasks, [], undefined)).toBe('4')

  // One of them is a running agent's: the other is left.
  expect(taskOfEdit(tasks, [run('k', 'running', { agentId: 'a9', taskId: '4' })], undefined)).toBe('3')
  expect(taskOfEdit(tasks, [run('k', 'starting', { taskId: '4' })], undefined)).toBe('3')

  // An agent that has finished lets go of its task.
  expect(taskOfEdit(tasks, [run('k', 'done', { agentId: 'a9', taskId: '4' })], undefined)).toBe('4')

  // Nothing left: every open task is held, or there is none.
  const held = [
    run('k1', 'running', { agentId: 'a8', taskId: '3' }),
    run('k2', 'running', { agentId: 'a9', taskId: '4' }),
  ]
  expect(taskOfEdit(tasks, held, undefined)).toBeUndefined()
  expect(taskOfEdit([task('1', 'completed'), task('2', 'pending')], [], undefined)).toBeUndefined()
  expect(taskOfEdit([], [], undefined)).toBeUndefined()
})

test('edited files are grouped by area, the busiest first, outside files left out', () => {
  const files = [
    { path: 'C:\\Work\\atlas\\server\\db.ts', edits: 2 },
    { path: 'C:\\Work\\atlas\\ui\\view.tsx', edits: 5 },
    { path: 'C:/Work/atlas/server/api.ts', edits: 4 },
    { path: 'C:\\Users\\jimmy\\notes.md', edits: 9 },
    { path: 'C:\\Work\\atlas\\README.md', edits: 1 },
    { path: 'C:\\Work\\atlas\\src\\ui\\button.tsx', edits: 1 },
  ]
  expect(areasOfFiles(files, WIN)).toEqual([
    { area: 'server', files: 2, edits: 6 },
    { area: 'ui', files: 2, edits: 6 },
    { area: 'root', files: 1, edits: 1 },
  ])
  expect(areasOfFiles(files, 'D:\\elsewhere')).toEqual([])
  expect(areasOfFiles([], WIN)).toEqual([])

  const busy = areasOfFiles(
    [
      { path: '/work/atlas/a/x.ts', edits: 1 },
      { path: '/work/atlas/b/x.ts', edits: 3 },
      { path: '/work/atlas/b/y.ts', edits: 1 },
    ],
    POSIX,
  )
  expect(busy.map(one => one.area)).toEqual(['b', 'a'])
  expect(busy[0]).toEqual({ area: 'b', files: 2, edits: 4 })
})

test('git commands are the two plain forms the parser reads', () => {
  expect(GIT_STATUS).toEqual(['git', 'status', '--porcelain=v2', '--branch'])
  expect(GIT_DIFF).toEqual(['git', 'diff', '--shortstat', 'HEAD'])
})

test('git state: branch, distance from upstream, changes and untracked files', () => {
  const status = [
    '# branch.oid 1f0e7b1c9d8a4b5c6d7e8f9a0b1c2d3e4f5a6b7c',
    '# branch.head main',
    '# branch.upstream origin/main',
    '# branch.ab +1 -2',
    '1 .M N... 100644 100644 100644 aaaa bbbb hooks/logic.ts',
    '1 M. N... 100644 100644 100644 aaaa bbbb tests/polis.test.ts',
    '1 A. N... 000000 100644 100644 0000 cccc hooks/codemap.ts',
    '2 R. N... 100644 100644 100644 aaaa bbbb R100 docs/NEW.md\tdocs/OLD.md',
    'u UU N... 100644 100644 100644 100644 aaaa bbbb cccc README.md',
    '? scratch.txt',
    '? notes/todo.md',
    '! dist/out.js',
    '',
  ].join('\n')
  const diff = ' 5 files changed, 120 insertions(+), 34 deletions(-)\n'

  expect(parseGit(status, diff, 42)).toEqual({
    branch: 'main',
    ahead: 1,
    behind: 2,
    files: 5,
    added: 120,
    removed: 34,
    untracked: 2,
    at: 42,
  })
})

test('git state: missing counts, no upstream, a fresh repository and Windows line ends', () => {
  const head = (name: string): string => `# branch.oid abc\r\n# branch.head ${name}\r\n`

  // The summary leaves out a count that is zero, and says 'file' for one.
  expect(parseGit(head('dev'), ' 1 file changed, 3 insertions(+)\n', 1)).toEqual(
    state({ branch: 'dev', added: 3, at: 1 }),
  )
  expect(parseGit(head('dev'), ' 2 files changed, 7 deletions(-)\n', 1)).toEqual(
    state({ branch: 'dev', removed: 7, at: 1 }),
  )
  expect(parseGit(head('dev'), ' 1 file changed, 1 insertion(+), 1 deletion(-)', 1)).toEqual(
    state({ branch: 'dev', added: 1, removed: 1, at: 1 }),
  )

  // Nothing changed, or a repository with no commit yet: the summary is empty.
  expect(parseGit(head('main'), '', 5)).toEqual(state({ branch: 'main', at: 5 }))
  expect(parseGit(head('main'), '\n', 5)).toEqual(state({ branch: 'main', at: 5 }))
  expect(parseGit('# branch.oid (initial)\n# branch.head master\n? first.txt\n', '', 5)).toEqual(
    state({ branch: 'master', untracked: 1, at: 5 }),
  )

  // Without an upstream there is no ahead/behind line; CRLF changes nothing.
  const crlf = head('feature/x') + '1 .M N... 100644 100644 100644 a b src/a.ts\r\n? b.txt\r\n'
  expect(parseGit(crlf, ' 1 file changed, 2 insertions(+), 1 deletion(-)\r\n', 9)).toEqual(
    state({ branch: 'feature/x', files: 1, added: 2, removed: 1, untracked: 1, at: 9 }),
  )

  // Behind only, and ignored files alone make a clean tree.
  const behind = head('main') + '# branch.upstream origin/main\r\n# branch.ab +0 -4\r\n! dist/\r\n'
  expect(parseGit(behind, '', 0)).toEqual(state({ behind: 4 }))
})

test('git state: a detached head keeps the name git gives it', () => {
  const status = [
    '# branch.oid 1f0e7b1c9d8a4b5c6d7e8f9a0b1c2d3e4f5a6b7c',
    '# branch.head (detached)',
    '1 .M N... 100644 100644 100644 aaaa bbbb a.ts',
  ].join('\n')
  const detached = parseGit(status, ' 1 file changed, 4 insertions(+), 4 deletions(-)', 3)
  expect(detached).toEqual(state({ branch: '(detached)', files: 1, added: 4, removed: 4, at: 3 }))
  expect(gitLine(detached ?? state())).toBe('(detached) · 1 file +4 −4')
})

test('git state: output that is not a repository gives nothing', () => {
  expect(parseGit('', '', 0)).toBeNull()
  expect(parseGit('fatal: not a git repository (or any of the parent directories): .git\n', '', 0)).toBeNull()
  expect(parseGit("'git' is not recognized as an internal or external command", '', 0)).toBeNull()
  // Entry lines without the branch header (git older than the flag, or cut off) are not trusted.
  expect(parseGit('1 .M N... 100644 100644 100644 a b src/a.ts\n? b.txt\n', ' 1 file changed, 1 insertion(+)', 0)).toBeNull()
  expect(parseGit('# branch.head \n', '', 0)).toBeNull()
})

test('the git row reads as one plain line', () => {
  expect(gitLine(state({ files: 5, added: 120, removed: 34, untracked: 2 }))).toBe(
    'main · 5 files +120 −34 · 2 untracked',
  )
  expect(gitLine(state({ ahead: 1, behind: 2, files: 1, added: 3 }))).toBe('main ↑1 ↓2 · 1 file +3 −0')
  expect(gitLine(state())).toBe('main · clean')

  expect(gitLine(state({ ahead: 3 }))).toBe('main ↑3 · clean')
  expect(gitLine(state({ behind: 1, untracked: 1 }))).toBe('main ↓1 · 1 untracked')
  expect(gitLine(state({ untracked: 4 }))).toBe('main · 4 untracked')
  expect(gitLine(state({ files: 2, added: 10, removed: 0 }))).toBe('main · 2 files +10 −0')
  // A change with no tracked file in the status (the two commands ran a moment apart).
  expect(gitLine(state({ added: 2, removed: 1 }))).toBe('main · +2 −1')

  const long = gitLine(state({ branch: 'feature/a-really-long-branch-name-for-testing' }))
  expect(long).toBe('feature/a-really-long-b… · clean')
  expect(long).toContain('…')
  expect(gitLine(state({ branch: 'x'.repeat(24) }))).toBe(`${'x'.repeat(24)} · clean`)
  expect(gitLine(state({ branch: 'x'.repeat(25) }))).toBe(`${'x'.repeat(23)}… · clean`)

  for (const one of [state(), state({ files: 9, added: 9, removed: 9, untracked: 9, ahead: 9, behind: 9 })]) {
    expect(gitLine(one)).not.toMatch(/[\r\n\t]/)
  }
})
