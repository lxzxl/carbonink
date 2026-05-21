# Carbonbook UI Redesign Plan

> **Reference**: Craft Agents (https://github.com/craft-ai-agents/craft-agents-oss).
> **Goal**: Move from current "sidebar + main" 2-pane layout to a more native
> 3-pane (sidebar + list + detail) layout where it fits, matching the visual
> density + IA grouping of Craft Agents.

**Baseline**: `dd81f5e` on `main`. 653 vitest passing. Round 1 + 2 native-feel
polish already shipped (vibrancy, font stack, button hierarchy, PDF chrome).

**Patterns to adopt from Craft Agents:**
- 3-pane shell (sidebar + list column + detail) — toggleable via right-pane
  button.
- Collapsible sidebar sections (`Inventory ▼`, `Documents ▼`, ...).
- Sub-items under sections with status-dot prefix + compact rows.
- `<TopBar>` with: traffic-lights spacer (mac), back/forward arrows tied to
  browser-style history, optional title + dropdown, right-side sidebar toggle.
- Pill-style item rows (icon · title · optional badge count).
- Small typography (13px / xs) throughout; bigger text reserved for
  page headings and KPI numbers.

**Patterns to NOT adopt:**
- Jotai store (TanStack Query is fine for our data shape).
- Full panel-stack system (we don't need swappable nested panels).
- Chat-specific bits (sessions, messages, agent dropdowns).

---

## Information Architecture: current → new

### Current sidebar (flat list)
```
仪表盘
排放源
活动数据
文档
问卷
报告
审计日志
─────
[MCP status]
⚙ 设置
```

### New sidebar (grouped + collapsible)

```
[carbonbook]                     ← brand row (top)

  📊  仪表盘                      ← top-level (no nesting)

▼ 📦  排放清单                    ← expandable section
       排放源                       ← sub-item
       活动数据                     ← sub-item  
       报告                         ← sub-item

▼ 📄  文档                        ← expandable section
       全部
       ● 待审核                    ← amber-dot status filter
       ● 已确认                    ← green-dot status filter
       ● 已否决                    ← red-dot status filter

▼ 📋  问卷                        ← expandable section
       全部
       草稿
       已定稿

  🔍  审计日志                    ← top-level
─────
  [MCP indicator]                 ← bottom-fixed
  ⚙ 设置
```

Active states match: route + filter map directly to a single sidebar row.

---

## Top bar

```
┌────────────────────────────────────────────────────────────────────────┐
│ 🔴🟡🟢   ← →     (centred: 文档 / 04-purchase-sample.pdf ▾)      [☰] │
│  mac     back/                                                  toggle │
│  TL      forward                                                       │
└────────────────────────────────────────────────────────────────────────┘
```

- macOS: 32px tall to clear traffic lights; titlebar-region drag handle.
- Back/forward: ties to TanStack Router's history (canGoBack / canGoForward).
- Right toggle: hides the middle list column (or both side columns).
- Center: page title; for detail routes, dropdown switches between siblings.

---

## Layout primitives

```tsx
<AppShell>
  <Sidebar />                     // 240px, collapsible to 0
  <TopBar>                        // 32px, always visible
    <NavArrows />
    <Title />
    <SidebarToggle />
  </TopBar>
  <Body>
    <Outlet />                    // routes choose 1- or 2-column body
  </Body>
</AppShell>
```

For routes that use the 2-column body:
```tsx
<TwoPaneLayout
  list={<DocumentList />}
  detail={<Outlet />}             // detail nested route
  defaultListWidth={320}
/>
```

For routes that don't:
```tsx
<SinglePaneLayout>
  <Outlet />
</SinglePaneLayout>
```

---

## Phased delivery

### Phase A — Shell foundation (no IA change yet)
**Goal**: introduce `<AppShell>` + `<TopBar>` + new `<Sidebar>` underneath
the existing flat nav. All existing routes still render fine as 2-pane.

Files:
- `src/renderer/components/app-shell/AppShell.tsx` (NEW)
- `src/renderer/components/app-shell/TopBar.tsx` (NEW)
- `src/renderer/components/app-shell/Sidebar.tsx` (NEW — replaces old `Sidebar.tsx`)
- `src/renderer/components/app-shell/SidebarToggle.tsx` (NEW)
- `src/renderer/components/app-shell/types.ts` (NEW — SidebarItem, SidebarGroup)
- `src/renderer/routes/__root.tsx` (MODIFY — render `<AppShell>`)

Tests:
- `tests/renderer/app-shell.test.tsx` — collapse toggle, active route, nav arrows

### Phase B — Sidebar IA grouping
**Goal**: expandable sections (Inventory / Documents / Questionnaires) with
sub-items. Status sub-items in Documents use the existing
`extraction:list-statuses` data for the dot indicators.

Files:
- `src/renderer/components/app-shell/Sidebar.tsx` (expand)
- `src/renderer/components/app-shell/SidebarSection.tsx` (NEW — collapsible)
- `src/renderer/components/app-shell/SidebarStatusDot.tsx` (NEW)
- i18n: section labels (`nav_section_inventory`, `nav_section_documents`, etc.)

Tests:
- `tests/renderer/sidebar-sections.test.tsx` — expand/collapse, filter routes

### Phase C — Two-pane body for /documents
**Goal**: `/documents` becomes `list + detail`. Selecting a row populates the
detail pane without leaving the route. Implements the layout primitive.

Files:
- `src/renderer/components/app-shell/TwoPaneLayout.tsx` (NEW)
- `src/renderer/components/app-shell/PaneResize.tsx` (NEW — drag handle)
- `src/renderer/routes/documents.tsx` (REWRITE — splits into list + outlet)
- `src/renderer/routes/documents.$id.tsx` (NEW — flat layout, was `documents_.$id`)
- Delete: `src/renderer/routes/documents_.$id.tsx`

The `.$id` (with leading dot, no underscore) puts the detail INSIDE the
parent's outlet — TanStack Router pattern for nested routes.

Tests:
- `tests/renderer/documents-two-pane.test.tsx` — list selection updates detail

### Phase D — Two-pane body for /questionnaires + /audit + /reports
**Goal**: same treatment for the other 3 detail-bearing routes.

Files (each route gets the same pattern):
- `routes/questionnaires.tsx` + `routes/questionnaires.$id.tsx`
- `routes/audit.tsx` (no $id but: filter+list left, event detail right)
- `routes/reports.tsx` + `routes/reports.$id.tsx`
- Delete the `_.` underscored variants

### Phase E — List item polish
**Goal**: every list-column item gets the new visual treatment:
- 13px font; row height ~36px
- Leading status dot (colored, 8px)
- Title (1 line, ellipsis) + meta row (subtitle, muted)
- Hover: subtle bg tint; selected: stronger tint + accent border-left

Files:
- `src/renderer/components/app-shell/ListItem.tsx` (NEW — primitive)
- Documents row, questionnaires row, audit event row, reports row migrate to it.

### Phase F — Top bar features
**Goal**:
- Back/forward arrows tied to `router.history.canGoBack()` / `goForward()`.
- Right-side sidebar toggle button.
- Center: route title + optional dropdown (when on a detail page, dropdown
  lists sibling items — like Craft's "Done > Review Claude Agent SDK ▾").

Files:
- `src/renderer/components/app-shell/TopBar.tsx` (expand from Phase A)
- `src/renderer/components/app-shell/TopBarBreadcrumb.tsx` (NEW)
- `src/renderer/components/app-shell/NavArrows.tsx` (NEW)

### Phase G — Sweep + ship
- Update all in-tree tests touching __root or Sidebar.
- Update screenshot fixtures (if we have any — none currently).
- biome + typecheck + full vitest green.
- Release note: `docs/release-notes/ui-redesign.md`.

---

## Estimated commits + tests

| Phase | Commits | New tests |
|---|---|---|
| A | 3 | 4 |
| B | 2 | 3 |
| C | 3 | 5 |
| D | 4 | 8 |
| E | 2 | 4 |
| F | 2 | 3 |
| G | 1 | 0 |
| **Total** | **~17** | **~27** |

Target: 653 → ~680 tests. Typecheck + biome clean on every commit.

---

## Open decisions to lock before execution

1. **Sidebar default width**: 240px (Craft) vs 224px (current) — recommend 240.
2. **List column default width**: 320px (recommend), user-resizable via PaneResize.
3. **Theme**: keep light-only for now, or add dark-mode toggle in this redesign?
   - Recommend: light-only, dark mode is a Round 3 polish item.
4. **Brand green vs system accent**: keep brand green (it's our color identity);
   sidebar active state already tinted in Round 1.
5. **Localization fall-through**: existing keys keep working; new keys
   added under `nav_section_*`, `topbar_*`, `sidebar_*`.

---

## Risk notes

- TanStack Router nested routes can be finicky — Phase C is the first time
  we use the `.$id` (dotted) pattern. The current code uses `_.$id`
  (underscored, flat) routes. Test the dotted pattern in isolation first.
- The titlebar-region drag-handle div currently lives in `__root.tsx`;
  moving it inside `<TopBar>` must preserve the `WebkitAppRegion: drag`
  CSS or the user can't drag the window.
- React-Resizable-Panels is an external dep ~40kb gzipped. Use it for
  `<PaneResize>` rather than rolling our own splitter.

---

## After this redesign

The remaining native-feel items from `ship-readiness.md`:
- Toast → native-styled (low impact)
- `<select>` → native combobox (Settings page only)
- macOS accent color hook (system → primary)
- Dark mode + `nativeTheme.shouldUseDarkColors`
- `prefers-reduced-motion` honors

These are Round 3 polish — out of scope for this redesign.
