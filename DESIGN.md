---
name: CarbonInk
description: The desktop ledger for audit-grade greenhouse-gas inventories — calm density, native chrome, one green mark of verification.
colors:
  primary: "oklch(0.55 0.16 160)"
  primary-foreground: "oklch(0.99 0.005 95)"
  background: "oklch(1 0 0)"
  foreground: "oklch(0.18 0.012 95)"
  card: "oklch(1 0 0)"
  sidebar: "oklch(0.985 0 0)"
  secondary: "oklch(0.96 0.008 95)"
  muted: "oklch(0.95 0.008 95)"
  muted-foreground: "oklch(0.5 0.012 95)"
  accent: "oklch(0.94 0.012 160)"
  destructive: "oklch(0.55 0.2 25)"
  border: "oklch(0.929 0 0)"
  input: "oklch(0.9 0.008 95)"
  ring: "oklch(0.55 0.16 160 / 0.5)"
typography:
  headline:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', sans-serif"
    fontSize: "1.125rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "-0.01em"
  title:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', sans-serif"
    fontSize: "0.9375rem"
    fontWeight: 600
    lineHeight: 1.4
    letterSpacing: "normal"
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
    letterSpacing: "normal"
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
    letterSpacing: "normal"
rounded:
  sm: "0.25rem"
  md: "0.5rem"
spacing:
  row-y: "0.75rem"
  row-x: "1rem"
  page: "1.5rem"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    height: "2.5rem"
    padding: "0 1rem"
  button-primary-hover:
    backgroundColor: "oklch(0.55 0.16 160 / 0.9)"
    textColor: "{colors.primary-foreground}"
  button-outline:
    backgroundColor: "oklch(1 0 0 / 0.4)"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "2.5rem"
    padding: "0 1rem"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "2.5rem"
    padding: "0 1rem"
  button-destructive:
    backgroundColor: "oklch(0.55 0.2 25 / 0.1)"
    textColor: "{colors.destructive}"
    rounded: "{rounded.md}"
    height: "2.5rem"
    padding: "0 1rem"
  input:
    backgroundColor: "{colors.background}"
    textColor: "{colors.foreground}"
    rounded: "{rounded.md}"
    height: "2.5rem"
    padding: "0.5rem 0.75rem"
  badge-default:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-foreground}"
    rounded: "{rounded.md}"
    padding: "0.125rem 0.5rem"
  list-row:
    backgroundColor: "{colors.card}"
    textColor: "{colors.foreground}"
    padding: "0.75rem 1rem"
---

# Design System: CarbonInk

## 1. Overview

**Creative North Star: "The Ledger"**

CarbonInk is an accountant's ledger made digital. Pure-white pages, ink-dark
figures, and a single green mark of verification. The interface never competes
with the data on it; it is the calm, ruled surface the numbers sit on. A
consultant should be able to scan a dense screen of emission sources, activity
rows, and questionnaire answers and feel the same thing they feel reading a
well-kept ledger: everything is in its column, every figure traces back to its
entry, nothing is shouting.

Density here is a feature, not a liability. The audience runs many clients
against deadlines, so the system shows a lot at once. It earns the right to do
that by being relentlessly quiet: hierarchy comes from type scale, weight, and
whitespace rhythm, never from color floods or chrome. Borders and
near-imperceptible tonal steps separate surfaces; the forest-green brand is the
one accent, spent sparingly so its appearance always *means* something
(verified, primary action, active state). The craft bar is a first-class native
macOS/Windows app — cursors, fonts, materials, and motion that read as the OS,
not as a website in a window — measured against the calm, legible data display
of the Stripe Dashboard.

This system explicitly rejects the flashy SaaS marketing-dashboard (no
hero-metric template, no decorative gradients, no glassmorphism), consumer-app
cuteness (no mascots, bouncy motion, or emoji-as-UI), web-app tells
(`cursor: pointer` on chrome, painted CSS window corners, fonts that fight the
OS), and the undifferentiated enterprise spreadsheet (dense is fine; illegible
walls of cells are not). Marketing energy lives in `cloud/web`, never in the app
shell.

