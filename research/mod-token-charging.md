# How Claude Code charges for a mod's text

Research for issue #44, a child of map #42. The question: how does Claude Code charge for each kind of text a mod puts in front of Claude? That covers a `prompt.compose` system section, a registered tool (deferred or not), a registered agent type, a registered command, and `prompt.submit` context. Which of them sit in the cached prefix, and what does a cached read cost next to a fresh one?

## Sources

| Short name | What it is |
| :- | :- |
| **Types** | The engine's declarations, from the plugin-authoring skill's copy `plugin-authoring/types/claude-code.d.ts`, written by Claude Code **2.1.295**. Line numbers refer to that file. This worktree has no generated copy at `.claude-plugin/types/claude-code/index.d.ts`, because that file is gitignored. |
| **Repo types** | `types/index.d.ts` in this repo. It holds Polis's own `PluginState` and MCP tool input. It declares no engine API, so it has nothing to say on cost. |
| **Mods ref** | <https://code.claude.com/docs/en/plugins/mods/reference>: CLI and Desktop as of v2.1.290 |
| **CC caching** | <https://code.claude.com/docs/en/prompt-caching>, "How Claude Code uses prompt caching" |
| **CC MCP** | <https://code.claude.com/docs/en/mcp>, sections "Scale with MCP tool search" and "Configure tool search" |
| **CC costs** | <https://code.claude.com/docs/en/costs> |
| **CC context** | <https://code.claude.com/docs/en/context-window>, the interactive context-window explainer |
| **API caching** | <https://platform.claude.com/docs/en/build-with-claude/prompt-caching> |
| **API pricing** | <https://platform.claude.com/docs/en/about-claude/pricing> |
| **API tool search** | <https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool> |
| **API tool use** | <https://platform.claude.com/docs/en/agents-and-tools/tool-use/overview>, section "Pricing" |
| **Observed** | What this session's own context showed. The session runs Claude Code 2.1.29x with Polis loaded. It is a single observation, not a documented contract. |

## The short answer

| A mod's text | Where Claude reads it | Paid at full rate | Paid at cache-read rate | Can break the cache above it |
| :- | :- | :- | :- | :- |
| `prompt.compose` section (`scope: 'session'`) | System prompt, after the cache boundary | Once, as a cache write, when the prompt is first sent or after the text changes | Every later request | **Yes.** Changing its text re-writes the system and conversation layers. The tools layer stays cached. |
| Tool, `isDeferred: false` | The request's `tools` array, at the very top of the prefix | Once, as a cache write | Every later request (name, description and schema) | **Yes, all of it.** A change to a definition clears the whole cache. |
| Tool, deferred (`isDeferred: true`, or left out) | Its **name** only, in a listing appended to the conversation. The schema arrives later, in a ToolSearch result. | The name line once. Then each ToolSearch call: one more model request, plus the schema written as a tool result. | The name line and any loaded schema, on every later request | No. The listing is appended, and the tool list is fixed at the first request. |
| Agent type (`$.agent.register`) | Its description, in the agent listing. Observed as an appended reminder, not in the system prompt. | Once, when the listing is appended | Every later request | No ("plugin agents keep the cache") |
| Command (`$.command.register`) | **Nowhere.** Claude never reads the listing. Only the person's typeahead and `/help` show it. | Nothing for the listing. A run's output may enter the transcript. | n/a | No |
| `prompt.submit` `context` | Extra blocks in that prompt's user message | Once, as part of that turn's new input | Every later request until compaction | No. It is appended at the end. |

The rates are a share of the base input price. Every request reads the whole cached prefix again at the cache-read rate.

- **Cache read:** 0.1x the base input price, 0.05x on Opus 5.5 and Sonnet 5.5, and 0.025x on Fable 5.1 and Mythos 5.1.
- **Cache write:** 1.25x with the 5-minute TTL, 2x with the 1-hour TTL.
- **Uncached input:** 1x.
- **Output:** billed separately, at the output rate.

## 1. How a request is laid out and billed

