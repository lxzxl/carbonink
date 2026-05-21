# UI Redesign — shadcn shell + IA + two-pane (shipped)

> **Status**: shipped. Plan: `docs/plans/2026-05-21-carbonbook-ui-redesign.md`.
> **Reference**: Craft Agents (https://github.com/craft-ai-agents/craft-agents-oss).
> **Tests**: 653/653 passing throughout (no regression). Typecheck + biome
> clean on every commit.

This delivery follows the two earlier UI-polish rounds (Round 1: vibrancy +
font stack + cursor reset + devtools gate; Round 2: button hierarchy + KPI
typography + empty states + PDF chrome) and replaces carbonbook's hand-rolled
shell with shadcn's official Sidebar primitives, then restructures the
content routes into a native-feel two-pane layout.

## Phase A — shadcn shell foundation (`66c43dd` + `b21ac65`)

Installed shadcn's official **Sidebar** block + companion primitives:
`sidebar`, `resizable`, `separator`, `tooltip`, `sheet`, `breadcrumb`,
`collapsible`, `dropdown-menu`, `skeleton`. Source pulled from the
`new-york-v4` registry verbatim, registry imports rewritten to project
aliases (`@renderer/...`).

Replaced `Sidebar.tsx` (hand-rolled) with `AppSidebar.tsx` built on
`SidebarProvider` → `Sidebar` → `SidebarMenu`. The Provider owns:
- Cookie-persisted collapse state (icon-only ↔ full).
- `Cmd/Ctrl+B` global hotkey.
- Mobile Sheet fallback.

Added CSS tokens (`--color-sidebar*`) wired to `transparent` so macOS
vibrancy / Windows mica blur through.

`__root.tsx` rebuilt around `SidebarProvider` + `SidebarInset`; a thin
TopBar row hosts the `SidebarTrigger`.

## Phase B — sidebar IA grouping (`1bc9383`)

Flat nav → three groups:
- **Inventory** — Sources / Activities / Reports
- **Inputs** — Documents / Questionnaires
- **More** — Audit

Dashboard stays at the top (ungrouped); Settings + MCP indicator stay in
the SidebarFooter. The grouping reflects the user's mental model — "feed
the system" (Inputs) vs "look at the numbers" (Inventory) vs "trace
changes" (More).

## Phase C — `/documents` two-pane (`1c1699a`)

`/documents` now uses shadcn `ResizablePanelGroup`:
- **Left** (~32%, user-resizable): doc list + upload zone.
- **Right** (~68%): detail Outlet — PDF preview + extraction review.

File restructure:
- `documents.tsx` → layout (left list + Outlet)
- `documents.index.tsx` → "no doc selected" right-pane (upload zone OR
  provider-not-configured banner)
- `documents.$id.tsx` → detail (moved from `documents_.$id.tsx`)
- Deleted `documents_.$id.tsx`

List rows: compact, status-dot prefix (review_needed=amber, parsed=green,
rejected=red, none=gray), title + meta line, hover + selected states.

The previous monolithic flat-route detail page used a `<BackLink>` because
the list disappeared on detail load. With nested routes the list stays
visible, so the back link is gone.

## Phase D — `/questionnaires` + `/reports` two-pane (`b29c5f2`)

Same pattern applied:
- `questionnaires.tsx` → layout
- `questionnaires.index.tsx` → empty state
- `questionnaires.$id.tsx` + `questionnaires.new.tsx` → moved from underscored variants
- `reports.tsx` → layout
- `reports.index.tsx` → empty state
- `reports.$id.tsx` → moved from `reports_.$id.tsx`

`/audit` left as single-pane — no detail route exists; events display inline.

## Phase E — list-item polish (folded into C+D)

The compact list-item treatment (status dot + title + meta + hover/selected)
was implemented inline in each Phase-C/D list refactor. A reusable `ListItem`
primitive could be extracted later when a fourth list adopts the pattern;
for now duplication is small (~20 LoC × 3 lists) and each list has slight
shape differences (documents has status dot + stage label; questionnaires has
status text + question count + due date; reports has just year + granularity).

## Phase F — TopBar (`9580a18`)

New `<TopBar>` component owns the chrome row:
- `SidebarTrigger` (toggle, same Cmd+B hotkey).
- Back/Forward arrows wrapping `router.history.back()/forward()` (TanStack Router).
- Breadcrumb derived from URL segments + i18n route labels; detail routes
  show parent + "Detail" placeholder (the detail page's own header carries
  the entity name, so the breadcrumb stays terse).
- `titlebar-region` for window drag; children opt out with `[-webkit-app-region:no-drag]`.
- `ml-16` reserves macOS traffic-light space.

## Dependencies added

| Package | Why |
|---|---|
| `@radix-ui/react-collapsible` | shadcn collapsible (sidebar groups, future) |
| `@radix-ui/react-dialog` | shadcn sheet (mobile sidebar fallback) |
| `@radix-ui/react-dropdown-menu` | shadcn dropdown-menu (future use) |
| `@radix-ui/react-separator` | shadcn separator |
| `@radix-ui/react-tooltip` | shadcn sidebar tooltips (icon-collapsed mode) |
| `react-resizable-panels` | shadcn resizable — two-pane splitter |
| `radix-ui` | barrel package — shadcn v4 source style |

Approx +500 KB minified across all new deps. The shadcn primitives are
copied into the repo (philosophy: own your UI) — only the Radix runtime
deps ship to users.

## Round 3 (shipped)

Continuing the native-feel polish after Phases A-F. Two items from the
original deferred list were dropped after re-evaluation:

- **macOS `systemPreferences.getAccentColor()`** — user decision during
  the redesign was "保留 carbonbook 绿" (keep brand green). System
  accent would have replaced our brand identity color.
- **shadcn `Select` for native `<select>`** — native `<select>` is the
  OS-native dropdown widget on both macOS and Windows. Replacing it
  with Radix Select would make it *less* native (more web-styled).
  Per skill T3 "adopt the platform; don't compete with it".

What did ship:

- **Sonner toast styling**: softer 2-line shadow tuned for vibrancy
  backdrops, `bg-card` 80%-opaque so vibrancy edges through, 13px text
  (system convention). Replaces the harsher web-banner default chrome.
- **`prefers-reduced-motion` global rule**: every transition/animation
  capped at 0.01ms (not 0 — keeps `onTransitionEnd` handlers firing
  that shadcn primitives rely on). `scroll-behavior: auto` too.
  Skill ship-readiness item #39.
- **`/audit` two-pane**: filter section + compact event list on left,
  selected event detail on right. Selection is local state (no
  `audit/$id` route — events rarely need deep-linking and adding a
  routed approach would bloat the route tree for marginal benefit).
- **`ListItem` primitive** (`src/renderer/components/app-shell/ListItem.tsx`):
  shared compact-row component used by `/documents`, `/questionnaires`,
  `/reports`, and `/audit` list columns. Removes ~70 LoC of duplication
  across those routes. Slot-based API: `leading` / `title` / `meta` /
  `right`. Renders as either `<Link>` (when `to` provided) or `<button>`
  (when `onClick` provided — for local-state selection). `<StatusDot>`
  companion component standardizes the leading colored dot used by
  documents.

## What's deferred to a future round

- Dark mode (user explicitly said "暂不考虑暗色" — keep light-only)
- `/audit/$id` routed deep-links (if export/share use cases emerge)
- Additional `ListItem` slots if a future list adopts richer per-row
  layouts

## Round 4 (shipped) — detail polish from screenshot review

A second design-review pass identified ~15 issues. All addressed across
five commits (a-e):

### Batch A — `ui(round-4-a)`: humanize + hide internals
- **Extraction panel** no longer shows the raw prompt registry
  description ("Chinese electricity bill — classify + extract") nor
  the LLM provider/model chip. Just stage label ("电费账单") +
  confidence chip. Prompt version still hoverable via `title` for
  debugging.
- **Question raw codes** ("公司信息IB2") moved from a visible chip to
  a `title` tooltip on the question text. Useful for audit; not
  important during answering.
- **`AnswerReviewCard.生成答案`** changed from `default` (filled green)
  to `outline`. Per-card primaries created a wall of green buttons —
  reserved primary for the page-level batch + finalize actions.
- **`questionnaires/$id` back link** removed — the parent two-pane
  layout keeps the questionnaire list visible on the left, so the
  back navigation is redundant.

### Batch B — `ui(round-4-b)`: audit humanize
- **EF transition** now resolves `factor_code` to `name_zh` via a
  `useQuery(['ef:get-by-pk', pk])` lookup. `electricity.grid.cn.national.2024 →
  electricity.grid.cn.east.2024` becomes `全国电网均值 (2024) → 华东电网 (2024)`.
  Falls back to the raw code when EF library hasn't loaded; raw still
  on hover via `title`.
- **Activity ID** rendered as a `<Link to="/activities">` instead of
  inline text. Click drops the user near the row.
- **Filter section** rebuilt: kind selector is a row of toggle pills
  (replaces bare checkbox), date range is a 2-column grid, reset
  link sits on its own row right-aligned. Was cramped to two lines
  pre-Round-4.

### Batch C — `ui(round-4-c)`: layout
- **Documents upload zone** collapsed by default to a "+ 上传文档"
  button in the list-column header. Click expands the dropzone. Saves
  ~120 px of permanent vertical real estate when the user has 10+ docs.
- **PDF / extraction split** in `/documents/$id` shifted from 55/45 to
  65/35. The detail panel didn't need ~45% of an already-narrow
  column.
- **TopBar gap** between the sidebar toggle and the back/forward pair
  widened to `gap-3` so they read as two groups, not one cramped row.

### Batch D — `ui(round-4-d)`: refinements
- **`lib/format.ts`** — single source of truth for number formatting:
  `formatCo2e`, `formatInteger`, `formatSignedInteger`,
  `formatSignedPercent`. Replaced ad-hoc `Intl.NumberFormat` calls in
  the dashboard + audit card. No more `14501.820000000002` (12 decimal
  digits) anywhere.
- **Sidebar IA**: audit log moved from a single-item "更多" group up
  to the top section beside the dashboard. A group label longer than
  its only child was visual noise.
- **Brand glyph**: leaf icon (`lucide.Leaf`, tinted with
  `--color-primary`) now sits to the left of the "carbonbook" wordmark
  in the sidebar header. Remains visible in icon-collapsed mode while
  the wordmark hides.

### Batch E — `ui(round-4-e)`: dashboard widgets
- **Monthly trend bar chart**: pure-divs bar chart of the last 12
  months' total CO2e. Empty months render a 1 px baseline so the axis
  reads continuously. Hover title shows exact value.
- **Recent activities widget**: 5 most-recent activities by
  `occurred_at_end`, showing source name + date + CO2e. "View all"
  link to `/activities`. Replaces the previously-empty bottom 80%
  of the dashboard.
- Both widgets share one cached `activity:list-by-period` query — no
  extra IPC roundtrips.

655/655 vitest, typecheck + biome clean on every commit.

## File summary

| Added | Modified | Deleted |
|---|---|---|
| `AppSidebar.tsx` | `__root.tsx` | `Sidebar.tsx` |
| `app-shell/TopBar.tsx` | `documents.tsx` (rewrite) | `documents_.$id.tsx` |
| `documents.index.tsx` | `questionnaires.tsx` (rewrite) | `questionnaires_.$id.tsx` |
| `documents.$id.tsx` | `reports.tsx` (rewrite) | `questionnaires_.new.tsx` |
| `questionnaires.index.tsx` | `globals.css` (sidebar tokens) | `reports_.$id.tsx` |
| `questionnaires.$id.tsx` | `package.json` + lockfile | |
| `questionnaires.new.tsx` | `button.tsx` (icon size) | |
| `reports.index.tsx` | various tests (import paths) | |
| `reports.$id.tsx` | i18n: 8 new keys | |
| `ui/{sidebar,resizable,separator,tooltip,sheet,breadcrumb,collapsible,dropdown-menu,skeleton}.tsx` (9 shadcn pulls) | | |
| `lib/hooks/use-mobile.ts` | | |
| `components.json` | | |
