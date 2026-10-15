# UI ambiguity audit

The evidence for [Map: refine Polis's UI/UX to be minimal, actionable and unambiguous](https://github.com/SashimmyUni/polis/issues/14), from [Inconsistency audit of every user-facing string](https://github.com/SashimmyUni/polis/issues/15). Taken on `claude/wayfinder-ui-ux-refinement-683d1d` at `7fded97` (the smart-zone branch). Each entry: what, where, kind. Kinds: **two-names** (one concept, several names), **two-meanings** (one word, glyph or color, several concepts), **stale** (docs or UI contradict the code), **duplicate**, **unlabeled**, **surprise** (behaviour a reader would not predict).

Fixing an entry is not this audit's job; the tickets downstream decide.

## 1. Context: two systems at once

The smart-zone work moved the band to tokens; every other surface still reads the window percentage on the old 60/80 thresholds.

| # | What | Where | Kind |
|---|---|---|---|
| 1.1 | Band shows `ctx 38k` coloured by smart-zone level (muted / amber / rose); the manual documents `ctx 38%`, amber from 60%, rose from 80%. | `views.tsx:475-482`; `MANUAL.md:68` | stale |
| 1.2 | Resources "CONTEXT WINDOW" meter, power plant tank, city key `context 71%`, city text `⚡ power … context 34%`, `/city` text `Context: N%`, report `Context window: N%` all use percent with green/amber/rose at 60/80. Two meanings of "how full is context" coexist, with different colours for the same number. | `views.tsx:884-897, 996, 1047, 1125`; `city.ts:357-392, 1026, 1110, 1186`; `report.ts:231` | two-meanings |
| 1.3 | Manual still lists a notice "The context window is 83% full" at 80%; the code now toasts the smart-zone caution/limit instead. | `MANUAL.md:899`; `logic.ts:892` | stale |
| 1.4 | "Context" is green when low on Resources and the plant, but muted (grey) when inside the smart zone on the band. | `views.tsx:131, 884` | two-meanings |

## 2. Task states: three names for "not started"

| # | What | Where | Kind |
|---|---|---|---|
| 2.1 | A not-started task is `pending` (code), "waiting" (Overview/Tasks headings, `/city` text, text-city legend `░ waiting`), and "planned" (city legend, buildings). | `views.tsx:590, 700, 1066, 1117`; `MANUAL.md:308, 747` | two-names |
| 2.2 | "Waiting" also means Claude waiting on the person (`waiting 2m05s`), and "waits on" means a blocked task. Three concepts under one word. | `views.tsx:278, 729`; `MANUAL.md:430` | two-meanings |
| 2.3 | "Done" is any completed task in counts (`3 done`) but, in the city legend, only a completed task nothing has checked ("verified" is the other). | `MANUAL.md:308`; `views.tsx:590` | two-meanings |
| 2.4 | A completed-but-unchecked task is "not checked", "done, not checked", "on Claude's word alone", "nobody checked", "unchecked" (code). | `views.tsx:283-293, 682-683, 1066`; `README.md` City bullet | two-names |
| 2.5 | `of done` label before the verification breakdown reads as a fragment. | `views.tsx:600, 702` | unlabeled |
| 2.6 | Progress counts milestones (or top-level tasks, in-progress = half) while `2/5 tasks` beside it counts all tasks incl. sub-tasks: two different denominators side by side with no label saying which. | `views.tsx:452-459`; `MANUAL.md:63-64` | unlabeled |

## 3. Glyphs carrying several meanings

| # | Glyph | Meanings | Where |
|---|---|---|---|
| 3.1 | `◆` | project name (band), main agent, status-line prefix, pane title `◆ POLIS`, city hall in text city | `views.tsx:447, 1009, 1163`; `theme.ts` LOOKS.main; `register.tsx:346` |
| 3.2 | `✔` | task completed, agent run done, check passed, unchecked-done (with `✔✔` = verified) | `views.tsx:116-127, 682-683`; `checks.ts` |
| 3.3 | `✓` vs `✔` | verifier agent glyph vs passed/done — near-identical glyphs, different concepts | `theme.ts` LOOKS.verifier |
| 3.4 | `◌` | check passed-but-stale; agent starting | `views.tsx:122`; `checks.ts` |
| 3.5 | `●` | agent running; general-purpose agent glyph; live session in Project view; live agents in `/city` text | `views.tsx:123, 336, 765, 1121`; `theme.ts` |
| 3.6 | `○` | pending task; other session in Project view | `views.tsx:118, 767` |
| 3.7 | `⚡` | this prompt's tokens (band) vs context window "power" (text city) | `views.tsx:470, 1044` |
| 3.8 | `✘` | check failed, agent failed, task refuted, crossed-out building in text city | `views.tsx:125, 1000` |
| 3.9 | `▶` vs `▓` vs scaffolding | in progress has a different mark in Tasks, text city and city | `views.tsx:117, 997` |
| 3.10 | Band agent glyphs `⚒ ◎ ▧ ✓ ●` appear with no label; only the manual decodes them. | `views.tsx:460-462` | unlabeled |
| 3.11 | Tool-family glyphs `⌕ ▤ ✎ ❯ ◍ ⧉ ✦ ⇄ ☰ ·` beside agents in Overview with no label (Agents view labels them). `✦` is also "skills" in the Skills view and text city library; `✧` marks suggested skills. | `theme.ts:48-59`; `views.tsx:622, 960, 969, 1051` | unlabeled / two-meanings |

## 4. Colours carrying several meanings

| # | Colour | Meanings |
|---|---|---|
| 4.1 | Amber (`C.run`) | in progress; prompt inside its expected range; check stale; smart-zone caution; worker agent; edit tool family; running agent mark; suggested skill; "your turn" on city key; power plant body |
| 4.2 | Green (`C.done`) | done / passed / verified; prompt *under* its range (good, but reads as "finished"); context low; verifier agent; shell tool family |
| 4.3 | Rose (`C.fail`) | needs you; failed; blocked; prompt over range; out of smart zone; limit warning |
| 4.4 | Blue (`C.agent`) | project name; every heading; main agent; general agent; read and delegate families; owner `@name` |
| 4.5 | Teal (`C.proc`) | processes; Explore agent; search and web families; `code` area tag |
| 4.6 | Limit meters use their own thresholds (amber 70%, rose 90%) unlike context (60/80) and smart zone (80% of limit). | `views.tsx:908` |

Rose is the only colour with a single loose meaning ("act / bad"); amber carries at least six unrelated ones.

## 5. Names for the product and its parts

| # | What | Where | Kind |
|---|---|---|---|
| 5.1 | The glossary's **City page** says *avoid "page on disk"*; README, MANUAL heading "A self-refreshing page on disk", `/city page` replies, the option title "Page on disk" all use it. | `GLOSSARY.md`; `README.md:25`; `MANUAL.md:88, 114, 171`; `register.tsx:960-963`; `plugin.json:43` | two-names |
| 5.2 | The glossary avoids "dashboard" for the city page; the pane/product is called "dashboard" in the plugin description, `/city` description, option title "Open the dashboard by itself", the guidance text, the manual's first line — but never defined. Pane vs dashboard vs Polis vs city. | `plugin.json:4, 23`; `register.tsx:149, 163, 684`; `MANUAL.md:3` | two-names |
| 5.3 | "City" names the product command (`/city` opens the pane, at any view), the band button (opens the City view), one of seven views, and the drawing. | `views.tsx:495`; `register.tsx:681` | two-meanings |
| 5.4 | The main session is "Main session", "city hall", "session" (city key), "main session" (column layout), "this session" (Project view). | `views.tsx:827-829, 765`; `MANUAL.md:303` | two-names |
| 5.5 | Idle main session reads `idle` on Agents but `idle` or `your turn` on the city key, with no stated difference in the pane. | `views.tsx:829`; `MANUAL.md:303` | two-names |
| 5.6 | Processes are "PROCESSES" (Overview), "background" (city key), "works" (text city), "Background:" (`/city` text), "works yard" (city). | `views.tsx:627, 1050, 1127`; `MANUAL.md:303` | two-names |
| 5.7 | This prompt's cost is `⚡12k/90k` (band), `prompt 410k/330k` (city key), "THIS PROMPT"/"LAST PROMPT" (Overview, Resources), `This prompt:`/`Last prompt:` (`/city` text). | `views.tsx:367-377, 470, 1109` | two-names |

## 6. Commands

| # | What | Where | Kind |
|---|---|---|---|
| 6.1 | README lists `/city [overview|project|city|…]` and again `/city [overview|city|tasks|…]` (without `project`). | `README.md:23, 25` | duplicate |
| 6.2 | `/city <anything unknown>` (a typo, `/city cty`, `/city city tasks`) silently opens the last view, no message. | `register.tsx:975-990`; `MANUAL.md:80` | surprise |
| 6.3 | `/city report <anything but save>` quietly ignores the option. | `register.tsx:926-928` | surprise |
| 6.4 | `/city project` answers as text where nothing draws, opens the Project view where something does; every other view answers with the whole board as text where nothing draws. Same word, three behaviours by host. | `register.tsx:938-956, 984-986` | surprise |
| 6.5 | The argument hint orders words `[overview|city|tasks|agents|resources|skills|report [save]|project|page]`, unlike the tab order (Project is tab 2). | `register.tsx:685`; `theme.ts` VIEWS | two-names |
| 6.6 | `/city` with no argument opens City; the band's "City" button opens City; but "Polis opened." is the reply, and Overview is said to be the default "in a new session" for unknown words. | `register.tsx:987`; `MANUAL.md:80` | surprise |

## 7. Docs that contradict the code or each other

| # | What | Where |
|---|---|---|
| 7.1 | Manual's band table lists `◆ atlas` twice (before and after "needs you"). | `MANUAL.md:57, 59` |
| 7.2 | VS Code row says the chat panel draws nothing "as of 2.1.295"; research shows the pane draws from 2.1.299. | `MANUAL.md:27`; `README.md` "Where it draws" |
| 7.3 | README's Options table lacks `smartZone`, which the manifest has. | `README.md` Options; `plugin.json:35` |
| 7.4 | README says the pane has "seven views" while the plugin description lists six things (no Project). | `README.md:10`; `plugin.json:4` |
| 7.5 | Manual's Options section names five option titles; the manifest has six. | `MANUAL.md:173`; `plugin.json` |
| 7.6 | Pass-5 and later work (Current/Full city, Old town, archive) is in the glossary but not in README or MANUAL yet. | `GLOSSARY.md`; open tickets of map #4 |

## 8. Things shown with no explanation on the surface

| # | What | Where |
|---|---|---|
| 8.1 | Band's prompt figure `⚡12k/90k` — no word saying it is this prompt against the top of its expected range. | `views.tsx:470` |
| 8.2 | Progress bar in the band has no label; with milestones it measures something different from `n/m tasks` next to it (see 2.6). | `views.tsx:452-455` |
| 8.3 | Overview prompt heading `M · sized by heuristic · range from starting defaults` is jargon (size letter, source, basis). | `views.tsx:373-377` |
| 8.4 | Area tag `code` (teal) beside a task's area says where the area came from, not what it is. | `views.tsx:727` |
| 8.5 | Equipment glyphs (3.11) and agent glyphs (3.10) have no on-surface legend outside the Agents view. | — |

## Counts

| Kind | Entries |
|---|---|
| two-meanings | 16 (incl. all of §3 and §4) |
| two-names | 11 |
| stale | 9 |
| surprise | 5 |
| unlabeled | 8 |
| duplicate | 2 |
