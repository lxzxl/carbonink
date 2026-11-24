---
name: CarbonInk
description: The ledger for audit-grade GHG inventories — flat white pages, one quiet accent, native macOS and Windows chrome.
colors:
  accent: "#008c4f"
  accent-hover: "#1a9861"
  accent-pressed: "#0d9258"
  accent-tint: "#e5eee8"
  accent-mark: "#008c4f"
  accent-ink: "#007a45"
  info: "#008c4f"
  page: "#ffffff"
  surface: "#ffffff"
  inset: "#fafafa"
  sidebar: "#fafafa"
  field: "#ffffff"
  secondary: "#f3f2ec"
  muted-surface: "#f0eee9"
  text: "#13120c"
  muted: "#65635c"
  faint: "#a8a6a0"
  border: "#e7e7e7"
  field-border: "#dfded8"
  line: "rgba(19, 18, 12, 0.07)"
  danger: "#cc272e"
  warning: "#b45309"
  success: "#059669"
  page-dark: "#13120c"
  sidebar-dark: "#171610"
  surface-dark: "#1c1b14"
  raised-dark: "#25241c"
  inset-dark: "#13120c"
  field-dark: "#1c1b14"
  border-dark: "#2b2922"
  field-border-dark: "#35332a"
  line-dark: "rgba(240, 238, 233, 0.10)"
  text-dark: "#f0eee9"
  muted-dark: "#918f87"
  faint-dark: "#918f87"
  danger-dark: "#f94144"
  accent-dark: "#00af67"
  info-dark: "#00af67"
typography:
  kpi:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.2
  heading:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "20px"
    fontWeight: 600
    lineHeight: 1.3
  title:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.33
  body:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 400
    lineHeight: 1.38
  label:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "13px"
    fontWeight: 500
    lineHeight: 1.38
  caption:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.33
  micro:
    fontFamily: "system-ui, -apple-system, 'Segoe UI', sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.45
  code:
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace"
    fontSize: "12px"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  mark: "4px"
  item: "6px"
  card: "8px"
  menu: "12px"
  dialog: "16px"
  capsule: "9999px"
spacing:
  xxs: "2px"
  xs: "4px"
  sm: "8px"
  md: "12px"
  lg: "16px"
  xl: "20px"
  xxl: "24px"
  page: "16px"
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "#fdfcf8"
    typography: "{typography.body}"
    rounded: "{rounded.item}"
    padding: "0 12px"
    height: "28px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "#fdfcf8"
  button-secondary:
    backgroundColor: "#f3f2ec"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.item}"
    padding: "0 12px"
    height: "28px"
  button-secondary-hover:
    backgroundColor: "#e9e7df"
    textColor: "{colors.text}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.item}"
    padding: "0 12px"
    height: "28px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.item}"
    padding: "0 10px"
    height: "28px"
  badge-neutral:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.menu}"
    padding: "2px 8px"
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
    padding: "16px"
  nav-item:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.item}"
    padding: "0 8px"
    height: "30px"
  nav-item-selected:
    backgroundColor: "rgba(19, 18, 12, 0.08)"
    textColor: "{colors.text}"
    rounded: "{rounded.item}"
  command-item:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "10px"
  command-item-selected:
    backgroundColor: "rgba(19, 18, 12, 0.08)"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
---

# Design System: CarbonInk

## Overview

**Creative North Star: "The Ledger"**

CarbonInk 2.0 is an accountant's ledger made digital: a quiet white page, ink-dark
figures, hairline rules, and a single accent used only where attention is
required. The shell is native — a macOS or Windows window with real traffic
lights and native controls — and the interface inside it behaves like a
first-class desktop app, not a website in a frame. A consultant scanning a dense
screen of activities, factors, and disclosures should feel one thing: everything
is in its column, every figure lines up, and nothing is shouting.