- **The prefix runs `tools`, then `system`, then `messages`.** A change at one level invalidates that level and everything after it. Changing a tool definition "invalidates the entire cache" (API caching).
- **Claude Code builds three layers on top of that.** The system prompt holds the core instructions and the tool definitions. The project context holds CLAUDE.md and memory. The conversation comes last. "A change to the conversation layer leaves the system prompt and project context cached. A change to the system prompt invalidates everything" (CC caching, "How the cache is organized").
- **The conversation is cached too.** Each request's prefix is the whole previous request. Only the newest exchange is processed fresh, and Claude Code also marks the system context it appends partway through the conversation for caching (CC caching). So text in a message is not uncached. It is written once at the write rate, then read at the cache rate on every request after it, until compaction or `/clear`.
- **Prices.** The tables below quote API pricing.

| Model | Base input | 5m write | 1h write | Cache hit | Output |
| :- | :- | :- | :- | :- | :- |
| Opus 5.5 | $4 | $5 | $8 | $0.20 (0.05x) | $20 |
| Sonnet 5.5 | $2 | $2.50 | $4 | $0.10 (0.05x) | $10 |
| Opus 5 | $5 | $6.25 | $10 | $0.50 (0.1x) | $25 |
| Haiku 5.5 (prompts up to 100k) | $0.10 | $0.125 | $0.20 | $0.01 (0.1x) | $0.50 |

Prices are per million tokens. The footnote on the table reads: "Cache hits and refreshes on Claude Opus 5.5 and Claude Sonnet 5.5 are priced at 0.05x the base input price".

- **TTL.** A Claude subscription within its plan gets a 1-hour TTL on the main conversation. Usage credits, an API key or a cloud provider get 5 minutes. Subagents, compaction and forks get 5 minutes unless set otherwise (CC caching, "Which TTL each request gets"). A cache hit refreshes the TTL at no extra cost (API caching).
- **Rate limits.** "cache hits are not deducted against your rate limit" (API caching).
- **Plan limits.** Cached reads still draw on a subscription's plan limits: "Claude Code re-reads that history at the cached token rate, so a one-line question in a session that has been open all day still draws usage for the whole conversation" (CC costs, "Why usage climbs"). None of the pages read says how plan usage weighs a cache read against a fresh token.
- **Tool use overhead.** When `tools` is non-empty, the API adds a tool-use system prompt: 286 tokens on Opus 5.5 and Sonnet 5.5 with `auto` (API tool use, "Pricing"). Claude Code always sends tools, so one more tool adds nothing here.

## 2. Each kind of text

### `prompt.compose` system section

- **Where it goes.** A hook returns `{ sections }`, each `{ id, text, scope }`. The engine "joins each side, places the cache boundary between them and every cache marker itself" (Types, `PromptComposeResult`, ~8361). `shared` text "reads the same for everyone on this build and model: the API may cache it across organizations". `session` text varies. "A section added at the end of what `next(e)` answered is `session`" (Types, `PromptComposeScope`, `PromptComposeSection`).
- **What it costs.** The section is in the system layer, so it is part of every request's prefix. It costs one cache write when it first appears, then a cache read on every request after that. The hook fires "for every prompt it sends" (Types, `$.prompt.compose`, ~2989). Text that changes between requests means a new system layer, which re-writes the system prompt and the whole conversation at the write rate. The tools layer above it survives (API caching hierarchy). The engine says the same about the related `prompt.section`: "an unstable answer spends the prompt cache every call" (Types, ~4156).
- **Compaction.** The section survives compaction. Claude Code "reuses the system prompt layer" (CC caching, "Compacting").
- **Polis.** `GUIDANCE` is a fixed `session` section, appended when a surface draws (`hooks/register.tsx:144`, `:875`). That makes it cheap: one write, then reads. Two things would make it expensive: text that varies, and a `surfaces` check that flips between requests.

### Registered tool, upfront (`isDeferred: false`)

