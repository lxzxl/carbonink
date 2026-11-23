---
name: CarbonInk
description: The ledger for audit-grade GHG inventories — flat white pages, one quiet accent, native macOS and Windows chrome.
colors:
  accent: "#7c9476"
  accent-hover: "#748c6e"
  accent-pressed: "#71896b"
  accent-tint: "rgba(107, 130, 102, 0.18)"
  accent-mark: "#6b8266"
  accent-ink: "#475743"
  page: "#ffffff"
  surface: "#ffffff"
  inset: "#f1f1f1"
  field: "#fdfdfd"
  text: "#333333"
  muted: "#5f5f5f"
  faint: "#767676"
  border: "rgba(51, 51, 51, 0.16)"
  line: "rgba(51, 51, 51, 0.12)"
  danger: "#b4444c"
  warning: "#b45309"
  success: "#059669"
  page-dark: "#1f1f1f"
  surface-dark: "#292929"
  inset-dark: "#282828"
  field-dark: "#242424"
  text-dark: "#eaeaea"
  muted-dark: "#aaaaaa"
  faint-dark: "#878787"
  accent-dark: "#a3b8a0"
typography:
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
  section:
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
  small: "4px"
  nav: "6px"
  control: "8px"
  shell: "10px"
  card: "12px"
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
    textColor: "#15171a"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "28px"
  button-primary-hover:
    backgroundColor: "{colors.accent-hover}"
    textColor: "#15171a"
  button-secondary:
    backgroundColor: "#efefef"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "28px"
  button-secondary-hover:
    backgroundColor: "#e3e3e3"
    textColor: "{colors.text}"
  button-outline:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 12px"
    height: "28px"
  input:
    backgroundColor: "{colors.field}"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.control}"
    padding: "0 10px"
    height: "28px"
  badge-neutral:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.text}"
    rounded: "{rounded.card}"
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
    rounded: "{rounded.nav}"
    padding: "0 8px"
    height: "30px"
  nav-item-selected:
    backgroundColor: "{colors.accent-tint}"
    textColor: "{colors.text}"
    rounded: "{rounded.nav}"
  command-item:
    backgroundColor: "transparent"
    textColor: "{colors.text}"
    typography: "{typography.body}"
    rounded: "{rounded.card}"
    padding: "10px"
  command-item-selected:
    backgroundColor: "#efefef"
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
- One white surface for the page and its cards; separation is a 1 pt hairline, never a fill or shadow.
- A single moss accent, used on well under a tenth of any screen.
- System type at small sizes (11–20 pt), with weight doing the hierarchy work.
- Rounded-rectangle cards (12 pt), 16 pt internal padding, generous but regular rhythm.
- Native window chrome, native controls, native scrolling; no web-app tells.
- Both appearances are first-class: every color comes from the theme palette.

## Colors

A neutral gray ramp with one signal accent: the page and its cards stay white,
the sidebar and wells recess a step, and the accent is reserved for action,
selection, and focus.

### Primary
- **Sage** (`#7c9476`): the control accent. Filled primary buttons and the
  toggle's on-track, carrying graphite text (`#15171a`, 5.4:1). Hover `#748c6e`
  (4.9:1), pressed `#71896b` (4.7:1). The fill is 3.3:1 against the white page,
  so the control's shape stays visible without a border.
- **Mark Moss** (`#6b8266`): the X2 icon's mint-moss, the identity color. It is
  the brand's public green (logo, site, packaging) and the selected-row tint
  (18%); it never carries white text.
- **Moss Ink** (`#475743`): the accent as text — provenance links, inline
  status, and any accent-colored body copy (7.5:1 on white). Icons may use the
  sage fill, but text uses this step.

### Neutral
- **Paper White** (`#ffffff`): the page and every resting card. One white, not
  two.
- **Ledger Inset** (`#f1f1f1`): the sidebar, recessed wells, and track fills.
- **Field Well** (`#fdfdfd`): inputs, a barely-there step below the card.
- **Ink** (`#333333`): body text, figures, icons.
- **Quiet Ink** (`#5f5f5f`, 6.4:1 on white): secondary lines, subtitles,
  timestamps, helper copy.
- **Whisper** (`#767676`, 4.5:1 on white): placeholders, tertiary metadata, and
  section labels in the sidebar. The old 38% ink step measured 2.9:1 and was
  retired.
- **Hairline** (`rgba(51, 51, 51, 0.16)`): card and control borders; **Rule
  Line** (`rgba(51, 51, 51, 0.12)`): separators inside insets.