**Key Characteristics:**
- Pure-white surfaces, separated by 1px borders and ≤2% tonal steps, not shadow.
- One brand color (carbonink green), spent on ≤10% of any screen.
- Type-and-space hierarchy; the screen is calm even when it is full.
- Native chrome down to cursors, font stacks, and window-drag regions.
- Bilingual zh-CN / en parity is structural — layouts hold in both, always.
- Numbers are `tabular-nums`; codes and identifiers are monospace.

## 2. Colors

A near-monochrome neutral system on pure white, with one forest-green accent and
a single reserved red for destruction. The palette is canonical in **OKLCH**
(the repo doctrine; the hex equivalents are approximations and are not the source
of truth).

### Primary
- **Carbonink Green** (`oklch(0.55 0.16 160)`): The one brand color and the one
  accent. It marks the single most important action on a page (filled button),
  the verified/active state, focus rings, and the brand wordmark. In dark mode it
  lifts to `oklch(0.65 0.18 160)` to stay vivid on the dark ground. Its rarity is
  the entire point — see the One Mark Rule.

### Neutral
- **Page White** (`oklch(1 0 0)`): The body, cards, and popovers all paint pure
  white. Cards do not get a different fill; they read as elevation-by-border.
- **Sidebar White** (`oklch(0.985 0 0)`): A 1.5% step down from page white — just
  enough to feel where the sidebar ends, while the OS title-bar zone still reads
  as one unbroken white surface across the boundary.
- **Ledger Ink** (`oklch(0.18 0.012 95)`): The foreground. Near-black with a
  whisper of warm hue (95) so it never reads as cold pure black. Body text and
  headings.
- **Muted Ink** (`oklch(0.5 0.012 95)`): Secondary metadata, captions, dimmed
  labels. Held at L 0.5 so it still clears WCAG AA body contrast on white — never
  let "elegant light gray" drop below this against a white-to-near-white ground.
- **Rule Line** (`oklch(0.929 0 0)`): The border / divider. Pure neutral (chroma
  0), a 7.1% step from white — present enough to rule a table, quiet enough not to
  draw the eye. Every divider, card edge, and the sidebar `::after` line derive
  from it.
- **Surface Tints** (`secondary oklch(0.96 0.008 95)`, `muted oklch(0.95 0.008 95)`):
  The faintest warm-neutral fills for chips, hovers, and inset regions. Also a
  perceptual **foreground-opacity ladder** (`--foreground-3` … `--foreground-95`)
  for tints derived from ink rather than ad-hoc grays.

### Tertiary (reserved)
- **Alarm Red** (`oklch(0.55 0.2 25)`): Destruction and hard errors only. It
  appears as a 10% tint behind text (`destructive/10`) far more often than as a
  fill, so it warns without screaming. Never used for emphasis or decoration.

### Named Rules
**The One Mark Rule.** Carbonink green covers ≤10% of any screen and never two
co-equal greens at once. Reserve the filled-green button for the single most
important action per page; everything else is outline or ghost. When green
appears, it means *verified*, *primary*, or *active* — never decoration.

**The No-Fill-For-Cards Rule.** Cards and the page share one white. Separation is
a 1px Rule Line plus, at most, a ≤2% tonal step. If you reach for a gray card fill
to create depth, you have broken the ledger.

## 3. Typography

**Body & Display Font:** the native system stack — `-apple-system` /
`BlinkMacSystemFont` on macOS, `Segoe UI Variable Text` / `Segoe UI` on Windows,
with `PingFang SC` / `Microsoft YaHei UI` / `Hiragino Sans GB` for CJK listed
*after* the Latin families so each script renders in its OS-tuned face.
**Mono Font:** `ui-monospace, SFMono-Regular, Menlo, Consolas` for codes and IDs.

**Character:** There is no display typeface and no font pairing — one native sans
carries the whole system, with weight and scale doing the hierarchy work. This is
deliberate: the OS font is the single strongest native-feel signal, and a ledger
wants legibility over personality.

