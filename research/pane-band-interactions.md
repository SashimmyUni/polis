# What a Polis pane and band can do on each host

Research for issue #16. Question: what interactions can a mod's **pane** (`Pane` render site) and **band** (`AbovePrompt` render site) offer on the Claude desktop app's Code tab (`desktop` surface), `claude` in a terminal (`terminal`), and the VS Code extension's chat panel (`vscode`)?

## Sources

| Short name | What it is |
| :- | :- |
| **Types** | The engine's own declarations, the authority per the docs. Cited from the plugin-authoring skill's copy, `plugin-authoring/types/claude-code.d.ts`, written by Claude Code **2.1.295**. The copy the engine lays beside this mod, `.claude-plugin/types/claude-code/index.d.ts` (gitignored, 2.1.293), has the same text in every section cited here, about 30 lines earlier. |
| **Skill ref** | `plugin-authoring/reference.md` (2.1.295), the skill's long-form notes |
| **Ref doc** | <https://code.claude.com/docs/en/plugins/mods/reference> ("Render sites", "Elements", "Limits"). Its entries cover the CLI and Desktop as of v2.1.290, and the VS Code extension as of v2.1.299. |
| **Interface doc** | <https://code.claude.com/docs/en/plugins/mods/interface> ("Pick where to draw", "Open a pane at the right time", "Draw in the VS Code extension", "Keyboard focus and hotkeys") |
| **Gallery doc** | <https://code.claude.com/docs/en/plugins/mods/gallery> |

`types/index.d.ts` in this repo is Polis's own contract: `PluginState` and the MCP tool input. It declares no interface API. Only `ViewName` and `Ui` (types/index.d.ts:246-248) bear on this question, as the state behind view switching.

## The short answer

| Capability | Terminal | Desktop app | VS Code extension |
| :- | :-: | :-: | :-: |
| Band (`AbovePrompt`) is drawn | yes | yes | **no** |
| Pane is drawn | yes | yes | yes (ext. 2.1.299+, with feature flags fetched) |
| `Button` (click or Enter) | yes | yes | yes |
| Button `hotkey` (one digit or letter) | yes | yes (small key shown beside the label) | **ignored** |
| Button `action` (engine keybinding chord) | yes | no (terminal only) | ignored |
| `autoFocus` on a control | yes | yes | ignored |
| `Input` (text field, live `onInput`) and `Select` | yes | yes | yes |
| `Svg` (vector drawing) | **no** | yes | yes |
| Hover and `<title>` tooltips inside an `Svg` (`isInteractive`) | n/a | yes | yes |
| Clickable regions inside an `Svg` | no | **no** | **no** |
| Box `hover` styles and hover cards (`position: "absolute"`) | yes, where the terminal reports the pointer | yes | **ignored** |
| `Client` (your own module: raw pointer and keys) | yes | yes | **no** |
| `Raster`, `Image` | yes | no | no |
| `Markdown` with pressable links (`onLinkPress`) | yes, where clicks are reported (fullscreen) | element yes; press behaviour not stated | element yes; press behaviour not stated |
| `$.ui.copy` to the clipboard | yes | no ("a remote surface has no path yet") | no |

Sources for each row are in the sections below.

## 1. Where the pane and the band are drawn

- **Band: terminal and desktop only.** "Raised on the terminal and desktop surfaces only" (Types 10245-10255). The Ref doc's render-site table gives `AbovePrompt` as "Terminal, Desktop".
- **Pane: every surface.** "Raised on every surface" (Types 10302-10312). The Ref doc gives `Pane` as "Terminal, Desktop, VS Code". VS Code needs extension 2.1.299 or later and a session that fetches feature flags (Ref doc, Render sites; Interface doc, "Draw in the VS Code extension").
- **Pane placement.** The pane docks beside the transcript in a fullscreen terminal from 110 columns, and sits inline above the prompt otherwise (Types `UiOpenResult` 14134ff; `Pane.placement` 10338). In VS Code it docks in a panel at least 800 px wide. Narrower, it draws inline and shows 12 rows before it scrolls. VS Code ignores `rows` and `columns` on `$.ui.open` (Interface doc, "Draw in the VS Code extension").
- **When a pane is placed.** A pane the person asked for (their command, prompt or press) is placed at any width. One the mod opens on its own is placed from 144 terminal columns, or 110 once the person has opened that id before (Types 2500 and `UiOpenResult`; Ref doc, Limits).