### Dark
- The same roles invert through the palette: page `#1f1f1f`, card `#292929`,
  sidebar `#282828`, field `#242424`, ink `#eaeaea`. The accent lifts to
  moss-300 (`#a3b8a0`) with graphite text, and accent-as-text lifts to
  moss-200 (`#c8d5c4`), so both stay legible on the dark page. Quiet Ink lifts
  to `#aaaaaa` (7.0:1) and Whisper to `#878787` (4.5:1).

### Semantic
- **Danger Rust** (`#b4444c`): destructive actions and failed states.
- **Warning Amber** (`#b45309`): caution and attention states.
- **Success Pine** (`#059669`): completed and positive states.

### Named Rules
**The One Accent Rule.** Only one accent exists. It marks the primary action, the
current selection, and the focused field — nothing else. A screen with three
accent things has no primary action.

**The Palette-Only Rule.** Every color is read through `ui.ColorsOf(cx)` inside
a `StyleFunc`. A literal color in a static `Style` freezes the light value and
breaks the dark appearance; the palette is the source of truth.

**The Moss Rule.** Green is the only accent. Moss-500 (`#6b8266`) is the
identity color and the selected-row tint. Filled controls use sage (`#7c9476`)
with graphite text (5.4:1), stepping to `#748c6e` and `#71896b`; accent-as-text
uses moss-700 (`#475743`, 7.5:1). Never put white text on moss-500 (4.2:1) or on
sage (3.3:1), and never introduce a second accent.

## Typography

**Display Font:** the platform system UI face (SF Pro on macOS, Segoe UI on
Windows), with the CJK fallbacks the system supplies.
**Body Font:** the same system face.
**Label/Mono Font:** the platform monospace face for codes, factor IDs, and
figures that must align.

**Character:** native, compact, and quiet. The face is the OS's own, so the app
reads as part of the desktop; hierarchy comes from weight and a deliberately
narrow scale, not from display sizes or decorative faces.

### Hierarchy
- **Heading** (600, 20 pt / 26 pt): a screen's or dialog's title. One per view.
- **Title** (600, 15 pt / 20 pt): card titles, the content header, app name.
- **Body** (400, 13 pt / 18 pt): default text, table cells, control labels.
- **Label** (500, 13 pt / 18 pt): field labels and small action labels.
- **Caption** (400, 12 pt / 16 pt): subtitles, helper text, metadata.
- **Section** (600, 11 pt / 16 pt): sidebar group labels; set in Whisper, never
  uppercase-tracked.
- **Code** (400, 12 pt / 18 pt, mono): emission-factor codes, IDs, units.

### Named Rules
**The 13-Point Default Rule.** Body and control text are 13 pt. 12 pt is for
secondary information, 11 pt only for sidebar group labels and badges, 15 pt for
titles, and 20 pt for screen headings. Nothing larger belongs in an operational
screen.

**The Tabular Figures Rule.** Figures that change — totals, amounts, CO₂e — use
tabular numerals; codes and identifiers use the mono face. Roll-up columns must
line up digit for digit.

## Layout

The app opens at **1280 × 820** and may shrink to **640 × 480**. The shell is a
sidebar beside a content card: a 5 pt window margin, a **240 pt** sidebar
(resizable from 160 pt), and the content floating as a rounded card (10 pt
radius) on the inset page. Hiding the sidebar slides the content over it; the
window controls and the sidebar toggle stay together in the top-left.

Inside the content, pages use **16 pt** padding and a measure cap: **980 pt** for
data surfaces (activities, sources, documents, disclosures, reports, audit) and
**720 pt** for settings and form flows (680 pt for a focused form). Cards use
16 pt padding and 10–12 pt gaps. The spacing rhythm is **2 / 4 / 6 / 8 / 10 / 12
/ 16 / 20 / 24 / 32** — small steps inside controls and rows, 16 pt between
blocks, 32 pt around empty states.

Row heights carry the density: **30 pt** navigation rows, **32 pt** table rows,
**36 pt** list rows, with 9–12 pt vertical padding in card lists. The content
header is a 15 pt title over a 12 pt subtitle, pinned above the scrolling body.

### Named Rules
**The Inset Shell Rule.** The window chrome and the page are one continuous
surface; the content is a card floating 5 pt above it. Do not paint a second
sidebar background, a browser-style toolbar, or a full-width band that breaks
the card's silhouette.

**The Measure Rule.** Long-form and form content stops at 680–720 pt; data
surfaces stop at 980 pt. Full-window line lengths are reserved for tables and
the command palette.

**The Header Stack Rule.** A card header with actions holds one row while the
window is at least 900 pt wide. Below that, the copy takes the card's full
width and the actions drop to their own row; actions never squeeze a heading or
body copy into broken words. Small heading-plus-ghost pairs may wrap in place
instead of stacking when both fit on one line.

