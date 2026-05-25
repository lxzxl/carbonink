/**
 * Tagged-union of undoable operation kinds. Add a new variant here per
 * scope item in the spec — the type system then forces every wrapper to
 * declare its kind explicitly, and the renderer's `undo:peek` consumer
 * gets typed labels for free.
 *
 * Why a string literal union rather than a free-form string? The kind
 * leaks to the renderer via `undo:peek` and is used (later) to render
 * the "Undo «activity» (⌘Z)" disabled-state hint in the menu — keeping
 * it closed-set guarantees the i18n catalog has a label for every
 * possible value.
 */
export type UndoKind =
  | 'activity:create'
  | 'activity:update'
  | 'activity:delete'
  | 'source:create'
  | 'source:update'
  | 'source:delete'
  | 'extraction:confirm'
  | 'extraction:discard'
  | 'answer:finalize'
  | 'answer:unfinalize';

/**
 * One element of the undo or redo stack. Production code captures the
 * pre-state inside the closures; this module only knows that both `undo`
 * and `redo` are zero-arg functions it can invoke in either direction.
 */
export interface UndoEntry {
  kind: UndoKind;
  undo: () => void;
  redo: () => void;
  /**
   * Short human-readable description for logs + (later) the menu's
   * "Undo «label»" suffix. Not exposed via `undo:peek` for now — the
   * renderer uses `kind` and looks up the i18n catalog itself.
   */
  label: string;
}

export interface UndoManagerOptions {
  /**
   * Maximum entries kept on the undo stack. New pushes past this
   * threshold evict from the bottom (oldest entries). NSUndoManager
   * defaults to unlimited; we clamp at 100 to keep the closures
   * (which capture pre-state rows) from accumulating unbounded memory
   * over multi-hour sessions.
   */
  maxDepth?: number;
}

const DEFAULT_MAX_DEPTH = 100;

/**
 * In-memory NSUndoManager-style stack. Per the design spec, this is
 * session-scoped only — the app boots with an empty manager, and the
 * stacks are dropped on `data:reset` / `data:import-backup` (their
 * closures would point at gone state).
 */
export class UndoManager {
  private readonly undos: UndoEntry[] = [];
  private readonly redos: UndoEntry[] = [];
  private readonly maxDepth: number;

  constructor(opts: UndoManagerOptions = {}) {
    this.maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH;
  }

  /**
   * Record a new operation. **Clears the redo stack** — once the user
   * has done something new, the redo branch is no longer reachable
   * (matches NSUndoManager + every text editor's undo semantics).
   */
  push(entry: UndoEntry): void {
    this.undos.push(entry);
    if (this.undos.length > this.maxDepth) {
      this.undos.shift(); // FIFO evict oldest
    }
    // Splice instead of assign so anyone holding a ref to the redo
    // array (shouldn't happen, but defensive) doesn't keep stale data.
    this.redos.length = 0;
  }

  peek(): { undo_kind: UndoKind | null; redo_kind: UndoKind | null } {
    return {
      undo_kind: this.undos[this.undos.length - 1]?.kind ?? null,
      redo_kind: this.redos[this.redos.length - 1]?.kind ?? null,
    };
  }

  /**
   * Pop the top of the undo stack, run its inverse, and push the
   * symmetric entry onto the redo stack. If the inverse throws, the
   * entry stays consumed — there's no way to retry a failed undo
   * because the side effect we'd need to re-attempt may have partially
   * applied. The caller (handler) surfaces the throw as a toast.
   */
  runUndo(): UndoKind {
    const entry = this.undos.pop();
    if (!entry) throw new Error('undo stack is empty');
    entry.undo();
    this.redos.push(entry);
    return entry.kind;
  }

  runRedo(): UndoKind {
    const entry = this.redos.pop();
    if (!entry) throw new Error('redo stack is empty');
    entry.redo();
    this.undos.push(entry);
    return entry.kind;
  }

  /**
   * Drop both stacks. Called by data:reset / data:import-backup
   * because their closures would point at gone state.
   */
  clear(): void {
    this.undos.length = 0;
    this.redos.length = 0;
  }
}