- **Where it goes.** `$.tool.register` declares `mcp__<plugin>__<name>`. `isDeferred: false` "puts its schema in the prompt's tool list" (Types, `ToolSpec`, ~13117).
- **What it costs.** The tool's name, description and JSON schema are all input tokens (API tool use, "Pricing"). They sit in `tools`, the top of the prefix. That means one cache write, then a cache read on every request for the rest of the conversation. Subagents with this tool pay for it again, in their own cache.
- **When it changes.** A changed definition invalidates the entire cache. Upfront tools follow these rules: "adding a definition invalidates the cache, and so does removing one on purpose" (CC caching, "Connecting or removing an MCP server"). `tool.describe` answers are "Cached for the session ... an unstable answer spends the model's prompt cache" (Types, ~4213).
- **The safe time to register.** Register at `session.start`, before the first request, with a stable description. The docs do not say whether a registration after the first request changes the tool list, so don't rely on it either way.
- **Description length.** For MCP tools, an upfront tool's description is cut at 4,096 characters, and a deferred one at 16,384 (CC MCP, "Tool search for MCP server authors"). The docs say this of MCP servers. They do not say whether a plugin-registered tool follows the same caps.
- **Polis.** `PROJECT_SPEC` is upfront (`hooks/register.tsx:209`). This session's tool list confirms it: `mcp__polis__project` carries its full schema there (Observed).

### Registered tool, deferred (`isDeferred: true`, or left out)

- **The default.** If `isDeferred` is left out, the engine defers the tool "as it places an MCP server's tool" (Types, `ToolSpec`).
- **What stays in context.** "Only tool names and server instructions load at session start" (CC MCP). The context explainer lists "MCP tools (deferred)" at about 120 tokens: "MCP tool names listed so Claude knows what is available" (CC context). This session got them as a `<system-reminder>` naming deferred tools "available via ToolSearch". The engine's attachment type for this is `deferred_tools_delta` (Types, ~14530). For one deferred tool, the standing cost is its name, about ten tokens. The listing is appended to the conversation, so it is cached like any message.
- **Server instructions.** These are appended too. Polis's tools appeared under a "## polis" server-instructions entry that reads "Tools registered by the polis plugin through $.tool.register." (Observed). That line costs a few tokens on every request, at the cache rate.
- **What a ToolSearch call costs.** Claude Code's `ToolSearch` is a client-side tool. Its result returns the matched schemas inside the conversation (Observed: the result is a `<functions>` block). One search costs:
  1. Claude's output tokens for the `ToolSearch` call.
  2. One extra model request. It re-reads the whole prefix at the cache-read rate. That is usually the largest part in a long session: 100k of context on Opus 5.5 is about $0.02 per extra request at $0.20/MTok.
  3. The loaded schema, written once as a new tool result, then read at the cache rate on every later request.
- **The API's own tool search.** The API version works the same way: the loaded definitions "count as input tokens like any other tool definition", and the search is not billed as a separate server tool (API tool search, "Usage"). The API's prefix rule is the reason deferring keeps the cache: "the API excludes deferred tools from the system-prompt prefix ... The prefix is untouched, so prompt caching is preserved."
- **Cache stability.** With deferral on, "Claude Code keeps the tool list from the conversation's first request for the whole conversation" (CC caching). Deferred tools never break the cache.
- **When deferral is off.** Deferral turns off in these cases: `ENABLE_TOOL_SEARCH=false`, a non-first-party `ANTHROPIC_BASE_URL`, HIPAA, `CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS`, and older models (CC MCP, "Configure tool search"). In these cases tools load upfront, so a deferred tool gets the upfront costs above.
- **Choosing.** Deferring trades a standing cost for a per-use cost.
  - An upfront tool costs its whole schema at the cache rate on every request, and costs nothing extra when called.
  - A deferred tool costs its name on every request. On first use it adds a round trip and its schema, and the schema is then carried at the cache rate.
  - The API docs advise keeping "your 3–5 most frequently used tools non-deferred" (API tool search, "Optimization tips").

### Registered agent type