### Hierarchy
- **Headline** (600, 1.125rem / 18px, line-height 1.4, tracking -0.01em): Page and
  route titles. The largest text in the app — there are no heroes here.
- **Title** (600, 0.9375rem / 15px, line-height 1.4): Section headers, card
  titles, drawer headings, the primary identifier in a list row.
- **Body** (400, 0.875rem / 14px, line-height 1.5): The workhorse size — form
  fields, descriptions, table cells, most prose. Cap reading-prose measure at
  65–75ch.
- **Label** (500, 0.75rem / 12px, line-height 1.4): Field labels, chip text,
  secondary metadata, status text. Sentence case, not all-caps.
- **Mono** (400, 0.8125rem / 13px): Emission-factor codes, IDs, scope tags, any
  fixed-width identifier. Numbers everywhere use `tabular-nums` so columns align.

### Named Rules
**The Sentence-Case Rule.** Labels and section eyebrows are sentence case. No
all-caps tracked eyebrows above sections — uppercase is reserved for short scope
tags (`SCOPE 1`) and nowhere else. `whitespace-nowrap` on every button label so
2-character CJK labels (保存) never wrap to a vertical stack.

## 4. Elevation

Flat by border. Surfaces are flat at rest and depth is conveyed by 1px Rule Lines
and ≤2% tonal steps, not by shadow. This is the ledger discipline: a page of
cards is a page of ruled regions, not a pile of floating panels. Shadow is spent
*only* on genuinely floating layers — popovers, dropdown menus, dialogs, sheets,
the command palette — where the OS itself would cast one. A resting card, list
row, or section never has a shadow.

### Shadow Vocabulary
- **Float** (system/library default for Radix popovers, dialogs, command palette):
  A soft ambient shadow on elements that leave the page plane. Use the shadcn/Radix
  primitive's built-in shadow; do not hand-roll heavier ones.
- **Sticky-bar separation** (no shadow — `border-t` + `bg-background/95 backdrop-blur`):
  The pinned action bar at the bottom of detail pages reads as a distinct surface
  via a top border and a translucent backdrop, not a shadow.

### Named Rules
**The Flat-By-Default Rule.** If it is not actually floating above the page, it
has no shadow. Depth at rest is border + tone. If you find yourself adding a
`box-shadow` to a card to make it "pop," you have left the system — pull it back
to a Rule Line.

## 5. Components

### Buttons
- **Shape:** Gently rounded (`rounded-md`, 0.5rem). Height 2.5rem (`h-10`) default;
  2rem (`h-8`) small; 36×36 (`h-9 w-9`) icon.
- **Primary** (`variant="default"`): Filled carbonink green, `primary-foreground`
  text, `px-4`. Hover darkens to `primary/90`, press to `primary/95`. **One per
  page** (the One Mark Rule).
- **Outline:** 1px border, `card/40` background, hover `card/80`, press `card`.
  The default for every secondary action.
- **Ghost:** No border; hover `foreground/5`, press `foreground/8`. For tertiary
  and in-row actions.
- **Secondary:** `foreground/8` fill stepping to `/12` then `/15`. A quiet filled
  alternative when an outline would be too many borders.
- **Destructive:** `destructive/10` tint, `destructive` text, `destructive/30`
  border. Warns without a red fill.
- **Hover / Focus:** Hover treatments are subtle (native buttons do not fully
  recolor on hover). A real **pressed** state exists: `active:scale-[0.98]`. Focus
  is **ring-less** — outlined controls shift their existing border to `ring`
  (`focus-visible:border-ring`); the borderless ghost variant gets a
  `foreground/8` background instead. No 2–3px green halo.

### Badges / Chips
- **Style:** `rounded-md`, `px-2 py-0.5`, 12px medium text, `w-fit`, transparent
  border on filled variants. Inline SVG icons size to 12px (`size-3`).
- **Variants:** `default` (green fill — use sparingly, it spends the One Mark),
  `secondary` (neutral fill), `outline` (text + hover tint), `destructive`.
  Scope tags (`SCOPE 1/2/3`) are the most common chip; pair the color with the
  uppercase label so meaning never rides on color alone.