**The One Header Rule.** The shell header names the screen and its purpose.
A screen does not repeat its title in the card below; the card header starts
with the count (`12 activity rows`, `3 emission sources`) and places its
actions on the same row. Singular and plural are written out, never
`1 rows`.

## Elevation & Depth

The system is **flat by default**. Resting cards have no shadow: depth is a 1 pt
hairline, a 12 pt continuous corner, and at most a 2% tonal step. Shadows belong
only to things that genuinely float above the page — menus, popovers, dialogs,
sheets, and the command palette — where they are soft and diffuse and paired
with the same hairline and a larger radius. Modals add a **40% black scrim**;
nothing else dims the page.

### Shadow Vocabulary
- **Menu / popover shadow**: soft, diffuse, low-opacity; used with a hairline and
  a 12 pt radius.
- **Dialog shadow**: deeper than a menu's, with a 16 pt radius and a solid rim.
- **No resting shadow**: cards, rows, list containers, and the sidebar have none.

### Named Rules
**The No-Fill-For-Elevation Rule.** A card is never given a gray fill to look
raised. If it needs to separate from the page, use the hairline and the corner;
if it needs to leave the page, it is a popup and gets the popup's shadow.

## Shapes

Continuous rounded rectangles, sized by role: **4 pt** for small marks inside
controls (checkboxes, chips), **6 pt** for navigation rows, **8 pt** for
buttons, inputs, and popover rows, **10 pt** for settings cards and the shell's
content card, **12 pt** for data cards, badges, and menus, **16 pt** for dialogs
and sheets, and full capsules for status pills. Borders are always **1 pt**; the
system never uses a 2–3 pt colored stripe, a left accent bar, or a heavy divider.

## Components

### Buttons
- **Shape:** 8 pt radius, 28 pt tall on desktop (24 pt small, 32 pt large), 12 pt
  horizontal padding, 13 pt regular text, 6 pt icon gap.
- **Primary:** Sage fill with graphite text. One per screen — the action the
  screen exists for (Upload, Save profile, Confirm).
- **Secondary:** a quiet 8% ink fill over the card (`#efefef`), ink text; hover
  deepens to 12%, pressed to 18%.
- **Outline:** transparent with a 1 pt hairline; used beside a primary action.
- **Ghost:** no rim or fill at rest, only a hover fill; toolbar and menu
  triggers.
- **Hover / Focus:** 120 ms transition on fill and border. Focus shifts the
  border to the accent; there is no glow, halo, or scale.
- **Disabled / Busy:** 45% opacity with a default cursor; a busy button keeps its
  size and shows a spinner over its hidden label.

### Inputs / Fields
- **Style:** 28 pt tall, 13 pt text, 8 pt radius, `#fdfdfd` well, 1 pt hairline
  border, 10 pt horizontal padding.
- **Placeholder:** Whisper.
- **Hover:** the border mixes 25% toward ink.
- **Focus:** the border becomes Sage; the selection uses the accent's
  22% tint. No shadow, no ring.
- **Multiline:** grows from a three-line floor, 6 × 10 pt padding.

### Badges
- **Style:** a capsule (12 pt radius, effectively pill-shaped at this height),
  2 × 8 pt padding, 11 pt medium text.
- **Neutral:** white surface and hairline rim — the default for scope and status.
- **Tinted variants:** 12% tint of the semantic color for the fill, 30% for the
  rim, and the label mixed 30% toward ink so it stays legible.
- **Rules:** a badge never carries meaning by color alone; the label says what
  the state is (Scope 2, Overdue, Draft).

