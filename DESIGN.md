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

# Design System: CarbonInk (2.0 / NSGo)

> Applies to the CarbonInk desktop product in `app/` (kept in sync with [app/DESIGN.md](app/DESIGN.md); see [cloud/AGENTS.md](cloud/AGENTS.md) for the `carbonink.xyz` marketing palette).

## Overview — "The Ledger"

CarbonInk 2.0 is a native macOS/Windows accountant's ledger built on NSGo: pure-white resting cards, ink-dark figures, 1 pt hairlines, and a single emerald accent spent only on primary action, selection, and focus. Hierarchy comes from type weight, a strict 6-step scale (`24 / 20 / 15 / 13 / 12 / 11 pt`), and whitespace rhythm — never color floods, gradients, glassmorphism, hero-metric blocks, or resting card shadows. Every color reads through `ui.ColorsOf(cx)` inside `StyleFunc` so light and dark themes stay paired live.

## Colors & Named Rules

- **Primary Emerald (`#008c4f` light / `#00af67` dark):** Filled primary buttons (warm white `#fdfcf8` text; hover `#1a9861`, pressed `#0d9258`, dark hover `#0bad6a`, dark pressed `#089659`, tint `#e5eee8` / `#26312b`), toggle on-track, and focus ring (`"info"` maps to emerald — zero sky-blue). Use **Accent Ink** (`#007a45`, `5.4:1` AA on white) for provenance links and accent text.
- **Neutrals:** **Paper White** (`#ffffff`) for page and resting cards; **Ledger Inset / Sidebar** (`#fafafa`); **Field Well** (`#ffffff`, `1 pt` `FieldBorder` `#dfded8`); **Ink** (`#13120c`); **Quiet Ink** (`#65635c`, `5.9:1` AA) for all readable subtitles, timestamps, and metadata; **Whisper** (`#a8a6a0`, `2.4:1`) strictly for decorative icons, empty-state glyphs, and chevrons.
- **Hairlines:** `Border()` (`#e7e7e7`) frames outer cards/wells; `Line()` (`rgba(19, 18, 12, 0.07)`) draws internal dividers and list-row separators (omit bottom border on the last row).
- **Dark Ramp:** Page `#13120c`, sidebar `#171610`, surface `#1c1b14`, raised `#25241c`, border `#2b2922`, field border `#35332a`, line `rgba(240, 238, 233, 0.10)`, ink `#f0eee9`, quiet ink `#918f87`, danger `#f94144`.
- **Semantic:** **Danger** (`#cc272e` / `#f94144`) for destructive confirmations; **Warning Amber** (`#b45309`) for caution/received states (prefer neutral/amber badges over `BadgeInfo`); **Success Pine** (`#059669`) for completed states.
- **Rules:**
  - **One Accent Rule:** One primary emerald button per screen/region; selected rows and nav items stay neutral (`selectionTint(cx)`).
  - **Palette-Only Rule:** Never hardcode hex colors in static `Style` or evaluate `ui.ColorsOf(cx)` eagerly outside `StyleFunc`.
  - **Emerald Rule:** Never replace emerald with sage, moss, or sky-blue.

## Typography

Use the OS system UI face (`SF Pro` / `Segoe UI` with system CJK fallbacks) and `core.FontMonospace` for EF codes, question positions, paths, and masked credentials.

- **6-Step Scale (`type*` constants):** KPI `24 pt` (600, `FontTabularNums`), Page Title `20 pt` (600), Section Title `15 pt` (600), Body / Label `13 pt` (400/500), Caption `12 pt` (400), Micro `11 pt` (500/600, sentence-case — never uppercase-transformed).
- **Tabular Figures Rule:** Set `FontVariant: core.FontTabularNums` on KPIs, quantities, CO₂e roll-ups, dates, counts, version strings, and shortcuts.

## Layout, Measure & Elevation

- **Window & Shell:** Opens at `1400 × 900` (min `960 × 600`; tests at `1280 × 820`, narrow checks `640 × 820` / `960 × 600`). Uses `ui.SidebarShellPlain` with a `256 pt` fixed sidebar (`Fixed: true`, pinned header, scrolling nav, top-hairline footer), `1 pt` topbar bottom rule, unified `28 pt` Ghost controls (`Side: 28, IconSize: 15`), and right-aligned `⌘K`/`Ctrl+K` command trigger.
- **Measures:** Content pages use `24 pt` padding (`16 pt` inside cards, `12–16 pt` gaps). Measure caps: Settings `672 pt` (beside `200 pt` rail), onboarding/wizards `560 pt`, `detailPaneShell` body `880 pt`, data pages `1280 pt`. Multi-column grids stack via `settingsColumns` (`< 1120 pt`) and `dataColumns` (`< 900 pt`).
- **Headers:** `dataHeaderRow` drops trailing actions cleanly onto their own row when narrow; never duplicate titles in both a card header and its first inner child (**One Header Rule**).
- **Flat by Default:** Resting cards have no shadow. Shadows (`ui.FinOf(cx).Menu().Shadows`) belong only to menus, popovers, command palette, dialogs, and right-aligned drawers (`480 pt` standard, `680 pt` dense, `92%` max width, `ui.Black(0.28)` scrim).

## Shapes & Components

- **Radius Scale:** `4 pt` (`radiusMark`, marks/badges/keycaps), `6 pt` (`radiusItem`, nav rows/chips/segmented frame/`wideSelect`/`ui.DatePicker`), `8 pt` (`radiusCard`, cards), `12 pt` (`radiusMenu`, dropdowns/popovers), `16 pt` (`radiusDialog`, dialogs), `9999 pt` (pill badges).
- **Controls:** `28 pt` desktop height (`ui.ButtonHeight`), `12 pt` horizontal padding, `13 pt` text; `wideSelect` and `appDatePicker` fill container width (`Width: core.Pct(100)`). Focus shifts border to accent — no outer 2–3 pt halo.
- **Settings:** `200 pt` left rail + `672 pt` scroll pane across 10 sections (`settingsCard` / `settingsDangerCard` separated by `16 pt`, internal dividers via `hairline(cx)`).
- **Empty States & Onboarding:** Two-pane empty states center a `44 pt` `Faint()` icon above `13 pt` `Muted()` copy. Multi-part wizards number sections (`01`, `02`, `03` mono `10 pt`), mark required fields with `*` (`* Required` once at top), and explain bilingual alternative-name pairs clearly.
- **Command Palette:** Bare `640 pt` dialog with `↑↓ Navigate · ↵ Select · Esc Close` footer; navigation first, then Actions, then Files.
- **Bilingual Parity:** Check both `zh-CN` and `en` across narrow and wide windows; wrap long helper copy inside cards and render filesystem paths in boxed mono wells.
