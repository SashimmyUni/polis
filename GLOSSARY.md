# Polis

A Claude Code mod that keeps a project legible while Claude works on it: what needs the person, how the work stands, and how much room the session has left.

## Language

### Context

**Context**:
The tokens the session holds in its window right now. It falls after a compact or a clear.
_Avoid_: token usage, session tokens (those count everything processed and only rise)

**Smart zone**:
The stretch of context within which the model still reasons sharply.
_Avoid_: smart mode

**Smart-zone limit**:
The amount of context at which the smart zone ends: a fixed number of tokens whatever the size of the window, or less on a window too small to hold it.
_Avoid_: context limit, window limit

**Smart-zone caution**:
The point short of the smart-zone limit at which the session should plan how it will stop: hand its remaining pieces to sub-agents, or aim for the next phase boundary.
_Avoid_: soft limit

**Out of the smart zone**:
A session whose context has passed the smart-zone limit.
_Avoid_: dumb mode, dumb zone

**Prompt growth**:
How much context one prompt added: context at its end less context at its start. Labelled `this prompt` and `last prompt`.
_Avoid_: prompt cost, prompt tokens, ⚡, power

**Phase**:
The step of the flow the work is at, such as grilling, writing the spec, cutting tickets, implementing or reviewing; read from what the session has done, not declared.
_Avoid_: stage, process state, status (for this meaning)

**Phase boundary**:
The gap between two phases in a session, such as grilling and implementing: the only place to clear, compact or hand off.

**Next step**:
The skill or move the flow calls for after the current phase, such as `/to-tickets` after a spec, or `/clear` before an `/implement`. Labelled `next:` where space is short.
_Avoid_: suggested skills, recommendations

### Work

**Project**:
The repository Polis watches, with every session ever run in it.
_Avoid_: using it for a piece of work inside the repository

**Main session**:
The session the person talks to, as against the sub-agents it starts.
_Avoid_: this session, session (alone, for this meaning), city hall (that is the building drawing it)

**Needs you**:
The main session cannot go on until the person answers, such as a permission or a question.
_Avoid_: waiting, your turn

**Idle**:
A main session that has ended its turn and is waiting for the next prompt; nothing is blocked.
_Avoid_: your turn, waiting

**Process**:
A shell command Claude started in the background that is still running.
_Avoid_: background, works, works yard (that is the building drawing them)

**Planned**:
A task nobody has started yet.
_Avoid_: pending, waiting

**Blocked**:
A planned task that cannot start until another task is done.
_Avoid_: waits on, waiting

**Done**:
A task that is finished, whether or not anything checked it.

**Unchecked**:
A done task nothing has checked; it stands on Claude's word.
_Avoid_: not checked, nobody checked, on Claude's word alone

**Verified**:
A done task a check has confirmed.

**Archive**:
Every task the project has finished, kept permanently, including those long gone from the board.
_Avoid_: history (that is the record of past prompts), finished projects

### Where Polis shows itself

**Polis**:
The mod itself, as a whole.
_Avoid_: dashboard, city (for the product)

**Pane**:
The panel where Polis shows its views.
_Avoid_: dashboard, window

**View**:
One tab of the pane: City, Tasks, Agents or Resources.
_Avoid_: page, screen

**City view**:
The pane's home view: the strip, then the city.
_Avoid_: City (alone, for the view), overview

**City**:
The drawing of the project as buildings in districts, current or full.
_Avoid_: dashboard, map

**Strip**:
The top line of the City view: needs you, the limit warning, the next step, the smart zone and tasks done.
_Avoid_: header, banner, top bar

**Band**:
Polis's one line above the prompt, where the host draws one: the strip on a single line.
_Avoid_: header, banner, top bar

**Status line**:
Claude Code's row below the prompt, where Polis mirrors the band as text.
_Avoid_: footer

**Current city**:
The city as the work stands: what is planned, what is in progress, and what was finished in the last week. The view the pane always opens on.
_Avoid_: live city, ongoing view

**Full city**:
The current city with the whole archive built into it.
_Avoid_: history view, historical city

**Old town**:
The part of a district in the full city that stands for its oldest finished work, shown by count rather than one building per task.
_Avoid_: archive district, history block

**City page**:
The city drawn as a page that reloads itself, for a browser tab or a VS Code tab left open beside the session; read-only.
_Avoid_: page on disk, dashboard

**Full city page**:
The city page of the full city, linked to and from the city page.
_Avoid_: history page, page on disk

**Session report**:
The session written up as Markdown, short enough to paste into a pull request or a stand-up note: what was done, checked and changed.
_Avoid_: summary, board text, whole project