### Cards / Containers
- **Corner Style:** 12 pt continuous.
- **Background:** Paper White in light, `#292929` in dark.
- **Border:** 1 pt Hairline.
- **Shadow:** none at rest.
- **Internal Padding:** 16 pt, 10–12 pt gaps between blocks.
- **Header:** a count at 13/600 (or a title at 15/600 when the card is not the
  screen's whole body), with actions right-aligned on the same row. Filters and
  search sit below the header, never inside it.

### Navigation
- **Shell:** a 240 pt sidebar on the inset surface, grouped by Section labels
  (11/600, Whisper): Overview, Inventory, Inputs, Disclosures, System.
- **Rows:** 30 pt tall, 6 pt radius, 8 pt horizontal padding, 16 pt muted icon
  and 13 pt label with an 8 pt gap.
- **Selected:** the accent at 12% as a tint, with the label staying ink; never a
  filled accent row, never a left stripe.
- **Command palette:** 640 × 440, opened by ⌘K / Ctrl K, 12 pt radius on items,
  10 pt padding, 16 pt icons, the first row pre-selected, and a 40% scrim behind.
- **Toggle:** lives with the window controls; the sidebar hides by sliding the
  content over it.

### Tables & Lists
- **Rows:** 32 pt for data tables, 36 pt for card lists; 9–12 pt vertical and
  12 pt horizontal padding.
- **Separation:** a 1 pt Rule Line between rows inside a card; never zebra
  stripes.
- **Selection / Hover:** a quiet ink tint, never the accent fill.
- **Pressable rows:** a row that opens a detail is a button: it gains the same
  quiet hover tint and a focus-visible ring inset by 2 pt, so pointer and
  keyboard users both see it is actionable.
- **Figures:** tabular numerals, right-aligned for magnitudes; units and factor
  codes set one step quieter or in mono.
- **Empty / no-match:** the list frame keeps its hairline and corner; the
  centered empty state names the situation, explains it in one or two lines,
  and offers the next action. A filtered-to-nothing list says so and offers
  Clear filters, not the first-run copy.

### Data Display
- **Monthly trend:** the twelve bars are the reporting period's calendar year,
  January through December. A period's chart never mixes in months from
  another year, and months with no activity read as a 2 pt baseline tick. An
  activity that spans dates is apportioned by day across those months, so a
  year-long entry reads as a flat line rather than a single spike; the card
  subtitle states the method.
- **Dashboard statistics:** tiles are fixed-basis (130–150 pt) and wrap into a
  2 × 2 grid below 900 pt; a total never shrinks into a wrapped numeral.

### Settings
- **Grouping:** General → Organization → Integrations → Data → About. Each
  group opens with an 11/600 quiet label, and cards keep their own titles
  because they no longer sit under a repeating screen heading.
- **Selection:** segmented appearance and language choices are real selected
  controls — accent tint, 0.7-alpha accent rim, accent-ink semibold label — so
  the active choice is visible without hovering.

### Dialogs & Sheets
- **Dialog:** 440 pt wide, 20 pt padding, 12 pt gaps, 16 pt radius, hairline rim,
  dialog shadow, 40% scrim. Actions sit in the footer, secondary first.
- **Long forms:** the body scrolls inside its own view while the title and
  footer stay pinned, so a 480 pt-tall window still reaches every field and
  the primary action never scrolls away.
- **Keyboard:** Return submits the dialog's primary action; each single-line
  text field opts in with `dataEnterToSubmit`. Multi-line text and focused
  buttons keep Return for themselves. Escape cancels.
- **Field pairs:** related fields share a row above 900 pt and stack below it;
  each column grows equally, so inputs and selects fill their half instead of
  sitting at intrinsic width.
- **Selection footers:** a multi-select catalog keeps its count (`0 selected`)
  at the left edge and Cancel / Add at the right, so the number and the action
  never trade places.
- **Sheet / drawer:** 320 pt wide, 16 pt radius on the side that meets the app,
  16 pt padding; used for rebinding and detail work that should not lose the
  list behind it.

### Onboarding & Wizards
- **Sections:** multi-part forms number their sections (`01`, `02`, `03`) in
  mono at 10 pt, with a 13/600 title and one line of purpose; a hairline rule
  separates sections.
- **Required fields:** mark them with `*` and state the rule once near the top
  (`* Required`). The primary action stays disabled and a one-line hint names
  what is still missing; do not fail silently after a press.
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
- **Do** keep the page and its cards on the same white; separate them with the
  1 pt hairline and the 12 pt corner.
- **Do** use 13 pt for body and control text, 15 pt for titles, 20 pt for the
  screen heading, and 11 pt only for sidebar sections and badges.
- **Do** keep 16 pt card padding and the 2/4/6/8/10/12/16 spacing rhythm; use
  12 pt gaps inside cards and 16 pt between them.
- **Do** reserve the filled accent button for the one action the screen exists
  for; pair it with outline or secondary actions.
- **Do** use tabular numerals for quantities and mono for factor codes and IDs.
- **Do** show filesystem paths in a boxed mono block with a quiet caption, not
  inline in a sentence, so long paths are readable and distinguishable.
- **Do** wrap long explanatory copy inside its card; a one-line helper that
  runs past the card edge is clipped and unreadable.
- **Do** check both zh-CN and en at 640 pt, 1280 pt, and a wide window: CJK
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
- **Don't** put white text on moss-500 `#6b8266` (4.2:1) or add a second accent;
  filled controls use sage `#7c9476` with graphite text, and accent-as-text uses
  moss-700 `#475743`.
- **Don't** use a gradient, glassmorphism, decorative blur, or a hero-metric
  block anywhere in the app shell.