Density is a feature here, not a liability: the audience runs many clients
against deadlines. The system earns that density by staying quiet — hierarchy
comes from type weight, a tight 11–20 pt scale, whitespace rhythm, and 1 pt
hairlines rather than color floods, gradients, or chrome. Color appears only as
meaning: the accent for the one primary action and the current selection, danger
for destructive intent, and the neutral ramp for everything else.

The visual world is built from the platform's own theme: NSGo's neutral palette
and system type, with the app contributing its layout grammar, card rhythm, and
navigation structure. That keeps light and dark paired by construction — as long
as every surface reads its color from the palette instead of freezing a literal.

**Key Characteristics:**
- One white surface for the page and its cards; separation is a 1 pt border or hairline (`Border()` for containers, `Line()` for internal rules), never a fill or resting shadow.
- A single emerald accent, used on well under a tenth of any screen; `"info"` maps to emerald so focus rings never flash sky-blue.
- System type on a 6-step scale (`24 / 20 / 15 / 13 / 12 / 11 pt`), with weight, tabular numerals, and `core.FontMonospace` doing the hierarchy work.
- 5-step continuous corners (`4 / 6 / 8 / 12 / 16 pt` plus capsules), `8 pt` cards with `16 pt` internal padding, and regular vertical rhythm.
- Native `ui.SidebarShellPlain` shell (`256 pt` sidebar, pinned brand header above scrolling nav, `1 pt` topbar bottom hairline, unified `28 pt` Ghost controls, visible `⌘K`/`Ctrl+K` trigger); no web-app tells.
- Both appearances are first-class: every color comes from the theme palette inside `StyleFunc`.

## Colors

A neutral warm-paper gray ramp with one signal accent: the page and its cards stay white,
the sidebar and inset wells recess a step, and the accent is reserved for action,
selection, and focus.

### Primary
- **Emerald** (`#008c4f`): the control accent 1.x shipped. Filled primary
  buttons and the toggle's on-track carry warm white text (`#fdfcf8`). Hover
  `#1a9861`, pressed `#0d9258`. Selection never uses saturated emerald: rows and
  navigation items use neutral `selectionTint(cx)` so a primary green button stays
  the only saturated control.
- **Brand Emerald** (`#008c4f`): the leaf mark, the site and packaging green,
  and focus ring (`"info"` maps to emerald in both light `#008c4f` and dark
  `#00af67`, keeping zero sky-blue chrome).
- **Accent Ink** (`#007a45`): darker emerald for text and links — provenance
  links, inline status, and accent-coloured copy (`5.4:1` WCAG AA contrast on white).

### Neutral
- **Paper White** (`#ffffff`): the page and every resting card.
- **Ledger Inset / Sidebar** (`#fafafa`): the flat sidebar, recessed wells, and track
  fills.
- **Field Well** (`#ffffff`): inputs sit on the card with a `1 pt` `FieldBorder` (`#dfded8`).
- **Ink** (`#13120c`): body text, figures, icons.
- **Quiet Ink** (`#65635c`, `5.9:1` on white): all readable secondary metadata,
  subtitles, timestamps, helper copy, and labels.
- **Whisper** (`#a8a6a0`, `2.4:1` on white): strictly reserved for decorative ornaments,
  empty-state glyphs, and trailing disclosure chevrons — never use `Faint()` for
  readable text or metadata.
- **Two-tier Hairlines**: `Border()` (`#e7e7e7`) frames outer card and well containers;
  `Line()` (`rgba(19, 18, 12, 0.07)`) draws internal dividers (`hairline`) and list
  row separators (omitting the trailing bottom border on the last row).

### Dark
- The same warm stone ramp inverts through the palette: page `#13120c`, sidebar
  `#171610`, card/surface `#1c1b14`, raised `#25241c`, border `#2b2922`, field border
  `#35332a`, line `rgba(240, 238, 233, 0.10)`, ink `#f0eee9`. Emerald lifts to
  `#00af67` (`#0bad6a` hover, `#089659` pressed, `#26312b` tint) with `#13120c`
  contrast ink. Quiet Ink lifts to `#918f87`, and Danger lifts to `#f94144`.

