// Development only: Polis's overhead (GLOSSARY.md), measured with Claude Code
// itself. No tokenizer ships with the mod and the token-counting API needs a
// key, so every count is a difference between two `claude -p` runs: the input
// of a run's first request (input + cache creation + cache read) is
// deterministic, so what one change adds to it is exact, to a token or two at
// the boundary where an appended text meets what precedes it.
//   node --import ./tools/ts-resolve.mjs tools/overhead.ts static [--model haiku]
//   node --import ./tools/ts-resolve.mjs tools/overhead.ts sessions [--model sonnet] [--repeat 1] [--jobs 4] [--out file.json]
// `static` counts each fixed piece; `sessions` replays three scripted prompts
// with Polis removed, with `guidance: false`, on as a headless run sends it,
// and on as a session where a surface draws sends it (the standing instruction
// appended to the system prompt, which a headless run leaves out), and reports
// the tokens each session processed per model and the tool calls Polis prompts.
// Every run leaves out the claude.ai Artifact tool and MCP servers: a cloud
// session's Artifact tool shrinks its own schema when any mod hooks every tool
// call, which would read as a saving Polis does not make.
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { SIZING_RUBRIC, zoneNote } from '../hooks/logic'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const flag = (name: string, fallback: string): string => {
  const at = argv.indexOf(`--${name}`)

  return at >= 0 ? (argv[at + 1] ?? fallback) : fallback
}
const PLAIN = ['--strict-mcp-config', '--disallowedTools', 'Artifact', '--no-session-persistence']
const PROBE = 'Reply with the single word OK.'

type Condition = 'off' | 'guidance false' | 'on, headless' | 'on, drawn'
const CONDITIONS: Condition[] = ['off', 'guidance false', 'on, headless', 'on, drawn']

// The pieces of hooks/register.tsx that reach Claude, read from its source so
// a reworded piece is measured as it now stands.
const source = readFileSync(join(root, 'hooks', 'register.tsx'), 'utf8')
const PROJECT_TOOL = /const PROJECT_TOOL = '([^']+)'/.exec(source)?.[1] ?? 'mcp__polis__project'
const evaluate = (expression: string): unknown =>
  new Function('PROJECT_TOOL', `return (${expression})`)(PROJECT_TOOL)
const between = (start: string, end: string): string => {
  const from = source.indexOf(start)
  const to = source.indexOf(end, from + start.length)
  if (from < 0 || to < 0) throw new Error(`hooks/register.tsx no longer has ${start}`)

  return source.slice(from + start.length, to)
}
const described = (name: string): string => {
  const found = new RegExp(`name: '${name}',\\s*description:\\s*'([^']*)'`).exec(source)?.[1]
  if (found === undefined) throw new Error(`hooks/register.tsx no longer describes ${name}`)

  return found
}
const GUIDANCE = (evaluate(between('const GUIDANCE = ', ' as const')) as { text: string }).text
const WORKER_PROMPT = evaluate(between('const WORKER_PROMPT = ', '\n\n')) as string
const VERIFIER_PROMPT = evaluate(between('const VERIFIER_PROMPT = ', '\n\n')) as string
const brief = evaluate(
  between('const orchestrationBrief = ', '\n\n//').replace('(goal: string): string =>', 'goal =>'),
) as (goal: string) => string

// A request of about the cap's length, for what the classify call sends at most.
const LONG_PROMPT = Array.from(
  { length: 80 },
  (_, k) => `Step ${k + 1}: update the handler in src/api/routes.ts so the export works for every user.`,
)
  .join('\n')
  .slice(0, 4000)

type Usage = { input: number; cacheWrite: number; cacheRead: number; output: number }
type Run = {
  first: number
  models: Record<string, Usage>
  tools: Record<string, number>
  turns: number
  cost: number
  isError: boolean
}

