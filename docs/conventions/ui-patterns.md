# UI patterns — scroll, lists, buttons

> Detailed reference for `AGENTS.md`. Linked, not auto-loaded. Covers the three
> renderer conventions: scroll containment, list-item layout, button hierarchy.

## Scroll containment

**Default**: page chrome stays put; only the content the user is reading scrolls.

For any list-or-detail page where the action surface is reusable (heading,
filter bar, action buttons), do NOT let those scroll off-screen. Pin them
top and/or bottom and confine the scroll to the data region in the middle.

### When the page is just a list (e.g. `/sources`, `/activities`)

```tsx
<Main className="flex h-full flex-col gap-4">
  <div className="shrink-0">{/* heading + Add button + open form */}</div>
  <ul className="flex-1 min-h-0 overflow-auto …">{/* items */}</ul>
</Main>
```

- `Main` becomes a flex column at full parent height. Its built-in
  `px-6 py-6` padding still applies — `box-sizing: border-box` is in
  effect so `h-full` already accounts for it.
- The top section is `shrink-0` so it never collapses.
- The list claims `flex-1 min-h-0` (the `min-h-0` is mandatory — flex
  children default to `min-height: auto` and won't shrink past
  intrinsic content size without it) and owns its own `overflow-auto`.
- The root scroll container (`<div @container/content overflow-auto>`
  in `__root.tsx`) never triggers because the inner content fits the
  parent's height exactly.

### When the page has top + bottom chrome (e.g. `/questionnaires/$id`)

```tsx
<div className="flex h-full flex-col">
  <div className="shrink-0 px-6 pt-6 pb-3">{/* heading + meta + warnings */}</div>
  <div className="flex-1 min-h-0 overflow-auto px-6">{/* scrolling cards */}</div>
  <div className="shrink-0 flex justify-end gap-2 border-t border-border bg-background/95 backdrop-blur px-6 py-3">
    {/* action bar — Finalize / Export / Generate */}
  </div>
</div>
```

- The action bar has a subtle top border + translucent backdrop so it
  reads as a distinct surface from the scrolling content above it.
- The action bar is hidden when the list is empty (no actions are
  meaningful then).
- Padding lives on each section (not the outer wrapper) so the border
  on the bottom bar runs edge-to-edge.

### When the page renders inside a two-pane Outlet (e.g. `/questionnaires/*`)

The parent layout's right pane is **`overflow-hidden`, no padding**:

```tsx
<ResizablePanel defaultSize="68%">
  <div className="h-full overflow-hidden">
    <Outlet />
  </div>
</ResizablePanel>
```

Each Outlet child owns its own padding + scroll structure. A child that
DOES want a single body scroll (e.g. `/questionnaires/new` upload form)
wraps `<Main>` in `<div className="h-full overflow-auto">`. A child that
wants sticky-top/bottom uses the flex-column pattern above.

**Don't** put `overflow-auto p-6` on the right-pane wrapper itself — it
forces every child through one rigid scroll model and breaks the
sticky-bottom action-bar pattern. Centralized padding also makes
children's `h-full` overshoot by the padding amount and trigger an
unintended outer scrollbar.

## List item layout (preferred over HTML tables for data pages)

Reach for a vertical card-row list before reaching for a `<table>`.
Tables force every cell into a single line and a fixed column width,
which causes horizontal-overflow and truncation as soon as one EF
descriptor or one source name grows. A list-item layout:

```
┌──────────────────────────────────────────────┐
│ Source name (truncates)         ● status     │
│ [SCOPE] · category · other meta              │
└──────────────────────────────────────────────┘
```

- Title row: primary identifier (name / question), `truncate` + `title=`
  attribute for hover tooltip.
- Meta row: chip(s) + dot-separated secondary metadata.
- Right side: status indicator OR a single trailing action (Rebind,
  Open). For more than one action, drop into a dropdown.
- Container: `<ul className="divide-y divide-border rounded-md border border-border bg-card">` and `<li className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30">`.
- Numbers use `tabular-nums`; codes use `font-mono`.

Reserve `<table>` for pages where a column-aligned dataset really is the
deliverable (e.g. an exported activity ledger). For interactive Inventory
+ Inputs pages where users scan one item at a time, use the list form.

## Action button hierarchy (skill 06 — native conventions)

Reserve `variant="default"` (filled green) for the ONE most important
action on a page. Everything else uses `variant="outline"` or
`variant="ghost"`. The questionnaire detail action bar is the
canonical pattern: Finalize is filled; Generate-all, Export-Excel,
Export-PDF are outline.