### Semantic
- **Danger** (`#cc272e` light / `#f94144` dark): destructive confirmation buttons (`Color: ui.ColorsOf(cx).Danger`), overdue states, and failed status.
- **Warning Amber** (`#b45309`): caution, received disclosures, and attention states (prefer neutral/amber badges over `BadgeInfo`).
- **Success Pine** (`#059669`): completed and positive states.

### Named Rules
**The One Accent Rule.** Only one accent exists. It marks the one primary action
per screen/region, focus rings, and text links — nothing else. A screen with
three emerald buttons has no primary action.

**The Palette-Only Rule.** Every color is read through `ui.ColorsOf(cx)` inside
a `StyleFunc` (or callback). Evaluating `ui.ColorsOf(cx).*()` eagerly during node
construction freezes the light palette value and breaks live dark-mode switching.

**The Emerald Rule.** Green is the only accent (`#008c4f` light / `#00af67` dark),
never sage or sky-blue (`"info"` is mapped to emerald). Filled controls use emerald
with warm white text (`#fdfcf8`); accent-as-text uses `#007a45` on white (`5.4:1` AA).
Selected rows stay neutral (`selectionTint`).

## Typography

**Display Font:** the platform system UI face (SF Pro on macOS, Segoe UI on
Windows), with the CJK fallbacks the system supplies.
**Body Font:** the same system face.
**Label/Mono Font:** `core.FontMonospace` (never hardcoded `"monospace"` strings)
for emission-factor codes, question positions, paths, and masked credentials.

**Character:** native, compact, and quiet. The face is the OS's own, so the app
reads as part of the desktop; hierarchy comes from weight and a strict 6-step scale.

### 6-Step Hierarchy
- **KPI** (`typeKPI = 24 pt`, `600`, `FontTabularNums`): top-level summary figures on Dashboard and report preview cards.
- **Page Title** (`typePageTitle = 20 pt`, `600`): screen and onboarding step headings.
- **Section Title** (`typeSectionTitle = 15 pt`, `600`): `settingsCard` headers, card titles, list pane headers, and `detailPaneShell` titles.
- **Body / Label** (`typeBody = 13 pt`, `400`/`500`): body copy, field labels, control labels, list item titles, dialog descriptions.
- **Caption** (`typeCaption = 12 pt`, `400`): subtitles, helper copy, validation/status feedback, inline badges/chips, `Muted()` metadata.
- **Micro** (`typeMicro = 11 pt`, `500`/`600`): sidebar group headers (sentence-case, never uppercase-transformed), count badges, dense filter chips, chart month ticks, dates/timestamps.

### Named Rules
**The 6-Step Type Scale Rule.** All typography across `internal/app` uses the six
shared `type*` constants (`24 / 20 / 15 / 13 / 12 / 11 pt`). Avoid arbitrary ad-hoc
font sizes (`10`, `14`, `16`, `18`, `22`) so adjacent screens align at the same baseline.

**The Tabular Figures Rule.** Figures that align vertically or change — KPI totals,
activity quantities, CO₂e roll-ups, dates, counts, version strings, and keyboard
shortcuts — set `FontVariant: core.FontTabularNums`. Codes, paths, and question
positions set `FontFamily: core.FontMonospace`.

## Layout

The app opens at **1400 × 900** (tests run at **1280 × 820** and narrow edge checks
at **640 × 820** / **960 × 600**). The shell is `ui.SidebarShellPlain`: a **256 pt**
fixed sidebar (`Fixed: true`) with a pinned brand header above a scrollable nav
list, a top-bordered `SidebarFooter` for Settings & MCP status, and a `1 pt`
topbar bottom hairline (`Line()`). The topbar houses unified **28 pt** Ghost
controls (`Side: 28, IconSize: 15`) separated by a vertical `Line()` divider and
a right-aligned bordered command trigger (`topbar-command`, showing `⌘K` / `Ctrl+K`).