### Inputs / Fields
- **Style:** `h-10`, full width, 1px `border` border, white (`background`) fill,
  `rounded-md`, `px-3 py-2`, 14px text. The I-beam cursor is restored on inputs
  (chrome is `cursor: default`).
- **Focus:** Border-color shift to `ring` only — **no outer ring halo**, so the
  field sits cleanly inside `overflow:auto` detail panes without clipping.
- **Disabled:** `opacity-50` + `not-allowed` cursor.

### Navigation (Sidebar)
- **Style:** Collapsible left sidebar on Sidebar White (`oklch(0.985 0 0)`).
  Rows are full-width nav links, `cursor: default` (never `pointer` — they are app
  chrome, not web links). Active row uses the green-tinted accent; hover uses
  `sidebar-accent` (`foreground/6`).
- **Native chrome:** The right divider is a `::after` pseudo-element starting at
  `top: 3rem` so it never cuts through the macOS traffic-light cluster. In
  icon-collapsed mode, rows become 32×32 chips with an invisible ±8px hit-rect
  extension. The title-bar zone is `-webkit-app-region: drag`.

### List Row (signature component)
Reach for a vertical list-row before an HTML `<table>` (tables force fixed columns
and truncate as soon as one EF descriptor grows). Structure:
`<ul className="divide-y divide-border rounded-md border border-border bg-card">`
with `<li className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30">`.
- **Title row:** primary identifier, `truncate` + `title=` for the hover tooltip,
  with a status indicator or single trailing action on the right.
- **Meta row:** scope/category chip(s) + dot-separated secondary metadata.
- Numbers `tabular-nums`; codes `font-mono`. More than one action → dropdown.
Reserve real `<table>` for column-aligned deliverables (e.g. an exported ledger).

## 6. Do's and Don'ts

### Do:
- **Do** reserve the filled green button for the single most important action on a
  page; everything else is `outline` or `ghost` (the One Mark Rule, ≤10% green).
- **Do** convey depth with a 1px `border` (`oklch(0.929 0 0)`) and ≤2% tonal steps;
  give shadow only to genuinely floating layers (popovers, dialogs, command palette).
- **Do** keep cards and the page on the same pure white (`oklch(1 0 0)`).
- **Do** use `cursor: default` on all chrome; restore the I-beam only on inputs and
  the pointer only on inline content links (`td/dd/.prose a[href]`).
- **Do** test every layout in both zh-CN and en; add `whitespace-nowrap` to button
  labels so CJK never stacks vertically. Keys land in both `messages/*.json`.
- **Do** use `tabular-nums` for figures and `font-mono` for codes/IDs.
- **Do** pair status/scope color with an icon or label so meaning never rides on
  color alone; honor `prefers-reduced-motion`.
- **Do** hold muted body text at `oklch(0.5 0.012 95)` or darker on white — verify
  ≥4.5:1 (≥3:1 for large text), placeholders included.

### Don't:
- **Don't** build the flashy SaaS marketing-dashboard: no hero-metric template (big
  number + gradient + supporting stats), no decorative gradients, no glassmorphism.
  That energy lives in `cloud/web`, never in the app shell.
- **Don't** introduce consumer-app cuteness — no mascots, bouncy/elastic motion, or
  emoji-as-UI.
- **Don't** ship web-app tells: `cursor: pointer` on chrome, painted CSS window
  corners (`border-radius` on the window), or fonts that fight the OS stack.
- **Don't** add a `box-shadow` to a resting card to make it "pop" — use a Rule Line.
- **Don't** give a card a gray fill to fake elevation (the No-Fill-For-Cards Rule).
- **Don't** add a 2–3px focus ring/halo — shift the border to `ring` instead.
- **Don't** use all-caps tracked eyebrows above sections; uppercase is for short
  scope tags only.
- **Don't** reach for a `<table>` on an interactive data page — use the list-row;
  tables truncate the moment one descriptor grows.
- **Don't** use `border-left`/`border-right` > 1px as a colored accent stripe on
  cards, rows, or callouts.
