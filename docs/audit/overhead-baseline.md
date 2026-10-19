# Polis's overhead: the baseline

Measured 2026-10-19 for [issue 43](https://github.com/SashimmyUni/polis/issues/43) on the map [Cut Polis's overhead](https://github.com/SashimmyUni/polis/issues/42), at commit `a671007` (Polis 0.2.0), with Claude Code 2.1.303 in a claude.ai cloud container. **Overhead** is as GLOSSARY.md defines it: every token processed because Polis is installed, on any model, per session. Nothing here changes Polis; it is the yardstick later cuts are judged against.

Rerun it with `tools/overhead.ts`:

```bash
node --import ./tools/ts-resolve.mjs tools/overhead.ts static --model haiku
node --import ./tools/ts-resolve.mjs tools/overhead.ts sessions --model sonnet --repeat 2 --out sonnet.json
```

## How it counts

No API key was available for the token-counting endpoint, so every count is a **difference between two `claude -p` runs**, using the model's own tokenizer. The input of a run's first request (input + cache creation + cache read) is deterministic: four identical runs gave 37,511 tokens each time. So what one change adds to it is exact.

- Pieces Claude Code sends by itself (the agent types, the `project` tool, the commands) are the first-request difference between Polis removed, `guidance: false`, and Polis on.
- Pieces sent only in other situations (the standing instruction, the smart-zone note, the classify prompt, the brief, the agent prompts) are counted by appending the text with `--append-system-prompt` and subtracting an appended one-token marker. They are exact to a token or two where the text meets what precedes it; the engine's own wrapper around a note or a classify call is not included.
- Haiku 5.5 and Sonnet 5.5 gave identical counts for every piece.

Every run leaves out the claude.ai Artifact tool and MCP servers (`--disallowedTools Artifact --strict-mcp-config`). A cloud session's Artifact tool drops its `edits` option, and 533 tokens of schema, whenever any mod hooks every tool call (`publish_edits=false … edit_hook=true` in the debug log). Polis's catch-all `tool.call` hook triggers that, so left in, it would read as a 426-token *saving* from Polis. A local install has no Artifact tool, so this is not a real effect.

## Fixed pieces

| Piece | Tokens | Paid |
|---|---:|---|
| `worker`/`verifier` agent types (their descriptions in the Agent tool) | 107 | every request, every session |
| `project` tool schema (`PROJECT_SPEC`, non-deferred) | 709 | every request, `guidance` on |
| `/city` and `/orchestrate` command descriptions | 0 | never: mod commands are not listed to Claude |
| **Total, headless session** (no surface draws) | **816** | every request |
| `GUIDANCE` system section | 209 | every request where a surface draws |
| **Total, interactive session** (a surface draws) | **1,025** | every request |
| Smart-zone note, caution (`zoneNote('caution', …)`) | 88 | once per crossing, beside the next prompt |
| Smart-zone note, past the limit (`zoneNote('out', …)`) | 191 | once per crossing |
| `SIZING_RUBRIC` | 108 | per classify call, small model, uncached |
| Classify input at the 4,000-char cap (a sample prompt of that length) | 1,323 | per classify call, at most |
| `/orchestrate` brief, less the goal | 353 | per `/orchestrate` |
| `worker` system prompt | 104 | per worker spawned |
| `verifier` system prompt | 97 | per verifier spawned |

The `project` tool is 69% of the standing cost and the standing instruction is 20%. The agent types are 10%, and the commands cost nothing.

A classify call therefore sends at most about 108 + 1,323 = 1,431 tokens, plus the engine's wrapper, to the small model. It is made only where a surface draws, and in the default `estimate: both` only for prompts of 400+ characters, 4+ lines, or heuristically L/XL. None of the three replayed prompts qualifies: the feature prompt is 305 characters on one line, sized M.

## Sessions

Three prompts were replayed on a small fresh repository (`src/math.js`, `src/strings.js`, `src/report.js`, one test file), under four conditions:

- **off**: Polis removed.
- **guidance false**: Polis on with `guidance: false`.
- **on, headless**: Polis on, exactly as `claude -p` runs it. No standing instruction, no classify call.
- **on, drawn**: Polis on with the `GUIDANCE` text appended to the system prompt, which stands in for an interactive session where a surface draws. Headless Claude Code has no surface, so this is the closest replay available. The classify call is not replayed (see above).

The prompts:

1. **question**: "What does src/report.js do, and which functions does it depend on? Answer briefly; change no files."
2. **edit**: "Rename the function `add` in src/math.js to `sum`, update every caller and test, and run the tests."
3. **feature**: a 305-character request for a small CLI with tests and a README section.

"Tokens processed" is input + cache creation + cache read + output, summed over the session and taken from Claude Code's per-model usage. Each session used one model; no other model was called. "Prompted calls" are calls to TaskCreate, TaskUpdate, TodoWrite and `mcp__polis__project`. In these headless sessions the task tools are deferred, so a prompted run also spends one ToolSearch call loading them. Each run had its own task list (`CLAUDE_CODE_TASK_LIST_ID`).

### Sonnet 5.5 (2 runs per cell, means)

| Prompt | Polis | Tokens processed | Cache reads | Tool calls | Prompted calls |
|---|---|---:|---:|---:|---:|
| question | off | 51,883 | 42,200 | 1 | 0 |
| question | guidance false | 52,115 | 42,310 | 1 | 0 |
| question | on, headless | 53,521 | 43,665 | 1 | 0 |
| question | on, drawn | 53,949 | 44,107 | 1 | 0 |
| edit | off | 79,123 | 68,445 | 3 | 0 |
| edit | guidance false | 79,472 | 68,663 | 3 | 0 |
| edit | on, headless | 81,658 | 70,746 | 3 | 0 |
| edit | on, drawn | 82,234 | 71,378 | 3 | 0 |
| feature | off | 136,913 | 123,035 | 4 | 0 |
| feature | guidance false | 108,660 | 95,300 | 3 | 0 |
| feature | on, headless | 141,142 | 126,881 | 4 | 0 |
| feature | on, drawn | 113,345 | 99,262 | 3 | 0 |

Sonnet never made a prompted call: it did the feature in three Bash calls. The feature means mix 4-request runs (about 108k) with 6-request runs (about 166–171k; one each under off and headless). Compared at the same request count (Claude Code's `num_turns`), Polis adds:

| Prompt (requests) | guidance false | on, headless | on, drawn |
|---|---:|---:|---:|
| question (2) | +232 | +1,638 | +2,066 |
| edit (4) | +349 | +2,535 | +3,111 |
| feature (4) | +391 | +3,037 | +5,076 |

That is roughly the static size per request (2 × 1,025 = 2,050 for the drawn question; the 4-request edit and feature runs vary with output length). About 90% of it lands in cache reads.

### Haiku 5.5 (3 runs per cell, means)

| Prompt | Polis | Tokens processed | Cache reads | Tool calls | Prompted calls |
|---|---|---:|---:|---:|---:|
| question | off | 53,615 | 43,760 | 1 | 0 |
| question | guidance false | 53,800 | 43,865 | 1 | 0 |
| question | on, headless | 55,209 | 45,223 | 1 | 0 |
| question | on, drawn | 55,703 | 45,660 | 1 | 0 |
| edit | off | 151,097 | 137,124 | 10 | 0 |
| edit | guidance false | 170,884 | 156,814 | 11 | 0 |
| edit | on, headless | 125,556 | 111,747 | 10 | 0 |
| edit | on, drawn | 193,679 | 177,659 | 11 | 4 |
| feature | off | 203,195 | 182,360 | 6 | 0 |
| feature | guidance false | 160,738 | 141,065 | 5 | 0 |
| feature | on, headless | 176,845 | 155,754 | 6 | 0 |
| feature | on, drawn | 278,624 | 253,047 | 19 | 11 |

Haiku varies from run to run by up to ±30% at the same request count, so the off / guidance false / headless means above are not ordered by Polis. What stands out is the standing instruction:

- **feature, on, drawn**: all three runs followed it, with 4–5 TaskCreate, 4–9 TaskUpdate and 1 ToolSearch. Median 285,261 tokens over 19 requests, against a median of 180,903 over 7 requests for the nine runs without it. That is **+104k tokens (+58%)** for about 12 extra calls, roughly 8.7k per call: each call is one more request that re-reads the context.
- **edit, on, drawn**: one run of three followed it (4 TaskCreate, 8 TaskUpdate). It used 285,227 tokens over 21 requests, against a median of 141,986 over 11 requests without the instruction: **+143k (+101%)**. The other two runs made no prompted calls (147–149k).
- In a first pass that accidentally shared one task list across runs, Haiku made 12–14 prompted calls in every drawn edit and feature run, for +80–120%.

No run on either model called `mcp__polis__project`: none of the prompts is project-level work. Agent calls were 0 throughout.

## What the baseline says

1. **The fixed text is small.** It is 816 tokens per request headless and 1,025 interactive, about 2–4% of these short sessions, and nearly all of it is cache reads billed at a tenth. Of the three standing pieces, the `project` tool schema (709) is the largest. The `GUIDANCE` section (209) and the agent types (107) follow, and the commands cost nothing.
2. **The prompted calls are the overhead that matters.** When the model follows the standing instruction, each task create or update is a separate request that re-reads the whole context: about 8–9k tokens each in a 25k-token session, and more as context grows. That added 58–101% to Haiku's edit and feature sessions. Sonnet ignored the instruction for work it finished in three or four calls.
3. **Estimate for interactive sessions** (not measured: the task tools are not deferred there, so ToolSearch drops out). The guidance asks for one TaskCreate per step plus two TaskUpdates (in progress, completed), so about 3n calls for n steps (n ≥ 3). For project-level work it adds one `project` call when the plan is known and one or two per milestone. Haiku's observed 2–3n matches that. At roughly one context's worth of tokens per unbatched call, a 5-step task costs about 15 × the current context.
4. **The classify call** costs at most about 1.4k uncached small-model tokens per long prompt, and only where a surface draws. The three replays never trigger it.
5. **The rest are one-off**: smart-zone note 88 or 191 per crossing; `/orchestrate` brief 353 per use; worker or verifier prompt about 100 per spawn.

## Limits of this baseline

- Headless only: the "on, drawn" condition appends the standing instruction rather than letting `prompt.compose` add it, and the classify call was not replayed.
- Two models (Sonnet 5.5, Haiku 5.5) and three small prompts, with 2–3 runs per cell. Haiku's run-to-run variance is larger than Polis's fixed cost, so judge fixed-text cuts by the static table and behavioural cuts by prompted-call counts over many runs.
- Opus was not replayed; its tokenizer counts are expected to match the static table, which Haiku and Sonnet gave identically.
