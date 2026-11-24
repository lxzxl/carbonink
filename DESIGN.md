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
  body:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI Variable Text', 'Segoe UI', 'PingFang SC', 'Microsoft YaHei UI', sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.4
  mono:
    fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace"
    fontSize: "0.8125rem"
    fontWeight: 400
    lineHeight: 1.5
rounded:
  sm: "0.25rem"
  md: "0.5rem"
spacing:
  row-y: "0.75rem"
  row-x: "1rem"
  page: "1.5rem"
---

# Design System: CarbonInk

> Applies to the CarbonInk desktop product (`desktop/` 1.x tokens below; see [app/DESIGN.md](app/DESIGN.md) for the NSGo 2.0 token table and native layout rules, and [cloud/AGENTS.md](cloud/AGENTS.md) for the `carbonink.xyz` marketing palette).

## 1. Overview — "The Ledger"

CarbonInk is an accountant's ledger made digital: pure-white surfaces, ink-dark figures, hairline rules, and a single green mark of verification. Density is a feature — hierarchy comes from type weight, scale, and whitespace rhythm, never from color floods, resting shadows, or decorative chrome. Marketing energy lives in `cloud/web/`, never in the app shell.

## 2. Colors (OKLCH)

- **Carbonink Green (`primary` `oklch(0.55 0.16 160)` / dark `oklch(0.65 0.18 160)`)**: Primary action, verified/active state, focus rings, brand wordmark.
- **Neutrals**: **Page White** (`oklch(1 0 0)`), **Sidebar White** (`oklch(0.985 0 0)`), **Ledger Ink** (`oklch(0.18 0.012 95)`), **Muted Ink** (`oklch(0.5 0.012 95)` — WCAG AA floor on white), **Rule Line** (`oklch(0.929 0 0)`), **Surface Tints** (`secondary oklch(0.96 0.008 95)`, `muted oklch(0.95 0.008 95)`).
- **Alarm Red (`destructive` `oklch(0.55 0.2 25)`)**: Destruction and hard errors only; usually paired as `destructive/10` behind text so it warns without screaming.

## 3. Named Rules

- **The One Mark Rule:** Carbonink green covers ≤10% of any screen and never two co-equal greens at once. Reserve the filled green button for the single primary action per page; secondary actions are `outline` or `ghost`.
- **The No-Fill-For-Cards Rule:** Cards and the page share one pure white (`oklch(1 0 0)`). Separation is a 1px Rule Line and ≤2% tonal steps, never a gray card fill.
- **The Flat-By-Default Rule:** Resting cards, rows, and sections have no shadow. Shadow belongs only to genuinely floating layers (popovers, dialogs, command palette); sticky action bars use `border-t` + `bg-background/95 backdrop-blur`.
- **The Sentence-Case Rule:** Section eyebrows and labels are sentence case (uppercase is reserved for short tags like `SCOPE 1`). Add `whitespace-nowrap` on button labels so CJK labels never wrap vertically.

## 4. Typography & Layout

- **Fonts:** OS-native sans (`-apple-system` / `Segoe UI Variable Text`, followed by `PingFang SC` / `Microsoft YaHei UI` for CJK); `ui-monospace` for codes, IDs, and paths.
- **Hierarchy:** Headline `1.125rem` (600), Title `0.9375rem` (600), Body `0.875rem` (400, 65–75ch max prose measure), Label `0.75rem` (500), Mono `0.8125rem` (400). Use `tabular-nums` for every numeric column and date.
- **Components:**
  - **Buttons:** `h-10` default, `h-8` small, `h-9 w-9` icon, `rounded-md`. Focus shifts border to `ring` (`focus-visible:border-ring`) — no outer 2–3px focus halo inside scrollable panes.
  - **Inputs:** `h-10`, 1px border, I-beam cursor (chrome stays `cursor: default`; pointer cursor only on inline content links).
  - **List Row (over `<table>`):** Prefer vertical `divide-y` list rows (`truncate` title + status/single action on right, scope/category chips + dot-separated meta below; >1 action collapses into a dropdown). Reserve `<table>` for column-aligned deliverables.
- **Accessibility & Parity:** WCAG AA contrast floor (≥4.5:1 body, ≥3:1 large text), never encode meaning in color alone, honor `prefers-reduced-motion`, and verify every layout in both `zh-CN` and `en`.
