# Deferred Post-Launch Items

**Date:** 2026-05-25
**Context:** Phase 5.1–5.3 shipped. Two items from the original post-launch
list are intentionally deferred and need their own design before any code.

## Deferred 1 — Undo / Redo

**Why deferred:** Native desktop users expect ⌘Z to undo their last
action. We don't have a primitive for this today, and bolting it onto
existing services would produce a fragmented, partial undo that's worse
than no undo at all.

**Open questions to answer before writing the plan:**

1. **Scope** — which mutations should be undoable?
   - Activity create / edit / delete? (high value)
   - Source create / edit / delete? (high value)
   - Extraction confirm / discard? (medium — reversal is "discard the
     created activity")
   - Settings changes? (low value, usually no)
   - Onboarding completion? (no — too entangled)

2. **Storage model**
   - **Per-mutation inverse closures stored in memory** — small, fast,
     lost on restart. Matches macOS NSUndoManager.
   - **Append-only `change_log` table with forward + reverse SQL** —
     durable across restart, but redo across restart is risky if data
     changed in between.
   - **Hybrid** — in-memory for current session + last-write recovery on
     restart (single-level only).

3. **UI surface**
   - System ⌘Z + ⇧⌘Z bindings (Electron menu)
   - "Undo" toast after destructive actions (sonner already supports
     this — see how activity-delete might surface it)
   - Visible undo history? (probably no — Mac apps don't show this)

4. **Cross-tab consistency**
   - Undo on /activities reverses an activity; does the dashboard reflect
     it instantly? (yes — query invalidation already handles this)

**Estimated effort:** 1–2 weeks. Needs design spec first.

## Deferred 2 — Migration tool (import from other apps)

**Why deferred:** "Migration" without a defined source format is air
work. We don't know which tools users actually have data in. Likely
candidates worth supporting: 
- Generic Excel template (a standard CarbonInk-published template)
- CDP-style questionnaire spreadsheets (we already parse these for the
  questionnaire feature; could reuse for inventory data import)
- Climate Disclosure Project / GHG Protocol Workbook downloads

**Open questions:**

1. **Target source** — which one matters first?
2. **Mapping UI** — column-mapping wizard, or hardcoded for known
   templates only?
3. **Conflict handling** — what if the import would overwrite an
   existing activity?
4. **Audit trail** — should imported rows have a special `imported_from`
   field?

**Estimated effort:** 1 week per source format. Needs design spec first.

## Not deferred — landed in Phase 5

- ✅ Language switcher (Phase 5.1)
- ✅ About + open data folder (Phase 5.1)
- ✅ Backup / restore / reset / cache cleanup (Phase 5.2)
- ✅ Theme switcher (Phase 5.3)
- ✅ Log viewer / open log folder (Phase 5.3)
- ✅ Auto-backup (daily snapshot to userData/auto-backups/) (Phase 5.3)
- ✅ Audit log export to CSV (this commit)
