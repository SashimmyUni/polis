# Architecture

Where things live in the mod, by name. Line numbers drift; search for the names.

## Modules

The mod loads one module, `hooks/register.tsx` (`hooks/hooks.json`). Everything else is pure: it takes values and returns values, and never touches the engine's `$`.

| Module | Holds |
| --- | --- |
| `register.tsx` | The wiring: atoms, every `on(...)` hook, the clocks, and the loaders that build the views' model. The only file that calls `$`. |
| `views.tsx` | Everything drawn as text: `stripElements` and `fitStrip` (the band and status line), the pane and its views (`tasksView`, `agentsView` with the Sessions block, …), `summary` (the `/city` text answer). |
| `flow.ts` | The phase table (`flowOf`), HITL and AFK work (`workKind`), the next step, and `attentionOf`: the strip's first element. |
| `live.ts` | Live records: one per running session under `live:<root>:<id>`, the keeper that writes and reads them, and the needs-you wording across sessions. |
| `stall.ts` | Stalled work: the progress kept as events come in, and the rule that reads it. |
| `ask.ts` | Whether a turn ended by asking the person something (the asked wait). |
| `notify.ts` | What a session notifies for, and the toast that stands in. |
| `frontier.ts` | The wayfinder frontier read through `gh`. |
| `logic.ts` | The shared core: waits (`topWait`, `topNeed`, `waitText`), the smart zone, limits, tasks, the project, formatting. |
| `checks.ts`, `verify.ts`, `codemap.ts` | Checks run by commands, task verdicts, and task areas. |
| `projectlog.ts`, `archive.ts`, `report.ts` | The project log, the archive of finished tasks, the session report. |
| `city.ts`, `page.ts`, `icons.ts`, `theme.ts` | The city drawing, the city page on disk, icons, and colours. |

Shared types are in `types/index.d.ts`. `PluginState.polis` lists every atom key.

## Adding a piece of state

Each new feature so far has touched the same places in `register.tsx`, in this order:

1. The pure logic in its own module (as `live.ts`, `stall.ts`, `frontier.ts` did), tested on its own.
2. The atom: declare its key in `PluginState.polis` (`types/index.d.ts`), then `atom({ plugin: 'polis', key: '<literal>' } as const, …)` beside the others. `claude plugin validate --strict` checks the key is a literal.
3. Feed it from the hooks that change it: `turn.start`, `turn.complete` (gate on `agentId === undefined` for the main loop), the generic `tool.call`, `agent.spawn`, `session.end` (also `reason === 'clear'`).
4. Read it in `loadStrip` (band and status line) and `load` (pane, page, `/city`), then draw it in `views.tsx`.
5. If its text changes with time, have a `session.start` clock call `refresh($, false)`: the status line is rewritten only from events and `refresh`.

## Engine gotchas

- A function `$` is passed to must be declared at the top of its file (a function declaration, or a const bound to one), or the engine refuses to load the mod.
- `$.fs` has no delete.
- The store is shared between running sessions of the same installed mod; a copy loaded with `--plugin-dir` has a store of its own.
- `prompt.submit` may be registered once: the hook in `register.tsx` serves both the phase and the smart-zone note.

## Checking an engine fact

Before building on what the engine does in a real host (whether a tool reaches `tool.call`, what `prompt.submit` carries, what one session sees of another), run the probe:

```bash
node tools/probe.ts --sessions 2 "<prompt>"
```

It loads `tools/probe/` into headless sessions and prints every event as JSON. What it has settled is recorded at the top of `tools/probe.ts`.