## 2. Buttons: how many can a band carry?

- **No count limit is stated** anywhere in Types, Skill ref or the docs. The limits that do apply:
  - **Rows.** The band's `maxRows` is capped at half the terminal's rows, the prompt included. A taller tree scrolls in a window of `scroll.bodyRows`, with an engine-drawn "n more" row (Types 10265-10291).
  - **Columns.** The tree is laid out in `bodyColumns`: the column's width less five cells for the engine's `[-]` (Types 10277-10284).
  - **Hotkeys.** A hotkey is one digit or one lowercase letter, so at most 36 distinct ones. When two buttons share a hotkey, the later one wins (Types 1088; Ref doc, Elements). A bare digit typed into an empty prompt presses a band Button, but only one "wholly inside" the visible window (Types 10272-10273; Ref doc: "a digit `hotkey` on a button in the band also fires when the user types that digit alone into an empty prompt and pauses").
  - **Text budget.** A tree draws its first 100,000 characters. A Button whose label would not be drawn whole is replaced by words saying how much was left out, so nobody presses a cut label (Skill ref, "Drawing: ui.render").
- **Contents of a Button.** Strings and `Text` only, drawn together as one press, so a whole list row can be one Button. Any other element inside a Button is refused (Skill ref, "Drawing: ui.render"). `variant: "primary" | "secondary"`, `role: "dismiss"`, `plain`, `dimColor` and `hover` are styling hints (Types 1100-1150).
- **Per host.** The band does not exist in VS Code. In the desktop app a hotkey shows as "the label with a small key beside it". VS Code ignores `hotkey`, `plain`, `autoFocus` and `action`, so its buttons are clicked or pressed with Enter (Interface doc, "Set a hotkey and the first focus"; Ref doc, Elements).

## 3. Keys and focus

- **A mod never reads the keyboard.** Claude Code routes keys to the focused control, and only while the pane or band has the focus. The one exception is a band's digit hotkey from an empty prompt (Interface doc, "Keyboard focus and hotkeys").
- **How a site gets focus.** The person presses Ctrl+X then Tab, or clicks it. A pane can also be opened with `focus: true` from a command or a press, which is granted only while the prompt is empty and nothing else holds the keys (Types 7414; Interface doc). VS Code grants `focus: true` only when the panel has focus, Claude is idle and the prompt box is empty.
- **Keys the engine keeps.** Tab moves between controls. Up and Down move between controls, or scroll a site taller than its window. Enter presses or submits. PgUp, PgDn, Home and End scroll. Ctrl+X then an arrow resizes. Ctrl+X then X closes. Esc hands the keys back, and with `closeOnEscape` also closes the pane. "A mod can't bind Tab or the arrow keys to anything else" (Interface doc, "What each key does"; Types 7426).
- **Moving focus from code.** `$.ui.focus({ requestId, key })` moves the focus ring onto a Button, Input or Select the mod drew, while the site holds the keys (Types 2558; `UiFocusArgs` 13832). The `ui.focus` event fires before every move and can redirect or keep it (`UiFocusInput`). `autoFocus: true` picks where the ring starts (Types 1141). VS Code ignores `autoFocus`.
- **Global chords.** A Button with `action: "<keybinding action>"` is pressed by the person's own chord for that action, even from the prompt, "on the terminal while mounted" (Types 1097).
- **Raw keys.** Only a `Client` gets them: `surface.onKey` delivers each key while a click has given the Client the focus, and "Escape never arrives" (Types 1409-1415, 1595). A Client runs on the terminal and desktop only.

## 4. Navigating between views and drilling into a detail