const claude = (args: string[], cwd: string): Promise<Run> =>
  new Promise((resolve, reject) => {
    const child = spawn('claude', [...args, '--output-format', 'stream-json', '--verbose', '--session-id', randomUUID(), ...PLAIN], {
      cwd,
      // A task list of its own: run from inside a Claude Code session, a run
      // would otherwise share that session's.
      env: { ...process.env, CLAUDE_CODE_TASK_LIST_ID: randomUUID() },
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', chunk => (out += chunk))
    child.on('error', reject)
    child.on('close', () => {
      const run: Run = { first: 0, models: {}, tools: {}, turns: 0, cost: 0, isError: true }
      for (const line of out.split('\n')) {
        if (!line.startsWith('{')) continue
        const event = JSON.parse(line)
        if (event.type === 'assistant') {
          const usage = event.message.usage
          if (run.first === 0 && event.parent_tool_use_id === null) {
            run.first = usage.input_tokens + (usage.cache_creation_input_tokens ?? 0) + (usage.cache_read_input_tokens ?? 0)
          }
          for (const block of event.message.content ?? []) {
            if (block.type === 'tool_use') run.tools[block.name] = (run.tools[block.name] ?? 0) + 1
          }
        }
        if (event.type === 'result') {
          run.turns = event.num_turns ?? 0
          run.cost = event.total_cost_usd ?? 0
          run.isError = event.is_error === true
          for (const [model, used] of Object.entries<Record<string, number>>(event.modelUsage ?? {})) {
            run.models[model] = {
              input: used.inputTokens ?? 0,
              cacheWrite: used.cacheCreationInputTokens ?? 0,
              cacheRead: used.cacheReadInputTokens ?? 0,
              output: used.outputTokens ?? 0,
            }
          }
        }
      }
      if (run.first === 0) reject(new Error(`claude ${args.join(' ')} gave no answer:\n${out.slice(-2000)}`))
      else resolve(run)
    })
  })

const pluginArgs = (condition: Condition): string[] => {
  if (condition === 'off') return []
  const polis = ['--plugin-dir', root]
  if (condition === 'guidance false') {
    return [...polis, '--settings', JSON.stringify({ pluginConfigs: { polis: { options: { guidance: false } } } })]
  }

  return condition === 'on, drawn' ? [...polis, '--append-system-prompt', GUIDANCE] : polis
}

const runStatic = async (): Promise<void> => {
  const model = flag('model', 'haiku')
  const cwd = mkdtempSync(join(tmpdir(), 'polis-overhead-'))
  const first = async (...args: string[]): Promise<number> =>
    (await claude(['-p', PROBE, '--model', model, ...args], cwd)).first
  // What an appended text adds, less what the separator and one token add.
  const marker = await first('--append-system-prompt', 'x')
  const count = async (text: string): Promise<number> => (await first('--append-system-prompt', text)) - marker + 1

  const off = await first(...pluginArgs('off'))
  const quiet = await first(...pluginArgs('guidance false'))
  const on = await first(...pluginArgs('on, headless'))
  const guidance = await count(GUIDANCE)
  const rows: [string, number, string][] = [
    ['`worker`/`verifier` agent types (in the Agent tool)', quiet - off, 'every request, every session'],
    ['`project` tool schema (non-deferred)', on - quiet, 'every request, guidance on'],
    ['`/city` and `/orchestrate` command descriptions', 0, 'none: commands are not listed to Claude'],
    ['Total in a headless session', on - off, 'every request'],
    ['`GUIDANCE` system section', guidance, 'every request where a surface draws'],
    ['Total where a surface draws', on - off + guidance, 'every request'],
    ['Smart-zone note, caution', await count(zoneNote('caution', 120_000, 150_000)), 'once per crossing'],
    ['Smart-zone note, out', await count(zoneNote('out', 160_000, 150_000)), 'once per crossing'],
    ['`SIZING_RUBRIC`', await count(SIZING_RUBRIC), 'per classify call, small model'],
    ['Classify input at the 4,000-char cap', await count(LONG_PROMPT), 'per classify call, at most'],
    ['`/orchestrate` brief (less the goal)', await count(brief('')), 'per /orchestrate'],
    ['`worker` prompt', await count(WORKER_PROMPT), 'per worker spawned'],
    ['`verifier` prompt', await count(VERIFIER_PROMPT), 'per verifier spawned'],
  ]
  rmSync(cwd, { recursive: true, force: true })

  console.log(`Fixed pieces, counted on ${model} (first-request input: off ${off}, guidance false ${quiet}, on ${on})\n`)
  console.log('| Piece | Tokens | Paid |\n|---|---:|---|')
  for (const [piece, tokens, paid] of rows) console.log(`| ${piece} | ${tokens} | ${paid} |`)
}

// A small repository each session starts from, fresh every time.
const FIXTURE: Record<string, string> = {
  'package.json': '{\n  "name": "ledger",\n  "type": "module",\n  "scripts": { "test": "node --test" }\n}\n',
  'README.md': '# ledger\n\nSmall arithmetic and text helpers.\n',
  'src/math.js': 'export const add = (a, b) => a + b\n\nexport const multiply = (a, b) => a * b\n',
  'src/strings.js':
    "export const slugify = text =>\n  text.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')\n",
  'src/report.js':
    "import { add, multiply } from './math.js'\nimport { slugify } from './strings.js'\n\nexport const report = (label, a, b) => `${slugify(label)}: ${add(a, b)} / ${multiply(a, b)}`\n",
  'test/math.test.js':
    "import { test } from 'node:test'\nimport assert from 'node:assert/strict'\n\nimport { add, multiply } from '../src/math.js'\n\ntest('add', () => assert.equal(add(2, 3), 5))\ntest('multiply', () => assert.equal(multiply(2, 3), 6))\n",
}

const PROMPTS: Record<string, string> = {
  question: 'What does src/report.js do, and which functions does it depend on? Answer briefly; change no files.',
  edit: 'Rename the function `add` in src/math.js to `sum`, update every caller and test, and run the tests.',
  feature: [
    'Add a command-line tool at src/cli.js: `node src/cli.js <a> <b> [--label text]` prints the sum and product',
    'of a and b, prefixed by the slugified label when one is given, and exits with code 1 and a usage line on bad',
    'input. Add tests for it in test/cli.test.js, document it in README.md, and run the tests.',
  ].join(' '),
}

const ALLOWED = 'Read Edit Write Glob Grep Bash Task Agent ToolSearch TaskCreate TaskUpdate TaskList TaskGet TodoWrite'
// The calls Polis's standing instruction and tool ask for.
const PROMPTED = ['TaskCreate', 'TaskUpdate', 'TodoWrite', PROJECT_TOOL]

const total = (usage: Usage): number => usage.input + usage.cacheWrite + usage.cacheRead + usage.output

const runSessions = async (): Promise<void> => {
  const model = flag('model', 'sonnet')
  const repeat = Number(flag('repeat', '1'))
  const jobs = Number(flag('jobs', '4'))
  const out = flag('out', '')
  const plan = Object.keys(PROMPTS).flatMap(prompt =>
    CONDITIONS.flatMap(condition => Array.from({ length: repeat }, (_, k) => ({ prompt, condition, k }))),
  )
  const results: { prompt: string; condition: Condition; k: number; run: Run }[] = []
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < plan.length) {
      const job = plan[next++]
      if (job === undefined) return
      const cwd = mkdtempSync(join(tmpdir(), 'polis-session-'))
      for (const [path, text] of Object.entries(FIXTURE)) {
        mkdirSync(dirname(join(cwd, path)), { recursive: true })
        writeFileSync(join(cwd, path), text)
      }
      const prompt = PROMPTS[job.prompt] ?? ''
      const args = ['-p', prompt, '--model', model, '--allowedTools', ...ALLOWED.split(' '), ...pluginArgs(job.condition)]
      try {
        const run = await claude(args, cwd)
        results.push({ ...job, run })
        console.error(`${job.prompt} / ${job.condition} #${job.k + 1}: ${Object.values(run.models).map(total).join(' + ')}`)
      } catch (error) {
        console.error(`${job.prompt} / ${job.condition} #${job.k + 1} failed: ${String(error)}`)
      } finally {
        rmSync(cwd, { recursive: true, force: true })
      }
    }
  }
  await Promise.all(Array.from({ length: jobs }, worker))
  if (out !== '') writeFileSync(out, JSON.stringify({ model, results }, null, 2))

  const mean = (values: number[]): number =>
    values.length === 0 ? 0 : Math.round(values.reduce((sum, one) => sum + one, 0) / values.length)
  console.log(`Sessions on ${model}, ${repeat} run(s) each, means\n`)
  console.log('| Prompt | Polis | Tokens processed | of which cache reads | per model | Tool calls | Prompted calls | Agent calls |')
  console.log('|---|---|---:|---:|---|---:|---:|---:|')
  for (const prompt of Object.keys(PROMPTS)) {
    for (const condition of CONDITIONS) {
      const runs = results.filter(one => one.prompt === prompt && one.condition === condition).map(one => one.run)
      const models = [...new Set(runs.flatMap(run => Object.keys(run.models)))]
      const perModel = models
        .map(name => `${name} ${mean(runs.map(run => (run.models[name] ? total(run.models[name]) : 0)))}`)
        .join(', ')
      const calls = (names: string[] | null) =>
        mean(runs.map(run => Object.entries(run.tools).reduce((sum, [name, n]) => (names === null || names.includes(name) ? sum + n : sum), 0)))
      console.log(
        `| ${prompt} | ${condition} | ${mean(runs.map(run => Object.values(run.models).reduce((sum, used) => sum + total(used), 0)))} ` +
          `| ${mean(runs.map(run => Object.values(run.models).reduce((sum, used) => sum + used.cacheRead, 0)))} | ${perModel} ` +
          `| ${calls(null)} | ${calls(PROMPTED)} | ${calls(['Agent', 'Task'])} |`,
      )
    }
  }
}

const command = argv[0]
if (command === 'static') await runStatic()
else if (command === 'sessions') await runSessions()
else {
  console.error('Usage: node --import ./tools/ts-resolve.mjs tools/overhead.ts static|sessions [--model name]')
  process.exit(1)
}
