# Undo / Redo — shipped

Implements `docs/specs/2026-05-25-undo-redo-design.md`. Session-scoped,
NSUndoManager-style undo stack covering the mutations users most often
take back in anger.

## Coverage

| Mutation | Inverse | Wrapped commit |
|---|---|---|
| `activity:create` | DELETE the row by returned id (full snapshot redo) | `2f167c7` |
| `source:create` | soft-delete (`is_active = 0`) | `2f167c7` |
| `source:update` | restore captured pre-update row | `2f167c7` |
| `source:delete` | flip `is_active` back to 1 | `2f167c7` |
| `extraction:confirm` | status `parsed` → `review_needed` | `bca6670` |
| `extraction:discard` | status `rejected` → `review_needed` + restore `parsed_json` | `bca6670` |

Not wrapped this round (and why):

- `activity:rebind-ef` — async (Promise); current `withUndo` is sync-only.
- `answer:finalize` / `answer:unfinalize` — async (Effect-based). Users
  still have the explicit "撤销定稿" button.

## Triggers

- **Keyboard:** ⌘Z / ⇧⌘Z on macOS, Ctrl+Z / Ctrl+Y on Windows/Linux
  (Electron Edit menu, wired in `2c4c2ef`).
- **Toast action:** the existing "Extraction discarded" sonner toast in
  ExtractionReview gains a `[撤销]` action button (commit `844b1c2`).
  Other destructive flows will adopt the same pattern as their UI
  lands.

## Architecture summary

- `UndoManager` (`src/main/services/undo-manager.ts`) — pure in-memory
  stack, tagged-union entries, max depth 100, FIFO eviction.
- `withUndo` (`src/main/ipc/undo-wrapper.ts`) — opt-in decorator wrapping
  IPC handlers. Captures pre-state, calls the handler, pushes the
  inverse closure on success. Failed captures = no record (best-effort);
  failed handlers = nothing pushed.
- IPC: `undo:peek` (read) + `undo:do` (write). `undo:do` is in
  `READ_ONLY_BLOCKED_CHANNELS` so expired/revoked licenses can't sneak
  writes back in via the inverse path.
- Renderer: `useUndo` hook (`src/renderer/lib/use-undo.ts`) mounted at
  `__root` subscribes to `menu:undo` / `menu:redo` push events and
  drives a TanStack mutation. Coarse `queryClient.invalidateQueries()`
  on success — per spec, undo is rare enough that the precision of a
  per-key map isn't worth the code.

## Edge cases handled

- **State drift:** undo of `extraction:confirm`/`discard` checks the row
  is still in the expected post-mutation state before flipping back. If
  something else has touched it, bail silently rather than corrupt.
- **FK references:** undoing an activity `create` may fail if a
  questionnaire answer has since referenced it. The pre-existing
  `activity-data delete()` guard (commit `ca3f7eb`) surfaces a friendly
  message; the toast in the renderer surfaces that.
- **License gate:** undo is itself a write, so blocked under
  `expired`/`revoked`. The stack persists across the state transition
  so a renewed license resumes where the user left off.

## Test coverage

- 9 UndoManager unit tests covering stack semantics + cap eviction.
- 6 undo:peek / undo:do handler tests covering the IPC surface.
- 1 round-trip test per wrapped service (activity-data, emission-source,
  extraction) anchoring the inverse SQL.

Suite count after this round: 694 vitest tests passing (was 678 before
Task 1).

## Limitations / next round

- No async-undo support — see notes above for `rebind-ef` and answer
  finalize.
- Renderer surfaces undo via keyboard or the one ExtractionReview
  toast. Activity-delete / source-delete UI doesn't exist yet; when it
  lands, attach the same toast pattern.
- No "undo grouping" — each handler call pushes one entry. A batch
  preset-add (`source:add-from-presets`) currently pushes nothing
  (intentionally unwrapped; would need an async/multi-entry variant).
- Audit log doesn't distinguish undo-induced state changes from
  direct user actions. Per spec rationale, that's a v2 concern.
