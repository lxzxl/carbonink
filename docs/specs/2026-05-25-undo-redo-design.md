# Undo/Redo Design

**Date:** 2026-05-25
**Status:** spec
**Trigger:** Phase 5 post-launch backlog (`docs/specs/2026-05-25-deferred-post-launch.md` → Deferred 1).

## Goal

Native desktop users expect ⌘Z to undo their last action. Today CarbonInk
silently swallows mistakes — there's no way back from a misclicked Delete
or a wrong "确认重抽." Add a session-scoped Undo/Redo stack covering the
mutations most likely to be undone in anger.

## Architecture

In-memory, NSUndoManager-style undo manager owned by the main process:

- A single `UndoManager` instance lives on `IpcContext`. Holds two
  stacks of inverse closures (`undo[]` + `redo[]`). Each entry knows
  how to reverse one already-applied mutation by calling the same
  services + same transactions that produced it.
- Every undoable IPC handler, after a successful call, **pushes a
  closure onto the undo stack** describing how to roll the change back.
  The closure captures whatever state the inverse needs (old row,
  generated id, etc.) — typed per operation, no JSON-blob serialization.
- The renderer drives the loop with two new IPC channels:
  `undo:peek` (returns `{ undo_kind: string | null, redo_kind: string | null }`)
  and `undo:do` (executes the closure on top of the requested stack).
- Cleared on app quit and on `data:reset` / `data:import-backup` (the
  closures would point at gone state).

The main rationale for **in-memory only** is the user expectation gap.
Mac users don't expect ⌘Z to reach across an app restart; an "undo
that survives quit" sets up exactly the partial-undo confusion the
deferred doc called out (data changed between sessions, redo gets weird,
trust eroded). Cost of giving it up: zero — a re-launched user just
starts a fresh stack.

## Scope

Four mutation families ship with first-class undo. Everything else stays
non-undoable for now (Settings changes, onboarding completion, MCP
config writes, license activation, exports).

### 1. Activity create / update / delete

| Action      | Inverse                                                                                                                              |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `create`    | `delete` the new row by id. Pinned-EF row stays; the FK relaxation in commit `ca3f7eb` ensures stale pins don't block future deletes |
| `update`    | Re-INSERT the captured pre-update row (full column set). Note: `updated_at` snaps to its old value too — the audit log is the audit log |
| `delete`    | Re-INSERT the captured pre-delete row. Fails if a new answer was created in the meantime that references the old id (rare) — surface as toast, abandon the closure |

### 2. Emission source create / update / delete

Same shape as activity_data. Soft-delete is already the model
(`is_active = 0`), so delete-undo is just flipping the flag back to 1.

### 3. Extraction confirm / discard

| Action     | Inverse                                                                                                                                                                                                                                                  |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `confirm`  | Two-step: delete the spawned `activity_data` row (captured id), flip extraction back to `review_needed`. If the activity has been further edited (different EF, different amount), still delete it — that's the user's signaled intent ("undo my confirm") |
| `discard`  | Idempotent flip: `rejected` → `review_needed`, restore captured `parsed_json`. The fix in `6ce46bb` made `discard()` idempotent on rejected, this just runs it in reverse                                                                                  |

### 4. Answer finalize / unfinalize

Cheapest pair to undo — single column write per direction. Already has
explicit buttons; undo is the keyboard shortcut for the same operation.

## UI surface

Two surfaces, both ship together:

### A. Keyboard accelerator (always available)

`MenuItem` accelerators in the Electron application menu:

- **Edit → Undo (⌘Z / Ctrl+Z)** — `click: () => undoApi.do({ direction: 'undo' })`
- **Edit → Redo (⇧⌘Z / Ctrl+Y)** — `click: () => undoApi.do({ direction: 'redo' })`

Menu items are visible/enabled based on a `useQuery(['undo:peek'])` poll
(invalidated after every undoable mutation). Disabled state when the
target stack is empty.

### B. Inline toast on destructive actions (best-effort discoverability)

After a destructive mutation (`activity:create` is destructive of the
old "no activity" state; `*:delete`; `extraction:discard`), the
renderer fires a sonner toast:

> **已删除 / Deleted** · `[撤销]`

Click handler on the action button calls `undoApi.do({direction:'undo'})`.
Toast auto-dismisses on the standard sonner timeout (5s). Not shown for
edits — that would be visual noise on every cell change.

## License-gate interaction

**Undo respects `READ_ONLY_BLOCKED_CHANNELS`.** A user whose license
expired cannot perform new writes (existing behaviour) and cannot undo,
because the inverse operation is itself a write. In practice this means:

- The undo stack is preserved across the license-state transition
  (user could re-activate and undo would resume)
- Calling `undo:do` while expired/revoked throws `LicenseReadOnlyError`
  the same way any other write would
- The keyboard accelerator wires through the same gate; the menu item
  shows disabled while the renderer's license-state query reports
  `expired` or `revoked`

This is consistency-over-convenience. Apple's NSUndoManager allows undo
through saved-document state, but CarbonInk's read-only semantics are
already documented as "no writes period" — making undo the exception
would surprise users who learned the gate's rules from the License
banner copy.

## Cross-cutting concerns

### Audit log

Each undo runs the inverse via the same service methods that produced
the original mutation, so audit events fire naturally — a deleted
activity that's undone shows up as a new `activity:created` audit
event. The audit log does not have a special "undone" event kind.
Rationale: the audit log is a record of *state changes*, not user
intent. The undo created a new state, regardless of how the user
arrived at it.

The cost: an audit reader sees `created → deleted → created` triples
without any cue that the third "created" was an undo. Acceptable for
v1; revisit if support cases come up.

### Query invalidation

The renderer's TanStack Query cache needs to invalidate the same keys
the original mutation invalidated. Two options:

- **Reuse the original mutation's `onSuccess` invalidation** (clean,
  requires a mapping from op kind → query keys)
- **Coarse invalidate** (`queryClient.invalidateQueries()` with no
  filter — invalidates everything) (simpler, slight perf hit, fine
  because undo is rare)

Spec recommends the coarse path for v1. The activity / source / answer
caches re-fetch in <100ms locally — not user-perceptible.

### Edge cases

- **Multi-step closures fail mid-way**: e.g., undo of `extraction:confirm`
  is delete-activity-then-flip-extraction. Wrap the whole inverse in a
  `db.transaction(...)` so partial undo is impossible. If the
  transaction throws, leave the undo stack as-is and toast the error.
- **State drift**: an undo that would re-INSERT a row whose primary
  key is now taken by something else throws. Caught + toast'd; the
  closure is consumed regardless (no point retrying).
- **Window close / app reload during HMR**: the in-memory stack
  disappears. Acceptable — dev convenience, no spec impact.

### Non-goals

- **Multi-document undo** — CarbonInk is single-database. The whole
  org is one logical document.
- **Selective undo** ("undo just step 3") — Mac apps don't do this.
- **Time-travel UI** showing the stack — see deferred doc; not
  shipping.
- **Undo across migrations** — `data:import-backup` and `data:reset`
  clear the stack (their inverses are not closure-friendly anyway).
- **Background-mutation undo** — auto-classify, cron jobs, MCP
  external writes don't push undo entries. Only user-initiated UI
  mutations do.

## Implementation outline

(Full plan deferred to a separate `docs/plans/` file. Sketch only.)

1. `UndoManager` class in `src/main/services/undo-manager.ts` —
   typed push/pop/peek with a tagged-union closure entry per scope
   item.
2. Wrap each undoable handler in `src/main/ipc/handlers/*.ts` with a
   helper that captures the pre-state, calls the original handler,
   and pushes the inverse on success. The wrapping is opt-in per
   handler — no global middleware — so a new write channel doesn't
   accidentally become undoable.
3. Two new IPC channels: `undo:peek` (read) and `undo:do`
   (write — gated by `READ_ONLY_BLOCKED_CHANNELS`).
4. Electron menu wiring in `src/main/window.ts` (or a new
   `src/main/menu.ts`) — both platforms, conditional accelerators.
5. `useUndo` hook in `src/renderer/hooks/use-undo.ts` exposing
   `{ canUndo, canRedo, undo(), redo() }`. Mutations that should
   surface a "已删除 · 撤销" toast call it from their `onSuccess`.
6. Sonner toast component in `src/renderer/components/undo-toast.tsx`
   or inline in each destructive handler — tbd at plan time.
7. Tests: unit per inverse, integration for confirm/discard pairing,
   E2E for the keyboard accelerator + toast button.

Estimated work: 1–2 weeks, matching the deferred doc.

## Open questions for the plan

- **Stack depth cap**: macOS NSUndoManager defaults to "unlimited" but
  most apps clamp to ~100. Pick at plan time.
- **Cross-window undo**: not relevant today (single window) but the
  abstraction shouldn't paint into a corner. Probably fine — closures
  reference IDs, not React state.
- **Test seam for `now()`**: the inverse of an `update` snaps
  `updated_at` back to its old value. Audit reasoning gets weird if
  someone reads the resulting row's `updated_at` and assumes it's
  truthful. Document the rule: post-undo `updated_at` reflects the
  state *being restored to*, not when the undo ran.
