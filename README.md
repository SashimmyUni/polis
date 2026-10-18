# Polis

A Claude Code mod that keeps a complex project legible while Claude works on it: a band above the prompt, a pane with seven views, and an isometric city in which districts are the parts of the code being worked on, buildings are tasks and agents stand on what they are working on.

The [user manual](docs/MANUAL.md) explains how to read every part of it.

## What it shows

- **Band** — only what to act on now, on one row: what needs you, a usage-limit warning while one fires, the smart zone (context in tokens) and tasks done.
- **Smart-zone warning** — context measured in tokens against a smart-zone limit (150k by default, whatever the window): amber at the caution (80% of the limit), rose past it, with one toast per crossing. Claude is told too, by a note after your next prompt, to hand pieces to sub-agents or stop at the next phase boundary and recommend `/clear` or `/compact`.
- **Pane** (`/city`, or the band's City button), with seven views:
  - **Overview** — what needs you, the project and this session, milestones, the current prompt's actual against expected, tasks and how the finished ones stand, checks, git, agents, background processes, recent activity, most-edited files.
  - **Project** — every session of the project, with the agents each ran and their sub-agents.
  - **City** — the map, at night and alive: a moon that fills with the project's progress, a canal with a boat and a lighthouse, street lamps, cars, fireworks when every task is done. A lot is a planned task, scaffolding is one in progress, lit windows are done; a pennant on the roof marks work something checked, a rose cross work that failed its check, and a pale quiet building work nobody checked. A rose barrier is blocked; dashed arcs show what waits on what. City Hall is the main session (rose flag and a speech bubble when Claude waits on you), the plant's tank is the context window, a signal mast has one lamp per check. **Full city** (f) adds everything the project has ever finished, from its archive: the newest work as quieter buildings, the oldest as an old town of towers with a count.
  - **Tasks** — the task tree with sub-tasks, owners, blockers, and the tasks earlier sessions left.
  - **Agents** — an icon per agent carrying the tools it uses most, with status, tokens and its task.
  - **Resources** — tokens, time and tool calls against expected; context window; rate limits, each with a forecast of whether it lasts until the reset; cost; what prompts usually cost in this project.
  - **Skills** — used, suggested for the work at hand, available.
- **Pages on disk** — the city as self-refreshing HTML files in the project: `.polis/city.html` (current) and `.polis/city-full.html` (full), each linking to the other. Open one once in a browser or VS Code's Integrated Browser and leave it beside your editor; no server is needed. The header says what needs you, the smart-zone state and tasks done.

## Commands

- `/city [overview|project|city|tasks|agents|resources|skills]` — open the pane at a view. Where nothing can draw it, the command answers with the board as text, and `/city project` with the project's sessions as text.
- `/city report` — the session as a Markdown report, as text. `/city report save` also writes it to `polis-report.md` in the working directory.
- `/city [overview|city|tasks|agents|resources|skills]` — open the pane at a view. Where nothing can draw it, the command answers with the board as text.
- `/city page` — reply with the paths and `file:///` URLs of both pages on disk, and how to open one in VS Code's Integrated Browser.
- `/orchestrate <goal>` — plan a goal into tasks and run them with parallel agents (`polis:worker`, `polis:verifier`).

## Where it draws

| Host | What you get |
| --- | --- |
| Claude desktop app, Code tab | Everything, with the city and agent icons as vector drawings. |
| `claude` in a terminal, including VS Code's integrated terminal | Everything as text; the city is a row of blocks per district. |
| VS Code extension's chat panel | The pane, with City's top strip and the city as drawings, but no band; the status line stands in for it. |

The pane adapts to its size. The city is cropped to what is built and drawn to the pane's shape, in one of three layouts (wide, avenue, or a one-block-wide column under 44 columns), with its key written on the buildings. Under 44 columns bars sit under their labels.

## Options

Set in `/config`, or under `pluginConfigs.polis.options` in settings.

| Option | Default | Meaning |
| --- | --- | --- |
| `estimate` | `both` | How a prompt's expected cost is sized: `history` (free, from this project's past turns), `model` (a small-model call per prompt), or `both` (history, plus the model for long prompts). |
| `guidance` | `true` | Add a short standing instruction so Claude keeps tasks and milestones current, and offer it the `mcp__polis__project` tool. |
| `autoOpen` | `true` | Open the pane the first time tasks or agents appear in a session. |
| `motion` | `true` | Let the city move: its cars, its boat, its fireworks. `false` draws it still. |
| `page` | `true` | Write the city to `.polis/city.html` and the full city to `.polis/city-full.html` each time the board or archive changes. |
| `smartZone` | `150000` | The smart-zone limit in tokens. The caution comes at 80% of it; on a smaller window the limit is 80% of the window. |

## Install

From this repository, as a marketplace:

```bash
claude plugin marketplace add SashimmyUni/polis
claude plugin install polis@polis
```

Or from a local copy: name its folder in `CLAUDE_CODE_PLUGIN_DIRS`, in the `env` block of `~/.claude/settings.json`. Sessions started after that load it.

## Developing

`claude` here means the Claude Code binary (on this machine: `%APPDATA%\Claude\claude-code\<version>\<hash>\claude.exe`).

```bash
node tools/check.ts
```

The check command runs five stages: install (the pinned TypeScript and Node types of `package.json`, only when `node_modules` is missing or out of date; the mod itself has no dependencies), validation, type-check (`hooks/`, `types/` and `tests/` against the engine's types), tools type-check (`tools/` against Node's types) and tests. It stops at the first stage that fails, names it and prints that stage's full output; `tools/check.ts`'s header and stage list say what each one runs. Both type-checks need the engine-generated `.claude-plugin/types/` (gitignored); when it is missing, the check command's message says how to produce it. `.github/workflows/ci.yml` has the engine write those types, then runs the check command, on pushes to `main` and on pull requests.

A tracked pre-commit hook in `.githooks/` runs the same command and refuses the commit when it fails. Turn it on once per clone; it then applies to every worktree of that clone:

```bash
git config core.hooksPath .githooks
```

`git commit --no-verify` skips it for one commit.

Every call on the engine (`$`) and every piece of state lives in `hooks/register.tsx`; the validator requires it. The other files under `hooks/` are pure: `logic.ts` (tracking, estimates, usage-limit forecasts, carried tasks), `checks.ts` (what counts as a test, lint, type or build run), `codemap.ts` (code areas, git), `verify.ts` (verdicts), `projectlog.ts` (the project's sessions), `archive.ts` (every finished task, for the full city), `page.ts` (the pages on disk), `report.ts` (the Markdown report), `views.tsx` (band and pane), `city.ts` and `icons.ts` (the drawings), `theme.ts` (palette). `tools/preview.ts` draws the city for made-up sessions into an HTML page for judging its look in a browser; `tools/measure.ts` reports at how many buildings a large city starts to shed detail (`node --import ./tools/ts-resolve.mjs tools/measure.ts`).

The mod records the room each surface gives its band and pane under the `rooms` key of its store, which is the first thing to read when a drawing looks wrong somewhere.

## License

MIT. See [LICENSE](LICENSE).