- **There is no router or navigation primitive.** The documented pattern is "the tabs are two buttons in a row": the mod keeps the active tab in state and redraws (Interface doc, "Build a pane with tabs"). State read while drawing (`$.state`) re-renders its readers when a handler writes it (Skill ref, "Drawing: ui.render").
- **Tools for a drill-down:**
  - Buttons whose `onPress` writes a "selected item" to state, so the next draw shows its detail. A whole row can be one Button (section 2).
  - A **second pane**: `$.ui.open({ id: "detail-x", title })` opens another framed region. With several panes open, each gets a tab, and a click on a tab, or Tab then Enter, shows it (Types `Pane.title` 10313-10320). `$.ui.close` closes one, and `$.ui.panes()` lists them.
  - `$.ui.scroll({ in, to: { key } | "start" | "end", block })` brings an element into view inside the pane or band (Types 2542; `UiScrollArgs` 14259).
  - `Markdown` with `key` and `onLinkPress`: a press on a link raises `ui.press` with the link's `href` "where the surface reports clicks (the fullscreen terminal)" (Types 5698-5725; Skill ref).
- **Back.** There is no history. Write a "Back" Button yourself, or use `closeOnEscape` on a detail pane.

## 5. Clickable regions inside a drawing (SVG or vector)

- **Unsupported on every host.** `Svg` is a leaf, drawn "as an image, or in a sandboxed frame when `isInteractive`". `isInteractive` turns on hover, CSS `:hover`, SMIL animation and `<title>` tooltips, but "never enables script or event-handler attributes … presses that other plugins should observe go on an enclosing element" (Types 12264-12299).
- **No enclosing element can make a region of the drawing pressable.** A Button may hold only strings and `Text` (Skill ref), so an `Svg` cannot sit inside one. The most you can do is put a Button beside or under the drawing, one per building for example.
- **Svg availability.** Desktop and VS Code, never the terminal (Types `Elements` 3794-3869; Ref doc, Elements; Gallery doc, "In the terminal, a pane that returns only an `Svg` opens empty").
- **The nearest supported alternative is a `Client`.** `surface.onPointer` reports `down`, `move`, `up`, `enter` and `leave` with region-relative cell coordinates, and sub-cell `fine` coordinates where the terminal reports pixels (Types 1450ff, 1590). A Client could hit-test its own cell grid. But a Client draws only with `ClientElements`, the terminal table less `Client`, `Raster` and `Image` (Types 1409), so it has **no `Svg`**. It exists on the terminal and desktop only, not VS Code (Types 3851-3857).

## 6. Text inputs and filters

- **`Input` (one-line field) and `Select` (dropdown) exist on all three hosts** (Types `Elements`; Ref doc). They are missing only on mobile.
- **A live filter is possible.** `onInput(value)` runs on every change and `onSubmit(value)` on Enter (Types 5471-5512). `Select.onSelect(value)` runs on a pick (Types 10491-10522).
- **In the band.** An Input types once the band holds focus ("an Input types, a Button arms the hotkeys", Types 10249-10251). While an Input has focus, every printable key goes to it, so hotkeys stop (Interface doc).
- **Per host.** VS Code ignores `autoFocus` on Input and Select (Ref doc, Elements).

## 7. Tooltips and hover

- **SVG tooltips.** Use `<title>` inside an `Svg` with `isInteractive`. Desktop and VS Code only (Types 12290-12298).
- **Box hover.** `hover` restyles a keyed Box, or every element sharing a `scope`, while the pointer is over it. A Box drawn `position: "absolute"` with `display: "none"` and `hover: { display: "flex" }` is a hover card painted over its surroundings without moving them (Types 862-931). No hook runs, and nothing crosses to the plugin. Text and Button take `hover` too (Types `TextHoverProps` 12539).
- **Per host.** VS Code ignores Box `position` and `hover` (Ref doc, Elements). On the terminal, hover is applied "as the pointer moves" (Types 858-861). That implies a terminal that reports the pointer, which is the fullscreen layout; this is inferred and not stated outright.

## 8. Other interactive pieces

- **`Link`** works everywhere. On desktop and VS Code it is clickable only for an `https:` URL or `http://localhost`, and otherwise draws as plain text (Interface doc, "`Link` in the Desktop app and VS Code").
- **`$.ui.toast`, `$.ui.status`, `$.ui.log`** show something without a turn. VS Code cuts a status line at 200 characters or two rows, and a toast at 500 characters (Interface doc).
- **`$.prompt.fill`** fills the prompt box. In VS Code, `$.prompt.suggest` shows nothing (Interface doc).
- **`Raster` and `Image`** are terminal only (Types `Elements`). `$.ui.blit` repaints them at up to about 60 fps without a render pass (Types 2360ff).
- **Redraws** are throttled to 10 a second, or 30 in the terminal for the shown pane and the expanded band (Ref doc, Limits).
- **Other mods.** Every press, input, select, focus and scroll is an event (`ui.press`, `ui.input`, `ui.select`, `ui.focus`, `ui.scroll`) that other mods can observe or rewrite (Ref doc, Interface events).

