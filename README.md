# Polis

A Claude Code mod that keeps a complex project legible while Claude works on it: a band above the prompt, a pane with six views, and an isometric city in which districts are work areas, buildings are tasks and agents stand on what they are working on.

The [user manual](docs/MANUAL.md) explains how to read every part of it.

## What it shows

- **Band** — project progress, tasks done, working agents, this prompt's tokens against its expected range, context window.
- **Pane** (`/city`, or the band's City button), with six views:
  - **Overview** — milestones, the current prompt's actual against expected, tasks, agents, background processes, recent activity, most-edited files.
  - **City** — the map. A lot is a planned task, scaffolding is one in progress, lit windows are done, a rose barrier is blocked; dashed arcs show what waits on what. City Hall is the main session, the plant's tank is the context window.
  - **Tasks** — the task tree with sub-tasks, owners and blockers.
  - **Agents** — an icon per agent carrying the tools it uses most, with status, tokens and its task.
  - **Resources** — tokens, time and tool calls against expected; context window; rate limits; cost; what prompts usually cost in this project.
  - **Skills** — used, suggested for the work at hand, available.

## Commands

- `/city [overview|city|tasks|agents|resources|skills]` — open the pane at a view. Where nothing can draw it, the command answers with the board as text.
- `/orchestrate <goal>` — plan a goal into tasks and run them with parallel agents (`polis:worker`, `polis:verifier`).

## Where it draws

| Host | What you get |
| --- | --- |
| Claude desktop app, Code tab | Everything, with the city and agent icons as vector drawings. |
| `claude` in a terminal, including VS Code's integrated terminal | Everything as text; the city is a row of blocks per district. |
| VS Code extension's chat panel | Nothing is drawn there (as of extension 2.1.295). The mod's hooks still run; `/city` answers as text, and the mod asks nothing extra of the model. |

The pane adapts to its width: under 44 columns the city is drawn one block wide and bars sit under their labels.

## Options

Set in `/config`, or under `pluginConfigs.polis.options` in settings.

| Option | Default | Meaning |
| --- | --- | --- |
| `estimate` | `both` | How a prompt's expected cost is sized: `history` (free, from this project's past turns), `model` (a small-model call per prompt), or `both` (history, plus the model for long prompts). |
| `guidance` | `true` | Add a short standing instruction so Claude keeps tasks and milestones current, and offer it the `mcp__polis__project` tool. |
| `autoOpen` | `true` | Open the pane the first time tasks or agents appear in a session. |

## Loading it

Name this folder in `CLAUDE_CODE_PLUGIN_DIRS`, in the `env` block of `~/.claude/settings.json`. Sessions started after that load it.

## Developing

`claude` here means the Claude Code binary (on this machine: `%APPDATA%\Claude\claude-code\<version>\<hash>\claude.exe`).

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

Every call on the engine (`$`) and every piece of state lives in `hooks/register.tsx`; the validator requires it. The other files under `hooks/` are pure: `logic.ts` (tracking and estimates), `views.tsx` (band and pane), `city.ts` and `icons.ts` (the drawings), `theme.ts` (palette). `tools/preview.ts` draws the city for made-up sessions into an HTML page for judging its look in a browser.

The mod records the room each surface gives its band and pane under the `rooms` key of its store, which is the first thing to read when a drawing looks wrong somewhere.