Inside the content, pages use **24 pt** padding and a **1280 pt** measure cap
(`pageMaxWidth`, `appPage` / `appFixedPage`) for data surfaces. Split-screen detail
panes use `detailPaneShell` (`MaxWidth: 880 pt` scrollable body between pinned
header and footer). Settings uses a **200 pt** rail + centered **672 pt** scrolling
pane (`16 pt` vertical rhythm). Cards use `16 pt` internal padding and `12–14 pt`
gaps. Multi-column fields use `settingsColumns` inside Settings (stacking `< 1120 pt`)
and `dataColumns` elsewhere (`< 900 pt`).

### Named Rules
**The Plain Sidebar Shell Rule.** `ui.SidebarShellPlain` keeps the window unified
under native chrome: pinned brand header, scrollable middle nav, top-hairline footer,
and a `1 pt` topbar bottom rule rather than nested floating cards or thick bands.

**The Measure Rule.** Settings panes stop at `672 pt`, onboarding/form wizards at
`560 pt`, detail bodies (`detailPaneShell`) at `880 pt`, and operational data pages
at `1280 pt`.

**The Header Stack Rule.** A card header with trailing actions (`dataHeaderRow`) holds
one row on wide windows and drops actions cleanly onto their own row when narrow,
never truncating words.

**The One Header Rule.** The screen heading or `settingsCard` header names the block
once. Never duplicate titles inside both a card header and its first inner child.

## Elevation & Depth

The system is **flat by default**. Resting cards have no shadow: separation comes
from the `1 pt` `Border()` hairline and `8 pt` corner. Shadows belong only to menus,
popovers, command palette, dialogs, and right-aligned drawers (`ui.FinOf(cx).Menu().Shadows`),
paired with a `Border()` rim. Modals and drawers dim the background with a quiet scrim
(`ui.Black(0.28)` for drawers).

## Shapes

5-step continuous radius scale plus capsules:
- **4 pt (`radiusMark`)**: marks, count badges, segmented item highlight, keycaps.
- **6 pt (`radiusItem`)**: nav rows, filter chips, segmented control frame, inset code/status wells, `wideSelect` triggers, list containers nested inside cards.
- **8 pt (`radiusCard`)**: `cardSurface`, `settingsCard`, `settingsDangerCard`, theme default `t.Radius`.
- **12 pt (`radiusMenu`)**: dropdown menus and popovers.
- **16 pt (`radiusDialog`)**: dialogs and modal overlays.
- **Capsule (`9999 pt`)**: pill badges and onboarding progress pills.

## Components

### Buttons & Inputs
- **Shape:** `28 pt` desktop height (`ui.ButtonHeight`), `12 pt` horizontal padding,
  `13 pt` text. Primary emerald fill is reserved for the single primary action per
  region; secondary (`ButtonSecondary`) and outline (`ButtonOutline`) pair alongside
  it. Destructive confirmation buttons set `Color: ui.ColorsOf(cx).Danger`.
- **Selects:** `wideSelect` defaults to `ui.ButtonHeight` (`28 pt`), fills its
  parent container (`Width: core.Pct(100)`) unless given an explicit width, and opens
  with a `radiusMenu` (`12 pt`) popup.

### Settings
- **Structure:** `200 pt` left rail (using `selectionTint(cx)`, `Hover`, and
  `FocusVisible`) beside a centered `672 pt` scroll pane. All 10 sections present
  content inside unified `settingsCard` (or `settingsDangerCard`) containers with an
  icon, `15 pt` title, optional caption, and `16 pt` gap between cards. Internal
  blocks inside multi-group cards divide with `hairline(cx)` (`Line()`).
- **Segmented Controls:** `settingsSegmented` matches `28 pt` desktop control height
  with `radiusItem` outer frame and `radiusMark` inner buttons + `FocusVisible`.

### Drawers & Dialogs
- **Drawers (`drawer.go`):** right-aligned slide-overs capped at `92%` viewport width,
  over a `28%` black scrim, with `Border()` and menu shadows. Standard edit/detail/lineage
  drawers use `480 pt`; dense batch-import and source-catalog drawers use `680 pt`.
