import type { UndoEntry, UndoKind, UndoManager } from '@main/services/undo-manager.js';

/**
 * Wrap an IPC handler so a successful call pushes an inverse closure
 * onto the undo manager. See spec
 * `docs/specs/2026-05-25-undo-redo-design.md`.
 *
 * Three-step lifecycle:
 *   1. `capture(input)` runs **before** the original handler. Return
 *      whatever state the inverse will need (snapshot of an existing
 *      row, original id, etc.). Return `null` to skip recording an
 *      undo entry for this call — useful for short-circuit paths
 *      (e.g. cache hit, no-op).
 *   2. The wrapped handler runs.
 *   3. `produce(captured, result, input)` returns `{undo, redo}`
 *      closures. The wrapper builds an `UndoEntry` and pushes it.
 *
 * If `capture` throws, the original handler still runs (undo is a
 * luxury — never block real work because the snapshot read failed).
 * The inverse just doesn't get recorded.
 *
 * If the wrapped handler throws, we never push the inverse. There's
 * nothing to undo because the side effect didn't happen.
 *
 * Sync only. better-sqlite3 transactions are synchronous and so are
 * all our IPC mutation handlers today; the wrapper enforces that at
 * the type level by typing handler as `Input → Output` (no Promise).
 * If an async undoable handler ever appears, lift this to an async
 * variant rather than making this signature universal — the menu's
 * `undo:do` is sync today and inverses need to fit that.
 */
export function withUndo<Input, Output, Captured>(
  manager: UndoManager,
  kind: UndoKind,
  label: string,
  capture: (input: Input) => Captured | null,
  produce: (
    captured: Captured,
    result: Output,
    input: Input,
  ) => { undo: () => void; redo: () => void },
  handler: (input: Input) => Output,
): (input: Input) => Output {
  return (input) => {
    let captured: Captured | null = null;
    try {
      captured = capture(input);
    } catch (err) {
      // Best-effort: a failed capture means no undo record. Log and
      // proceed with the original handler.
      console.warn(`[undo] capture failed for ${kind}:`, err);
    }
    const result = handler(input);
    if (captured !== null) {
      const { undo, redo } = produce(captured, result, input);
      const entry: UndoEntry = { kind, undo, redo, label };
      manager.push(entry);
    }
    return result;
  };
}
