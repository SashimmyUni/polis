# Polis user manual

How to read the Polis dashboard in Claude Code: the band above the prompt, the city, and the other views of the pane.

- [Getting started](#getting-started)
- [Reading the city](#reading-the-city)
- [The other views](#the-other-views)

The pictures are the mod's own drawings of made-up sessions. `tools/manual-images.ts` regenerates them.

## Getting started

### What Polis is

Polis is a mod for Claude Code that keeps a large piece of work legible while Claude does it. It follows Claude's task list, its subagents, its background processes and what each prompt costs, and shows them in a band above the prompt and in a pane with six views. One of the views is an isometric city: each district is a work area, each building is a task, and each agent stands on the building it is working on.

### Where it draws

| Host | What you get |
| --- | --- |
| Claude desktop app, Code tab | Everything. The city and the agent icons are vector drawings, and hovering a building or an agent shows its detail. |
| `claude` in a terminal, including VS Code's integrated terminal | Everything, as text. The city is a row of blocks per district, and each agent is a single glyph. |
| VS Code extension's chat panel | Nothing is drawn there (as of extension 2.1.295). |

Polis draws only where Claude Code gives a plugin room: Claude Code raises the band slot on the terminal and the desktop app only. Polis also asks Claude Code which surfaces the session draws on, and what it does depends on the answer:

- **Desktop app.** The band and the pane draw, with the city and icons as drawings.
- **Terminal.** The band and the pane draw. The terminal draws no vector graphics, so the city and the agents' icons are text.
- **VS Code chat panel, or a headless `claude -p` run.** No surface draws, but Polis's hooks still run, so the board, the project record and the turn history keep updating. Polis changes three things: `/city` answers with the board as plain text instead of opening a pane; it adds no standing instruction to Claude's system prompt; and it makes no small-model call to size a prompt. It still registers `mcp__polis__project` (when `guidance` is on) and its two agent types.

The text answer looks like this:

```
Polis · atlas · Building the API
Progress: 50% (1/3 milestones)
Tasks: 2 done · 1 active · 3 waiting
  ▶ Writing the integration tests
Agents: 1 working · 2 this session
  ● polis:worker: Write the docs pages
This prompt: 31k tokens of 24k–90k expected · 14 tool calls · 2m10s
Context: 38% · session cost $0.42
Background: 1 running
```

When a surface is attached but cannot place a pane, `/city` gives the same text after `Polis is open but not drawn here yet:` and the reason.

### Loading it

Polis loads from its folder. Name that folder in `CLAUDE_CODE_PLUGIN_DIRS`, in the `env` block of `~/.claude/settings.json` (Claude Code reads this variable from there or from the process environment, never from a project's settings):

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "C:\\tools\\polis"
  }
}
```

The path above is only an example: use the absolute path to your copy of the Polis folder. To name several folders, separate them with your system's path-list separator (`;` on Windows, `:` on macOS and Linux). Sessions started after the edit load Polis. Polis registers `/city` when it loads, so typing `/city` is a quick check.

### The band above the prompt

On the desktop app and in a terminal, Polis draws one band directly above the prompt. From left to right:

| Element | Meaning |
| --- | --- |
| `◆ atlas` | The project's name, cut to 18 characters. By default it is the folder name of the repository root (of the working directory outside a repository), or `Scratch` when the path runs through a `scratch-workspaces` folder. Claude can set it through the project tool. |
| `███░░░ 50%` | Progress, shown once there is something to count. It counts the project's milestones if Claude has recorded any, otherwise this session's top-level tasks (those with no parent). Each finished item counts one and each item in progress counts half. |
| `2/5 tasks` | Tasks done out of all tasks on the board, sub-tasks included. Hidden while the board is empty. |
| `⚒ ◎` | One glyph per working agent, up to six, colored by type: ◎ Explore, ▧ Plan, ⚒ worker, ✓ verifier, ● anything else. |
| `⚡12k/90k` | Tokens this prompt has used so far, against the top of the range expected for it. Green while below the range, amber inside it, rose above it. It appears after your first prompt and keeps the last prompt's figure until the next one. The range comes from this project's past prompts of the same size once it has five of them, and from starting defaults before that. |
| `ctx 38%` | How full the context window is. Grey, amber from 60%, rose from 80%. Hidden while it reads 0. |
| Current task | The first task in progress, in its present-tense wording ("Running tests") if it has one, cut to 40 characters. Shown only when the band is at least 70 columns wide. |
| **City** | Opens the pane at the City view. |
| **Hide** | Hides the band. |

The band wraps onto more lines when it is narrow. If Claude Code is showing a survey in that spot, Polis steps aside until it is gone.

**Hide** removes the band for the rest of the session. Running `/city` brings it back (and opens the pane). While the band is hidden, and wherever no surface has asked for a band, Polis puts a short line in the status line under the prompt instead, for example `◆ 2/5 tasks · 1 agent running`. Each part appears only when it is not zero, and the line is cleared when the board has no tasks and no working agents. Whether a host shows that line is up to the host.

### Opening the pane

Type `/city` to open the pane. With no argument it opens at the City view. Give it a view name to open there (case does not matter): `/city overview`, `/city city`, `/city tasks`, `/city agents`, `/city resources` or `/city skills`. `/city page` is different: it replies with the path and `file:///` URL of the page on disk (see "A self-refreshing page on disk"). Any other word opens the pane at the view it last showed (Overview in a new session). You can also press **City** in the band, and `/orchestrate` opens the pane too.

![A new session's city](images/city-new.svg)

Polis also opens the pane by itself, once per session, the first time tasks or agents appear, unless you have already opened it or `autoOpen` is off. If you close the pane, it stays closed. The host may hold back a pane you did not ask for (on a narrow terminal, for example); if it does not appear, run `/city`, because a pane you ask for is placed at any width.

The pane shows `◆ POLIS`, the project's name and phase, and one tab per view. While the pane has the keyboard, the number on each tab switches to it.

| Key | View | Shows |
| --- | --- | --- |
| 1 | Overview | Milestones and progress, this prompt against its expected range, tasks, working agents, background processes, recent activity and the most-edited files. Buttons: **Orchestrate** (o), **Clear finished** (c), and **Stop turn** (s) while a prompt is running. |
| 2 | City | The map (a row of blocks per district in a terminal). |
| 3 | Tasks | The task tree with sub-tasks, areas, owners and blockers. |
| 4 | Agents | The main session and each agent, with an icon (a glyph in a terminal) carrying its most-used tools, its status, time, tokens and task. |
| 5 | Resources | Tokens, time and tool calls against expected; the context window; rate limits and cost; tokens by agent; what prompts usually cost in this project. |
| 6 | Skills | Skills used this session, skills suggested for the work, and skills available. |

**Clear finished** takes completed tasks, finished agents and ended processes off the board. **Stop turn** aborts the prompt that is running.

**How wide it is.** Polis asks the host for 68 columns and 46 rows, enough for the city at a readable size while the conversation keeps about half the window. These are requests: Claude Code uses the columns when the pane docks beside the conversation and the rows when it sits above the prompt, and a size you have dragged or keyed it to wins. In a terminal, the pane docks when Claude Code is fullscreen and the window is at least 110 columns wide; otherwise it sits above the prompt.

Polis lays the pane out for the width it is actually given. Under 44 columns it switches to a narrow layout: the city is drawn one block wide, bars sit under their labels, long text wraps instead of being cut, and the list of available skills drops its descriptions (suggested skills keep theirs). (In the desktop app, a pane docked beside other panes can be about 20 columns wide.)

### A self-refreshing page on disk

While a session runs, Polis also writes the current city into an HTML file, and the page reloads itself every 3 seconds. Open it once in any browser, or in a VS Code tab with a preview extension, and leave it beside your editor. No server is needed.

| | |
| --- | --- |
| The file | `<project root>/.polis/city.html`. The project root is the git repository root, or the session's working directory outside a repository. |
| Beside it | `.polis/.gitignore` containing `*`, so the folder never shows in `git status`. |
| What it shows | The city only, with the project's name and a one-line description above it. The Tasks, Agents and Resources views are not on the page. |
| When it is written | Each time the board changes the picture. An idle session writes nothing. |
| After the session | The file stays, as the last picture. |

`/city page` replies with the file's path and its `file:///` URL. To turn the writing off, set `page` to `false` (see "Options").

### How work gets onto the board

Polis watches Claude's task tools and its agent spawns; you do not enter anything.

- **TodoWrite.** Each call replaces that loop's todo list (the main session's, or one agent's). Todos carry no area, so Polis infers one from the wording: tests, docs, ui, backend, research, ops, or general.
- **TaskCreate and TaskUpdate.** `metadata.area` names the task's district (lowercased, cut to 24 characters); without it Polis infers one. `metadata.parent` is the id of the parent task, which makes the task a sub-task; a sub-task created with no area of its own joins its parent's district. A task made by a subagent hangs under the task that agent is working on unless `metadata.parent` says otherwise. `TaskUpdate` can set both on an existing task (giving a task a parent that way does not move it out of the district it already has), and the blockers it adds show as "waits on" in the Tasks view and as dashed arcs on the map.
- **Agent spawns.** Each agent appears on the board and is matched to the open task whose subject best shares words with the agent's name and description; failing that, to the one task in progress, if there is exactly one. An agent that sets a task in progress, or is named as its owner, stands at that task.

**The project tool.** Polis offers Claude a tool, `mcp__polis__project`, and Claude can call it without a permission prompt because it writes only Polis's own record. Claude uses it for milestones (an id, a title and a status of `planned`, `active` or `done`; ids match, so Claude sends only what changed), for the project's name and phase, and, in a session whose host gives Claude no task tool, for tasks (id, subject, status, area, parent, owner, blockers).

**The standing instruction.** With `guidance` on, Polis adds a short section to Claude's system prompt:

> The person watches a live project dashboard (Polis). For work of three or more steps, record the steps with the task tool before starting, mark each one in progress as you begin it and completed as soon as it is verified. When creating a task, set `metadata.area` to a short work-area name (for example api, ui, tests, docs) and, for a sub-task, `metadata.parent` to its parent task's id. Where this session has no task tool, record and update the same steps through the `tasks` of the mcp__polis__project tool instead. For project-level work, record the project's milestones with mcp__polis__project once the plan is known, and update them whenever a milestone starts or completes.

Polis skips it in a session where nothing draws (the VS Code chat panel, a headless run). To switch it off everywhere, set `guidance` to `false`; that also stops Polis registering the project tool, so Claude can no longer record milestones. Progress then follows the tasks, unless milestones were recorded for the project in an earlier session, in which case it keeps counting those.

### Planning with agents: /orchestrate

`/orchestrate <goal>` opens the pane and submits a prompt in your name. Without a goal it answers `Usage: /orchestrate <goal>`. The prompt asks Claude to act as orchestrator and use subagents, in five steps:

1. **Plan.** Break the goal into 3 to 8 tasks and record each one, with an area, before any work starts; note which depend on which.
2. **Delegate.** Start every independent task as its own agent call, all in one message so they run in parallel, each with a self-contained brief. Use `polis:worker` to implement, `Explore` to search, `polis:verifier` to check. Tiny or strictly sequential tasks stay with Claude, and no two agents write the same files.
3. **Track.** Mark a task in progress when it starts and completed only when it is verified.
4. **Verify.** Treat each agent's report as a claim: read the diff or run the tests, and send failed work back.
5. **Report.** Say what was done, what failed and what is left.

The prompt ends with `Goal: ` and your goal. Polis registers the two agent types when it loads:

- `polis:worker` has all tools. It is told to do exactly its one task, stay inside its scope because other workers may be editing other files, and end with a short report: what it changed, how it checked, and anything unfinished or wrong.
- `polis:verifier` is limited to Read, Grep, Glob and Bash. It is told to check a claim against the actual files and by running tests or commands, never to edit files, and to answer PASS or FAIL first, then the evidence.

The **Orchestrate** button in the Overview replaces the prompt's text with `/orchestrate ` for you to finish; where Polis cannot fill the prompt (the host has its own composer), it shows a toast saying what to type.

### Options

| Option | Default | Meaning |
| --- | --- | --- |
| `estimate` | `both` | How a prompt's expected cost is sized. `history`: a text heuristic picks the size (small to very large) and the range comes from this project's past turns of that size (starting defaults until it has five); no model call. `model`: a small-model call sizes every prompt, and the heuristic's guess shows until it answers. `both`: the heuristic, plus the model for prompts of 400 or more characters, four or more lines, or sized large or very large by the heuristic. Any other value counts as `both`. The model is never asked where nothing draws. |
| `guidance` | on | The standing instruction and the `mcp__polis__project` tool, as above. On unless set to `false`. |
| `autoOpen` | on | Open the pane the first time tasks or agents appear in a session. On unless set to `false`. |
| `page` | on | Write the city to `.polis/city.html` in the project each time the board changes (see "A self-refreshing page on disk"). Set it to `false` to turn the writing off. |

Set them in `/config`, where each option is a row and a change reloads Polis with the new value (the plugin manifest titles them Expected resources, Guide Claude, Open the dashboard by itself and Page on disk), or in settings under `pluginConfigs.polis.options`:

```json
{
  "pluginConfigs": { "polis": { "options": { "estimate": "history", "autoOpen": false } } }
}
```

### What Polis remembers

Polis keeps two records across sessions, both keyed by the repository root or, outside a repository, the working directory:

- **The project record:** the name, the phase, the milestones, how many sessions, turns and tokens the project has had, and a count of tasks completed (no view shows that count). The Overview's PROJECT heading shows the counts as `session 3 · 41 turns · 1.2M tokens so far`.
- **The turn history:** the size, tokens, time and tool calls of your last 300 finished prompts. A prompt is recorded only when it ends with an answer. This is what the expected ranges are drawn from.

Polis also saves a small note of the room each surface gave the band and the pane, which helps explain a drawing that looks wrong somewhere.

The board itself (tasks, agents, background processes, the activity feed, the most-edited files) is not saved with the project. `/clear` empties all five, and resets the current prompt's figures. It does not touch the project record, the turn history, whether the band is hidden or the view the pane shows.

## Reading the city

The city is a map of your session, drawn from the same tasks, agents and background processes the rest of Polis tracks. Open it with `/city`, or with the City button on the band above the prompt. Four ideas cover all of it:

- **Districts** are work areas, such as api, ui or tests.
- **Buildings** are tasks. How a building looks tells you if its task is planned, in progress, done or blocked.
- **People** are agents. Each stands on the building it works on.
- **The civic block**, at the back, is the session itself: the main session, its context window, its skills and its background processes.

![A busy city: six districts, agents, blockers and background processes](images/city-busy.svg)

### The civic block

Four buildings stand around a small square: City Hall at the back, the power plant on the right, the library on the left and the works yard at the front. They are there from the start of every session, before the first task.

![A new session: only the civic block](images/city-new.svg)

| Building | Stands for | What its details mean |
| --- | --- | --- |
| City Hall (large, blue) | The main session | The flag on the tower. It is amber and waves while the main session is working on a prompt, and gray and still when the session is idle. |
| Power plant (amber) | The context window | The glass tank on its front is filled to the percentage of the window in use. It is green below 60%, amber from 60% to 79%, and rose from 80%. The chimney smokes (three puffs rising) only while the main session is working. The smoke says nothing about the context. |
| Library (violet) | Skills | One lit book on the side wall for each skill used this session, up to 5. Further skills still count in the key but get no book. |
| Works yard (teal) | Background processes | One chimney for each running process, up to 4, with a blinking teal beacon on each chimney that has a process. With nothing running there is one dark chimney, no beacons, and the windows are dim gray instead of teal. |

These count as a background process in the works yard:

- A command that Bash or PowerShell started in the background.
- A Monitor.
- A Workflow.
- A scheduled job (cron) created in the session.
- Any other background task the engine reports, except agents. Background agents are people, not processes.

A process leaves the count when you stop it (TaskStop, or deleting the scheduled job), or when it is no longer on the engine's list of what is still running. Polis reads that list each time Claude finishes responding.

### The key and the legend

The key sits in the top-left corner. Each row has a swatch in its building's color.

| Row | What it says | Meter |
| --- | --- | --- |
| `main session working` or `idle` | City Hall: whether the main session is working on a prompt | None |
| `context 71%` | Power plant: how full the context window is | Filled to that percentage. Green below 60%, amber 60% to 79%, rose from 80%. |
| `prompt 410k/330k` | This prompt's tokens so far, over the top of the range Polis expects for a prompt of this size. Before your first prompt it reads `prompt: none yet`. | Filled to tokens over that top, full at or above it. Green under the range, amber inside it, rose above it. The swatch takes the same color. |
| `background 3 running` | Works yard: running background processes | None |
| `skills 3 used` | Library: skills used this session | None |

The prompt row keeps showing the last prompt's figures after it ends, until the next prompt starts. The Resources view shows the full range.

The legend runs along the bottom-left: green is done, amber is in progress, gray is planned, rose is blocked. Section "Buildings" shows what each looks like.

### Districts

A task's area comes from the first of these that applies:

1. **The task's `metadata.area`**, given when the task was created (or `area` in the project tool's task list). Polis lowercases it and cuts it to 24 characters. With the default `guidance` option, Polis asks Claude to set it on every task.
2. **Its parent's area**, for a sub-task created without an area of its own.
3. **The words of its subject.** Polis checks the rows below in order, and the first row with a match wins. Matching starts at the beginning of a word, so `test*` matches "unit test" and "testing" but not "latest". An `*` means any ending.
4. **`general`**, when nothing matched.

| Area | Trigger words |
| --- | --- |
| `tests` | `test*`, spec, specs, `verif*`, qa, coverage |
| `docs` | doc, docs, readme, `document*`, writeup, writeups, write-up, write-ups, changelog |
| `ui` | ui, ux, view, views, page, pages, css, `styl*`, `design*`, layout, layouts, `component*`, frontend |
| `backend` | api, apis, endpoint, endpoints, server, servers, backend, database, databases, db, schema, schemas, `migrat*`, `quer*` |
| `research` | `research*`, `explor*`, `investigat*`, `audit*`, `review*`, `analy*`, `survey*`, `find*` |
| `ops` | `deploy*`, `releas*`, ci, `build*`, `config*`, setup, `install*`, `infra*`, pipeline, pipelines |

Because the order matters, "Write tests for the API" lands in `tests`, not `backend`. Words are matched literally, so "Build the lexer" lands in `ops`. Items on Claude's to-do list carry no metadata, so their area is always inferred.

Districts are built in the order their first task appears in the task list, which is the order the tasks were created. Items on Claude's to-do list are the exception: each time a to-do list is rewritten its items move to the end of the list, so a district made only of to-do items can change place. In the avenue layout the first goes to the lower right of City Hall, the second to its lower left, and the third in the middle in front of it. The pattern then repeats toward you: a pair side by side, then one in the middle. The city holds 11 districts. A twelfth area is not drawn.

Polis rebuilds the districts from the current task list each time. If Clear finished removes the last task of an area, its district disappears and the later districts move up a slot.

Each district has a name plate under the front corner of its block, such as `API  3/5`:

- The area name in capitals, cut to 10 characters with an ellipsis if longer.
- The tasks done and the tasks in the district.
- A thin bar below, filled green in proportion to done.
- `+N` at the end when the district has more than 16 tasks. Only the first 16 tasks it received get a building. `+N` is the number left out, always the newest. They still count in the done/total and in the bar.

![One district with a name plate and one agent at work](images/city-one-district.svg)

### Buildings

| State | How it is drawn |
| --- | --- |
| Planned | A flat lot: dark ground, a dashed gray outline, and a small stake with a round marker. No height. |
| In progress | An amber half-built shell, 55% of the final height (at least 6 units), inside scaffolding that reaches the final height. A crane stands on top with a blinking light. |
| Done | The full-height building, green, with rows of lit windows. |
| Blocked | A task that is not done and waits on a task that is not done. A planned lot gets a rose outline and a rose dashed barrier instead of the stake. An in-progress building turns rose, shell and scaffolding. A done task is never blocked. |

![One district with a planned, an in-progress, a done and a blocked task](images/building-states.svg)

Done buildings stay in the city until Clear finished removes them.

What decides a building's footprint and height:

- **How many tasks the district has.** The district's lot grid grows with them, and each lot shrinks to fit.

  | Tasks in the district | Lot grid | Lot width, compared with a lone task |
  | --- | --- | --- |
  | 1 | 1 by 1 | 100% |
  | 2 to 4 | 2 by 2 | about 87% |
  | 5 to 9 | 3 by 3 | about 58% |
  | 10 to 16 | 4 by 4 | about 44% |

  Lots fill from the front corner of the block toward the back, in the order the tasks were created. In a district with up to 4 tasks, the buildings are also taller, by up to 1.5 times.
- **Sub-tasks.** A task with sub-tasks is taller: 7 units for each sub-task, counting up to 4. A sub-task gets a lot of its own, 72% as wide as a top-level task would be. In a district of 5 or more tasks it is also 70% as tall; in a district of 4 or fewer it is only about half as tall, because the full-size buildings there are drawn taller and the sub-task is not. Nothing else ties it to its parent.
- **Nothing else.** A few units of every building's height come from its task ID, so neighbors differ. Height says nothing about effort or importance.

A task becomes a sub-task when it is created with `metadata.parent` (or `parent` in the project tool), when an agent that already has a task creates it, or when that agent writes its to-do list.

Trees stand on lots left over in a district's grid, at most two, at the back first. A district with exactly 1, 4, 9 or 16 tasks has no spare lot and no trees. Trees mean nothing. They give way as tasks arrive.

### Blockers

A dashed rose arc runs from the task that is waited on (the blocker) to the task that waits. A dot marks the waiting end. The arc rises from the roof of the blocker's building at its current height and lands on the roof of the waiting one, so a planned lot is reached at ground level.

An arc disappears when the blocker is done or deleted, when the waiting task is done, or when either building is not drawn (a `+N` task, or a district past the eleventh). At most 12 arcs are drawn. Beyond that, arcs for tasks later in the task list are left out, but those buildings stay rose.

### People

The **main session** is the figure in the straw hat. It stands at the front tip of the civic block, nearest you, and carries the tools it has used most across the whole session.

**Agents** are drawn only while they are starting or running. A finished agent leaves the city. At most 24 are drawn, the 24 started most recently. An agent stands on the roof of its building, at the height the building has now: on the ground for a planned lot, on the half-built shell for a task in progress, on top for a done task. Several agents on one building spread out to its left and right.

![The agent types, each carrying its most-used tools](images/agent-icons.svg)

**Which building is an agent's own.** Polis decides in three ways. The latest to apply wins, and the agent stays on that building, even once it is done, until another applies.

1. **When the agent starts.** Polis compares the words of the agent's name and description with the subject of every task that is not done. It ignores words under three letters and filler such as "the", "file", "add", "create" and "task". A task qualifies when it shares at least one word and scores 0.4 or more: shared words divided by the word count of the shorter text, plus 0.1 if the task is in progress. The best score wins. If none qualifies and exactly one task is in progress, the agent goes to that one. This match is made once, so a task created after the agent started is not found this way.
2. **When a task is updated with the task tool.** An agent that marks a task in progress moves to it. When an update sets an owner, the running agent whose name equals that owner moves to the task.
3. **When tasks are recorded with the project tool** (for hosts with no task tool of their own). A running agent whose name equals the owner of an in-progress task moves to it.

An agent with no building stands beside the main session, in a fan to its left and right. This includes agents whose building is not drawn. At most 6 are drawn this way.

**What the figure shows.** Each figure is a small chibi character. Its costume and the color of its outfit give the agent type.

| Type | Outfit | Costume | In text |
| --- | --- | --- | --- |
| Main session | Blue | The captain: a straw hat with a red band | ◆ |
| `Explore` | Teal | The scout: blond spiky hair and a ninja headband | ◎ |
| `Plan` | Violet | The planner: white spiky hair, a blindfold and a high collar | ▧ |
| `worker` (`polis:worker`) | Amber | A dark-haired ninja with a blue headband | ⚒ |
| `verifier` (`polis:verifier`) | Green | A sorcery student: dark fringe and a high collar | ✓ |
| `general-purpose`, `claude` | Blue | A deckhand in a red bandana | ● |
| Any other type | Blue, teal, violet, amber or green, always the same for a given type | A deckhand in a red bandana | ● |

A plugin's type `plugin:name` is looked up by its `name`, which is why `polis:worker` looks like `worker`.

Up to three **tool badges** float over the head. They are the tool families the agent has used most so far, and they change as it works. Planning and unknown tools say little about what an agent does, so `plan` and `other` rank last: they appear only if fewer than three other families have been used. A badge shows nothing until the first tool call. Polis's own project tool is not counted.

| Badge | Family | Tools |
| --- | --- | --- |
| Magnifier, teal | search | Grep, Glob, ToolSearch |
| Open book, blue | read | Read |
| Pencil, amber | edit | Edit, Write, NotebookEdit |
| Prompt arrow, green | shell | Bash, PowerShell, Monitor, TaskStop |
| Globe, teal | web | WebFetch, WebSearch |
| Plug, violet | connectors | Any tool whose name starts with `mcp__` |
| Star, violet | skills | Skill |
| Two arrows, blue | delegate | Agent, Workflow, SendMessage |
| List, gray | plan | TodoWrite, TaskCreate, TaskUpdate, TaskList, TaskGet, EnterPlanMode, ExitPlanMode, AskUserQuestion |
| Dot, gray | other | Every other tool |

A soft ring **pulses** around the head of a working figure. Every agent drawn is running, so each pulses. The main session's figure pulses only while it is working on a prompt.

A thin **dotted line** joins each agent to the figure that started it: the parent agent, if that agent is drawn, or else the main session.

### Tooltips

Hover over a part of the picture to read its tooltip. Only these parts have one:

| Hover over | It tells you |
| --- | --- |
| A building | The task's subject (cut at 80 characters), its state (planned, in progress, done or blocked), its owner if it has one, and its area. |
| The main session | Working or idle, and the tool calls made this prompt. |
| An agent | Its name if it has one, then what it was asked (cut at 60 characters), its type, its tool calls and its tokens. |
| City Hall | The main session, working or idle. |
| Power plant | The context window percentage, and tokens used of the window. Also the tokens this prompt has used against the range expected, or "no prompt yet". |
| Library | The skills used (the first 6) and the skills Polis suggests for the work. |
| Works yard | Each running process as its kind and label (the first 5), or "nothing running in the background". |

The name plates, the key, the legend, arcs and trees have none.

Hovering works where the host draws the city as a picture and has a pointer, such as the Claude desktop app's Code tab. A host without a pointer, such as the mobile app, draws the picture but gets no hover, and Polis leaves "Hover anything for detail" out of the caption there. A terminal draws no picture at all (see "The terminal's text version"). A very large city can lose its tooltips (see "Very large boards").

### The two layouts

The **avenue** is the wide layout. Districts sit three across, as described under "Districts". The key stands beside City Hall and the legend runs in one row of four.

The **column** is one block wide. Districts stand in a single file straight toward you, the first directly in front of City Hall. The key moves above City Hall, the legend becomes two rows of two, and the words are drawn 1.2 times larger against the buildings so they stay readable when the host scales the picture down to a narrow pane. The caption under the picture is shorter too. The column holds the same 11 districts.

![The one-block-wide layout, for a narrow pane](images/city-narrow.svg)

The width of the pane switches between them. Under 44 columns you get the column, otherwise the avenue. The pane asks for 68 columns, so it opens as the avenue. The desktop app docks it about 20 columns wide when the conversation shares the window with other panes, and you then get the column. Widen the pane to get the avenue back.

### The terminal's text version

A terminal cannot draw pictures, so the City view is a row of text per district:

```
◆ city hall working ●
api        █ ▓ ░ 1/3 ⚒
ui         █ █ ░ 2/3
⚡ power ███ ░░░░░░░ context 34%
◈ works: 1 running  ✦ library: 2 skills used
```

| Part | Meaning |
| --- | --- |
| `◆ city hall` with `working` or `idle` | The main session. The glyphs after it are running agents with no task. |
| `api` | The area name, cut to 10 characters, in lowercase as given. |
| `█ ▓ ░` | One block per task, up to 24: `█` done (green), `▓` in progress (amber), `░` planned (gray). A blocked task's block is rose. |
| `1/3` | Tasks done over all tasks in the district, including any past 24 blocks. |
| `⚒` at the row's end | A running agent working on a task in this district, in the type's glyph and color (see the table above). |
| `⚡ power` | The context window: a 10-cell bar and the percentage. |
| `◈ works` and `✦ library` | Running background processes and skills used. |

The text version shows up to 12 districts, one more than the picture. It does not show sub-tasks apart from other tasks, blocker arcs, the prompt meter, the key or tooltips. With no tasks it says "No districts yet: they appear with the first tasks."

### Very large boards

The host accepts a drawing of at most 131,072 characters, and a big board can pass that. Polis then draws the city again with less, one step at a time:

1. If the full drawing is over 120,000 characters, Polis redraws it **without building detail**: no scaffolding, cranes or lit windows. States are still told apart by color and height. A done building is full height and green, an in-progress one is a half-height shell in amber, and a planned lot is flat. Arcs and figures stay.
2. If that is still 131,072 characters or more, Polis also drops **all tooltips**.

The city's own caps keep the board bounded: 11 districts, 16 buildings in each (176 in all), 24 agents and 12 arcs. Polis also keeps only the 240 most recent tasks, and the oldest drop out first. The first step starts at roughly 50 to 160 buildings. Done and in-progress buildings and agents add the most, so it comes sooner on a board of finished work with many agents on screen, and later or never on a board of mostly planned lots. A full city of 176 buildings and 24 agents still fits after the first step, so the second is a safety net you are unlikely to see.

![A large city: eight districts, 89 buildings and six agents (the caps are 11, 176 and 24)](images/city-full.svg)

## The other views

The pane has six views. Switch with the buttons along its top (hotkeys 1 to 6, in the order Overview, City, Tasks, Agents, Resources, Skills) or with a command such as `/city tasks`. This chapter covers every view except the city map. Where the pane is under 44 columns wide, each bar moves under its label and long text wraps instead of being cut off.

### Overview

One page that summarizes the rest, top to bottom.

| Block | What its lines mean |
| --- | --- |
| PROJECT | The note beside the heading reads `session 3 · 41 turns · 1.2M tokens so far`: how many sessions you have had in this project, how many turns Polis has recorded (see "Which turns are recorded"), and their tokens. Under it, the progress bar and up to eight milestones: ✔ done, ▶ active, ○ planned. |
| THIS PROMPT | The same three gauges as in Resources, described there. It reads LAST PROMPT once the turn has ended. |
| TASKS | `3 done · 1 active · 4 waiting`, then up to three tasks in progress. "Waiting" is every task that is neither done nor active, blocked or not. |
| AGENTS | `2 working · 7 this session`, then up to five working agents: icon, description, up to three tool glyphs, time running. |
| PROCESSES | Background work that is still running, up to four: a shell command, monitor, workflow or scheduled job (`cron`), with its kind and label. Background agents appear under Agents instead. |
| ACTIVITY | The last five events, newest first, with their age: agent started, finished or failed; task done; skill used; process started; plan updated. Polis keeps 30. "Task done" appears when Claude marks a task completed with its task tool. |
| HOT FILES | Absent until a file has been edited. Then the four most-edited files, as `7× views/overview.tsx` (the last two parts of the path). Only Claude's edit tools count (Edit, Write, NotebookEdit), by Claude or its agents. Polis remembers the 60 most recently edited files. |

**Where the percentage comes from.** If the project has milestones, progress counts them. If not, it counts this session's top-level tasks (tasks that are not sub-tasks). Either way the formula is (finished + 0.5 × active) / total, rounded: six milestones with two done and one active give (2 + 0.5) / 6 = 42%. An active item counts half. Claude records milestones through Polis's `project` tool when it plans project-level work. They are kept per project (the git root, or the working folder if there is none) from one session to the next. The pane has no control for editing them; ask Claude to update the plan. With `guidance` off, the tool is not offered and no new milestones are recorded. When progress follows tasks, **Clear finished** removes completed tasks from the count, so the percentage can drop.

**The three buttons** (hotkeys on the buttons):

| Button | What it does |
| --- | --- |
| Orchestrate (`o`) | Puts `/orchestrate ` in the prompt box, replacing what is there, so you can add a goal. Where the host does not let a mod fill the box, a toast tells you to type `/orchestrate <goal>` yourself. Sending it asks Claude to split the goal into 3 to 8 tasks, run the independent ones as parallel agents (`polis:worker`, `Explore`, `polis:verifier`) and check their reports before accepting them. |
| Clear finished (`c`) | Removes completed tasks, agents that are no longer working (done or failed) and processes that are no longer running. Activity, hot files and the history behind the ranges stay. |
| Stop turn (`s`) | Shown only while Claude is working. Interrupts the current turn. |

### Tasks

The task tree, with `3 done · 1 active · 4 waiting` in the heading. Top-level tasks come in the order they were made, each followed by its sub-tasks, indented two columns per level with a `└` (five levels at most). A sub-task made by an agent nests under the task that agent is working on. Polis keeps the newest 240 tasks.

| Mark | Meaning |
| --- | --- |
| ✔ (green, dimmed text) | Completed |
| ▶ (amber, bold text) | In progress. Shown in its "doing" form, such as "Running tests", when Claude gave one. |
| ○ (gray) | Pending |
| ⊘ (rose) | Blocked: it is not finished and waits on at least one task that is not finished. It replaces the other marks. |

After the title, up to three small tags:

- **Area** (faint): the work area, which is the task's district on the map. Claude sets it when it makes the task. Otherwise Polis guesses from the words of the title, first match winning in this order: tests (test, spec, verify, qa, coverage), docs (doc, document, readme, write-up, changelog), ui (ui, ux, view, page, css, style, design, layout, component, frontend), backend (api, endpoint, server, backend, database, db, schema, migration, query), research (research, explore, investigate, audit, review, analyze, survey, find), ops (deploy, release, ci, build, config, setup, install, infra, pipeline); anything else is `general`. Most of these count in their other forms too (testing, documented, reviewing, deployment); the table in [Reading the city](#districts) has the exact rule. A sub-task made with the task tool that has no area of its own takes its parent's. Items an agent writes on its to-do list have no area field, so their area is always guessed from the title.
- **Owner** (`@name`, blue): the task's owner, usually an agent's name, when Claude set one.
- **waits on 2, 3** (rose): the ids of the unfinished tasks it waits on. It appears only while the task is blocked.

At most 60 rows are drawn; the rest collapse to `+12 more`. In a narrow pane the tags move under the title.

### Agents

Your main session first: its icon, `Main session`, `working` or `idle` (plus "city hall", its building on the map) and its own equipment line. Then one card per agent, nested by who started whom: an agent started by another agent is indented under it with a `└`, to seven levels. The heading shows `2 working · 7 this session`. Polis keeps the 60 most recent agents; this view draws the 30 most recent of them.

![The agent types, each carrying the tools it uses most](images/agent-icons.svg)

Each card has up to four lines:

1. **Title and status mark.** `name: description` (or just the description, which is the short summary Claude gave when starting it; the type if it gave none), bold while working. The mark: ◌ starting (gray), ● running (amber), ✔ done (green), ✘ failed (rose). Failed means the run ended any way but an answer, the start was refused, or Claude Code reports it failed or was stopped.
2. **Facts.** For example `Explore · running · 1m12s · 38k tokens · 14 tools · Grep`: type, status, elapsed time (it stops when the agent ends), tokens (its own requests: uncached input plus cache writes plus output), number of tool calls, and the last tool it called (only while it works).
3. **Equipment.** The five tool families it has used most, with counts, such as `✎ edit ×4`, or "no tools used yet". Planning and "other" tools sort last whatever their count.
4. **→ task.** The task Polis believes it works on. At start Polis matches the agent's name and description to open tasks by shared words, falling back to the one task in progress if there is exactly one; it moves when the agent or its named owner takes up a task. This is a guess and may be missing or wrong.

The icon is a vector drawing in the desktop app: a chibi character in the type's costume and color, the top three tool families as badges over its head, and a pulse while it works. A terminal shows one glyph instead. Types: main ◆ blue, Explore ◎ teal, Plan ▧ lavender, worker ⚒ amber, verifier ✓ green, general-purpose ● blue. Any other type is ● in a color picked from its name. A plugin's type such as `polis:worker` is looked up by the part after the colon.

| Family | Glyph | Tools counted |
| --- | --- | --- |
| search | ⌕ | Grep, Glob, ToolSearch |
| read | ▤ | Read |
| edit | ✎ | Edit, Write, NotebookEdit |
| shell | ❯ | Bash, PowerShell, Monitor, TaskStop |
| web | ◍ | WebFetch, WebSearch |
| connectors | ⧉ | any connector (MCP) tool |
| skills | ✦ | Skill |
| delegate | ⇄ | Agent, Workflow, SendMessage |
| plan | ☰ | TodoWrite, TaskCreate, TaskUpdate, TaskList, TaskGet, plan mode (EnterPlanMode, ExitPlanMode), AskUserQuestion |
| other | · | everything else |

### Resources

#### This prompt

The block opens with `medium · sized by heuristic · range from starting defaults`. Three gauges compare what the prompt has used so far with what a prompt of its size is expected to use: **tokens**, **time** and **tools**. Each reads like `18k of 24k–90k`: used so far, then the expected low and high. The bar fills toward the high end. A fourth line gives `12 requests · 9.1k written · 640k from cache · 2 agents`: model requests made, output tokens, cache reads, agents started during the prompt.

**Size classes.** Polis first sorts the prompt into one of four:

| Class | Label | Meant for | Starting defaults (tokens · time · tools) | Range shown at first |
| --- | --- | --- | --- | --- |
| S | small | a question, a lookup, or one small edit | 15,000 · 30 s · 3 | 6.0k–23k · 12s–45s · 1–5 |
| M | medium | a focused change touching a few files, or a short investigation | 60,000 · 2.5 min · 12 | 24k–90k · 1m00s–3m45s · 5–18 |
| L | large | a multi-step feature, refactor or investigation across many files | 220,000 · 10 min · 40 | 88k–330k · 4m00s–15m00s · 16–60 |
| XL | very large | a large multi-part project that needs planning and delegation | 700,000 · 30 min · 120 | 280k–1.1M · 12m00s–45m00s · 48–180 |

**Sizing by rule** (the "heuristic"), applied to the text you sent, in this order:

1. By length: under 200 characters is S, 200 to 899 is M, 900 to 3,499 is L, 3,500 or more is XL. A pasted log or file counts.
2. By lists: three or more bullet or numbered lines make it at least L; eight or more make it XL.
3. Big-work words move it up one size (XL stays XL): refactor, implement, build, migrate, rewrite, redesign and orchestrate in any of their forms (refactoring, building, migration), and end-to-end, across, entire, whole, every, "all of".
4. Then, if it is still S or M, begins with a question word (what, why, how, where, when, which, who, is, are, does, do, can, could, explain, show, tell), is under 300 characters and has no big-work word, it is S.

**Sizing by a small model.** The `estimate` option (in `/config`) has three values. `history`: rules only, no model call. `model`: ask a small model about every prompt. `both` (the default): rules first, and the model only when the prompt is 400 characters or longer, has four or more lines, or the rules already said L or XL. The model gets the class descriptions above plus the first 4,000 characters of your prompt and must answer with one label. Your prompt never waits: the rule size shows at once and the model's answer replaces it when it arrives (the header then reads "sized by model"). If the call fails or answers anything else, the rule size stands. It happens only where something can draw, so never in the VS Code extension's panel.

**The expected range.** Until this project has five recorded turns of that size, the range is the starting default times 0.4 for the low end and times 1.5 for the high end (the table's last column); the header says "starting defaults". From the fifth recorded turn of a size, the range is the 25th to 80th percentile of those turns' tokens, time and tools, and the header says "range from N past turns". Ranges are per project and per size; Polis keeps the latest 300 turns.

#### What is counted

| Gauge | Counts |
| --- | --- |
| tokens | Uncached input, cache writes and output, summed over every model request in the prompt, including those made by agents during it. Cache reads are not included; they are shown apart as "from cache". Requests an agent makes after the prompt has ended are not added. |
| time | Wall-clock time from sending the prompt until Claude finishes; it freezes when the turn ends. |
| tools | Every tool call by Claude or its agents, counted when the call starts, including planning and task calls. Polis's own `project` tool is not counted. |

#### Colors and warning

A gauge is green below the low end (cheaper than expected), amber from the low to the high end, and rose above the high end. When tokens exceed 1.5 times the high end, a toast warns you (see "Notices").

#### The rest of the view

- **Context window.** `filled`: percent, tokens used and window size, as Claude Code measures them. Green below 60%, amber from 60%, rose from 80%.
- **Limits and cost.** One bar per rate limit your account reports, labeled with the window's name cut to eight characters (`five hou`, `seven da`). Green below 70%, amber from 70%, rose from 90%. `resets in 2h14m` appears while the reset time is in the future. With no subscription limits there are no bars. `session cost $1.84` is Claude Code's total, and stays $0.00 if the host reports none. `tokens processed` is Polis's own sum of the same three kinds of tokens over every request this session.
- **Tokens by agent.** The five agents that processed the most tokens, each with a bar showing its share of the session's total, its type and description. Empty means everything so far was the main session.
- **What prompts usually cost here.** One line per class: how many recorded turns, and the median tokens and time, such as `M 12 turns · typically 58k tokens, 2m10s`, or "no turns yet". It uses all kept turns, not only the latest five.

#### Which turns are recorded

A turn is added to this project's history when the main session finishes it with an answer and it used some tokens. It is filed under the size in effect at that moment. Not recorded: a turn you interrupted, a refused turn, one ended by an API error, one with no tokens counted, and agents' own turns (their work is inside the prompt that started them). The history is kept per project (the git root or working folder). The same turns make up the "N turns" on the Overview's project line.

### Skills

- **Used this session.** Each skill invoked, with how many times (`✦ review ×2`), most used first.
- **Suggested for this work.** Up to five skills not yet used whose name or description shares words with your last three prompts and your current task titles. Common words and words under three letters are ignored. A match in a skill's name counts three; each different match in its description counts one; a skill needs a score of at least three. The list is rebuilt when you send a prompt, and a skill leaves it once used. The line under each is its description.
- **Available.** The count in the heading is every slash command that is not built into Claude Code and does not belong to Polis (skills, plugin commands, your own commands), read once at session start, up to 120. The list shows the first 40, the used ones in purple. Descriptions are cut to 70 characters and hidden in a narrow pane.

### Notices Polis raises by itself

| Toast | When |
| --- | --- |
| "This prompt is running well past its expected token range" | Once per prompt, the moment tokens pass 1.5 times the high end of the token range. For a range of 24k–90k, that is 135k. |
| "The context window is 83% full" | When the context fills to 80% or more. It repeats only after the fill has dropped below 80% and climbed back. |
| "Agent failed: <description>" | Each time an agent's run ends without an answer. |

### Troubleshooting

| Symptom | Cause | What to do |
| --- | --- | --- |
| The pane is very narrow | The desktop app docks it about 20 columns wide when the conversation shares the window with other panes. Polis asks for 68 by 46, but your own size wins. Under 44 columns the narrow layout is used. | Drag the pane's edge wider or close another pane. `/city` repeats the request, but a size you set yourself wins. |
| The city has no districts | Districts are the tasks' areas. No tasks this session: Claude had not made any (Polis asks it to record work of three or more steps), `guidance` is off, you ran `/clear`, or **Clear finished** removed them all. | Look at the Tasks view. Ask Claude to plan its steps as tasks, or use `/orchestrate`. Check `guidance` is on. |
| Nothing draws in the VS Code extension's panel | The panel offers Polis nowhere to draw (as of extension 2.1.295). The hooks run, but Polis adds no instruction for Claude and makes no model call there. | Type `/city` for a text board. For the visuals, use the desktop app's Code tab, or `claude` in a terminal. |
| The band has disappeared | You pressed **Hide**; Claude Code is showing a feedback survey, which the band steps aside for; or the surface never asked for a band (the VS Code panel). | `/city` brings it back (and opens the pane). While it is hidden, the status line carries `◆ 3/7 tasks · 2 agents running`, and nothing once there are no tasks or working agents. |
| The expected ranges look far off | Under five recorded turns of that size, the range is a generic default. Or the rules misjudged a short but heavy prompt (they judge by text alone) or a long pasted one. Or the project's history mixes very different work. | Wait for five turns. Set `estimate` to `model` so a small model sizes every prompt. As a last resort, with Claude Code closed, delete the `history:` entry for the project from the store file below. |
| A background process still shows after it ended | Polis learns of an ending when Claude stops the process (TaskStop, CronDelete) or from the list Claude Code gives each time Claude finishes answering. One that exits by itself mid-turn stays until then. | It clears when Claude next finishes. **Clear finished** does not remove running entries; `/clear` empties the list. |
| The layout looks wrong in one place | The numbers each surface gave Polis. | Open the store file, below. |

**Where the layout numbers are kept.** Polis writes them to the store file whose name starts with `polis` in `~/.claude/plugins/store/` (on Windows, `C:\Users\<you>\.claude\plugins\store\`), under the key `rooms`. Each surface has a `desktop:pane` and `desktop:band` style entry (`terminal:`, `mobile:` and so on) holding `bodyColumns`, `bodyRows` or `maxRows`, `placement` and `viewport` as JSON text. A `bodyColumns` under 44 explains the narrow layout; the band drops the current task's name below 70. An entry is written within about five seconds of changing.