## How Polis uses these today

- **Band.** It is drawn from `hooks/register.tsx:1555-1566`, which yields to a survey or when hidden (`hasSurvey || isBandHidden`). `band()` in `hooks/views.tsx:422-487` draws one wrapping row of `Text` parts fitted to `bodyColumns`, then two Buttons with no hotkeys: **City** (`variant="primary"`, which opens the pane at the City view) and **Hide** (`dimColor`) (views.tsx:483-484). The band therefore has no keyboard shortcut of its own beyond Tab and Enter once it is focused.
- **Pane.** It is drawn from `register.tsx:1568-1584`. The pane opens via `openPane` with `ROOM = { rows: 46, columns: 68 }` (register.tsx:76-80, 288). `Svg` is taken from the table only when `e.surface !== 'terminal'` (register.tsx:1581), so VS Code would get the vector city too.
- **View switching** is the documented tabs pattern. One Button per view, `hotkey` `1..n`, `variant` primary for the current one, and `onPress` writes `ui.view` to state (views.tsx:1160-1170; `setView` at register.tsx:551). There is no detail view or drill-down. Every view is a flat list.
- **Overview actions.** **Orchestrate** (`o`), **Clear finished** (`c`) and, while a turn runs, **Stop turn** (`s`) (views.tsx:662-666).
- **City.** `<Svg … isInteractive />` (views.tsx:1068), whose buildings carry `<title>` tooltips (`hooks/city.ts:244`, 344, 392, 424, 457, 561, 782, 823). Very large cities drop the titles (city.ts:1153, 1169). Hover works there, but clicking a building does nothing, and per section 5 it cannot.
- **Agent portraits.** `Svg` without `isInteractive` and with no `<title>` (views.tsx:782-801; `hooks/icons.ts:323-333`), so they are static images with `alt` text and no tooltip.
- **Not used yet:** `Input`, `Select`, `Markdown`, `Link`, `Client`, `Raster`, `Image`, Box `hover` or `scope`, `autoFocus`, `action`, `$.ui.focus`, `$.ui.scroll`, a second pane, and `focus` or `closeOnEscape` on `$.ui.open`.
- **Fallback where nothing draws.** `$.ui.status` stands in for the band when it is hidden or never asked for (register.tsx:302-336). `/city` answers with text when `$.session.surfaces()` is empty (register.tsx:907, 946).

## Findings that affect Polis

1. **`docs/MANUAL.md:27` is out of date.** It says the VS Code chat panel draws "Nothing … (as of extension 2.1.295)". From extension **2.1.299**, with feature flags fetched, the panel draws **panes** (not the band) with `Svg`, Buttons, Input and Select (Ref doc). Polis's pane would show there, with view Buttons clickable but their number hotkeys inert. The status line would still stand in for the band, because `AbovePrompt` is never raised there. The fallbacks at register.tsx:907 and 946 key on `surfaces().length === 0`. Not verified: whether VS Code then lists `vscode` among the surfaces. Test this on 2.1.299+.
2. **Clicking a building to drill in is impossible** with `Svg` on any host. Options:
   - a row of Buttons beside the city, or a list under it, that selects a building and shows its detail;
   - a `Client` grid with `onPointer` hit-testing, which works on the terminal and desktop only, and draws text cells, not vectors;
   - `Markdown` link presses (fullscreen terminal).
3. **A text filter (Input with `onInput`) is supported on all three hosts** and in the band, for example to filter the Tasks or Agents views.
4. **Band button count is bounded by room, not by a number.** The binding limits are `maxRows` (at most half the terminal), `bodyColumns`, and 36 possible hotkeys.
5. **Hover cards** (absolute-positioned Box revealed on hover) would give terminal and desktop users tooltips outside the SVG. VS Code ignores them.
