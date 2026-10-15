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

**Phase**:
The step of the flow the work is at, such as grilling, writing the spec, cutting tickets, implementing or reviewing; read from what the session has done, not declared.
_Avoid_: stage, process state, status (for this meaning)

**Phase boundary**:
The gap between two phases in a session, such as grilling and implementing: the only place to clear, compact or hand off.

**Next step**:
The skill or move the flow calls for after the current phase, such as `/to-tickets` after a spec, or `/clear` before an `/implement`.
_Avoid_: suggested skills, recommendations

### Work

**Project**:
The repository Polis watches, with every session ever run in it.
_Avoid_: using it for a piece of work inside the repository

**Archive**:
Every task the project has finished, kept permanently, including those long gone from the board.
_Avoid_: history (that is the record of past prompts), finished projects

### Where Polis shows itself

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