- **Dialogs:** `16 pt` radius, `Border()` rim, primary/danger action rightmost in footer.

### Lists & Empty States
- **Separators:** Internal row dividers use `Line()` (`1 pt`) and omit the trailing
  bottom border on the last row (`i < len-1`).
- **Two-Pane Empty States:** Centered `44 pt` `Faint()` icon above `13 pt` `Muted()`
  contextual hint (distinguishing an empty list from an unselected detail pane).

### Onboarding & Wizards
- **Sections:** multi-part forms number their sections (`01`, `02`, `03`) in
  mono at 10 pt, with a 13/600 title and one line of purpose; a hairline rule
  separates sections.
- **Required fields:** mark them with `*` and state the rule once near the top
  (`* Required`). The primary action stays disabled and a one-line hint names
  what is still missing; do not fail silently after a press.
- **Alternative names:** when either language satisfies a field, mark the
  primary language and add “At least one language is required” under the pair;
  never put `*` on both fields and accept only one.
- **Review rows:** a generated question or summary may wrap to two lines; never
  truncate it with runes or an ellipsis that hides the ask.

### Command Palette
- **Frame:** a bare 640 pt dialog holding the command list and a hint footer
  (`↑↓ Navigate · ↵ Select · Esc Close`); the list takes the remaining height
  and scrolls.
- **Content:** navigation commands first, then a separate Actions group (new
  activity, import, export CSV, add source), then Files. Each item carries an
  icon and a group label.

## Do's and Don'ts

### Do:
- **Do** read every surface color inside a `StyleFunc` through `ui.ColorsOf(cx)`
  so light and dark stay paired.
- **Do** keep the page and its cards on the same white in light (`#13120c` / `#1c1b14` in dark); separate containers with a 1 pt `Border()` and `8 pt` (`radiusCard`) corners, and internal rows with `Line()`.
- **Do** follow the 6-step type scale (`24 / 20 / 15 / 13 / 12 / 11 pt`) with `Muted()` for readable copy and `Faint()` strictly for ornaments.
- **Do** keep 16 pt card padding and regular `12–16 pt` vertical rhythm.
- **Do** reserve the filled accent button for the single primary action per region, and apply `Color: ui.ColorsOf(cx).Danger` on destructive confirms.
- **Do** set `FontVariant: core.FontTabularNums` for numbers, dates, and version strings, and `FontFamily: core.FontMonospace` for codes and paths.
- **Do** show filesystem paths in a boxed mono block with a quiet caption, not
  inline in a sentence, so long paths are readable and distinguishable.
- **Do** wrap long explanatory copy inside its card; a one-line helper that
  runs past the card edge is clipped and unreadable.
- **Do** check both zh-CN and en at 960 pt, 1400 pt, and a wide window: CJK
  labels, unit strings, and factor codes are the overflow cases.

### Don't:
- **Don't** hardcode `#fff`, `#333`, or any literal surface color in a static
  `Style`; a themed switch will leave the old value behind. Card chrome comes
  from `cardSurface(cx)` and only layout stays in the static `Style`.
- **Don't** add a shadow to a resting card, row, or sidebar to make it "pop".
- **Don't** give a card a gray fill to fake elevation.
- **Don't** use a filled accent row for navigation selection or a colored left
  stripe as an accent.
- **Don't** add a focus halo, glow, or 2–3 pt ring; shift the border to the
  accent instead.
- **Don't** uppercase or letter-space section labels; sentence case at 11/600.
- **Don't** replace emerald with sage, moss, or sky-blue; filled controls
  use `#008c4f` (`#00af67` dark) with warm white text, `"info"` maps to emerald,
  and accent-as-text uses `#007a45` on white (`5.4:1` WCAG AA).
- **Don't** use a gradient, glassmorphism, decorative blur, or a hero-metric
  block anywhere in the app shell.