- **What Claude reads.** `$.agent.register` defines `<plugin>:<name>`. Claude reads only the `description`, which is "the line the model reads in its listing" (Types, ~453). The `prompt` is the subagent's own system prompt. The main conversation never pays for it. A subagent pays for it each time one starts, in its own separate cache with a 5-minute TTL (CC caching, "Subagents and the cache").
- **Where the line goes.** The engine's `/context` accounting describes a custom agent as one "whose description the Agent tool's prompt carries", and counts each one's tokens (Types, `ContextAgent`, ~2093). In this session the listing came as an appended `<system-reminder>` ("Available agent types for the Agent tool"), with `polis:worker` and `polis:verifier` in it (Observed).
- **What it costs.** CC caching settles the cost: "Claude Code never invalidates the cache for a plugin's skills, commands, agents, hooks ... It appends their content after the existing conversation, so the next request pays for that content and still reads everything before it from the cache." The cost is one listing line per type, written once, then read at the cache rate on every request.
- **Dropping it.** `agent.offer` returning `{ isOffered: false }` takes the type out of the listing (Types, ~4067). Use it when only the mod spawns the type.

### Registered command

- **Claude never sees the listing.** `CommandSpec` has `name`, `description`, `argumentHint` and `immediate`. The description is "The one line the typeahead and `/help` show for it" (Types, ~1886). A registered command has no prompt body. A `command.run` hook serves it with `{ text }`. The command listing that Claude does read is "The slash commands the Skill tool's prompt lists" (Types, `ContextSlashCommands`). Those are prompt-type commands and skills.
  - **Observed.** In this session, the skills listing has no `/city` or `/orchestrate`, though Polis registers both (`hooks/register.tsx:705-715`).
  - **Cost.** Registering a command costs Claude nothing.
- **A run's output may cost something.** "its lines in the transcript" (Types, `$.command.run`), and CC caching says commands "inject their instructions as user messages at the point of invocation". Whether a mod command's `{ text }` output reaches Claude's next request is not stated for registered commands. If it does, it is appended content, written once and then read at the cache rate.
- **`/orchestrate` is different.** It does reach Claude: it calls `$.prompt.submit` with the brief (`hooks/register.tsx:1036`). That is a user turn, priced like the next section.

### `prompt.submit` context

- **Where it goes.** Each `context` entry is "one block after the prompt as typed", which "the model reads beside the prompt and the user never sees". Past 100,000 characters (200,000 all together), Claude reads a head and a path instead (Types, `PromptSubmitInput.context`, ~9051).
- **What it costs.** It is part of that turn's new user message, the uncached tail of the request. It is written once at the write rate and read at the cache rate on every request after, until `/compact` or `/clear` drops it. It never touches the system or tools layers, so it cannot break the cache.
- **When to use it.** Use it for text that varies, such as Polis's smart-zone note (`hooks/register.tsx:885`, ADR 0001). Text that changes inside a `prompt.compose` section re-writes the whole conversation. The same text here is paid once, at its own size.
- **Related channels.**
  - A settings hook's `additionalContext` "enters Claude's context" the same appended way (CC context).
  - `prompt.attachment` can rewrite or drop any reminder the engine appends, at no cost to the cache (Types, ~4187).

## 3. What follows for a mod

1. **Keep system sections fixed.** Stable `session` text costs only one cache write. Varying text re-writes the whole conversation on each change.
2. **Put text that changes in messages.** That means `prompt.submit` `context` or a `tool.call` result, never the system prompt.
3. **Defer a tool unless Claude needs it on most turns.**
   - A deferred tool costs about its name on every request, plus one round trip the first time Claude uses it.
   - An upfront tool costs its whole schema on every request, at the cache rate.
   - Either way, register before the first request, with a stable description.
4. **Agent types and commands are cheap.** An agent type costs one listing line. A command costs nothing for Claude until a run puts text into the conversation.
5. **Every request re-reads the whole prefix.** At 0.05x to 0.1x the base price, a long session pays mostly for cache reads. Text that stays in context for the whole session costs about its token count times the number of requests, at the cache-read rate.

## Open points

- The docs do not say whether `$.tool.register` with `isDeferred: false` after the first request changes the tool list and so invalidates the cache.
- No page says whether the MCP description caps (4,096 characters upfront, 16,384 deferred) apply to plugin-registered tools.
- It is unknown whether a registered command's `{ text }` output is put in front of Claude on the next request.
- The agent listing is placed in an appended reminder in this session, which is observed behaviour. The Types wording ("the Agent tool's prompt") points at an older placement.
- None of the pages read says how subscription plan usage weighs a cache read against a fresh input token.
