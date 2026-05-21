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

## What's deferred to Round 3

- Toast → OS-native style
- `<select>` → shadcn `Select` (combobox) in Settings page
- macOS `systemPreferences.getAccentColor()` → drive `--color-primary`
- Dark-mode toggle + `nativeTheme.shouldUseDarkColors`
- `prefers-reduced-motion` honor for all transitions
- ListItem primitive extraction (when a 4th list adopts the pattern)
- `/audit` two-pane (needs a detail UI design first)

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
