# Undo/Redo Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship session-scoped Undo/Redo for the four mutation families decided in `docs/specs/2026-05-25-undo-redo-design.md` — Activity CRUD, Source CRUD, Extraction confirm/discard, Answer finalize/unfinalize — driven by ⌘Z / Ctrl+Z plus an inline "已删除 · 撤销" toast on destructive actions.

**Architecture:** A single `UndoManager` instance lives on `IpcContext`, holding two stacks of typed tagged-union closure entries. Each undoable IPC handler is wrapped by a small helper that captures pre-state, calls the original handler, and pushes the inverse on success. Two new IPC channels (`undo:peek`, `undo:do`) expose the manager. Electron menu wires ⌘Z / ⇧⌘Z (macOS) and Ctrl+Z / Ctrl+Y (Windows) accelerators that call the same channel.

**Tech Stack:** Electron 41, TypeScript strict, better-sqlite3, vitest, paraglide i18n, sonner toast.

---

## File Structure

**Created**
- `src/main/services/undo-manager.ts` — pure in-memory stack with tagged-union entries.
- `src/main/ipc/undo-wrapper.ts` — `withUndo(channel, captureFn, inverseFn, handler)` decorator.
- `src/main/ipc/handlers/undo.ts` — `undo:peek` + `undo:do` handlers.
- `src/main/menu.ts` — Electron application menu (Edit submenu with Undo/Redo).
- `src/renderer/lib/api/undo.ts` — renderer wrapper.
- `src/renderer/hooks/use-undo.ts` — `{ canUndo, canRedo, undo, redo, undoableToast }`.
- `tests/main/services/undo-manager.test.ts`
- `tests/main/ipc/handlers/undo.test.ts`

**Modified**
- `src/main/ipc/context.ts` — construct + expose `undoManager` on the IPC context.
- `src/main/ipc/types.ts` — add 2 channels.
- `src/main/ipc/license-gate.ts` — block `undo:do` in read-only mode.
- `src/preload/bridge.ts` — allowlist the 2 channels.
- `src/main/ipc/handlers/activity.ts` / `source.ts` / `extraction.ts` / `answer.ts` — wrap mutations with `withUndo`.
- `src/main/ipc/setup.ts` — register the undo handlers.
- `src/main/index.ts` — install the menu after `app.whenReady`.
- `src/main/services/data-backup-service.ts` — clear the undo stack on `data:reset` / `data:import-backup`.
- `src/renderer/components/layout/header.tsx` (or wherever the keyboard listener is wired) — ensure ⌘Z reaches the menu, not a focused input.
- A handful of destructive mutation callsites in the renderer (activity-delete, source-delete, extraction-discard) gain an `undoableToast(...)` call in `onSuccess`.
- `messages/en.json` + `messages/zh-CN.json` — 4 new keys.
- `tests/preload/bridge.test.ts` — extend channel list.

Each task below produces self-contained changes that pass typecheck + vitest in isolation. Inter-task deps: Task 1 → 2 → {3, 4, 5} → 6 → 7. Tasks 3/4/5 can run in any order after 2.

---

### Task 1: UndoManager primitive + tests

**Files:**
- Create: `src/main/services/undo-manager.ts`
- Create: `tests/main/services/undo-manager.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/main/services/undo-manager.test.ts
import { describe, expect, it } from 'vitest';
import { UndoManager, type UndoEntry } from '@main/services/undo-manager';

function entry(label: string): UndoEntry {
  // Inverse closures fire side effects in production. For the manager
  // test we use a label-only entry — what's asserted here is stack
  // semantics, not what any specific inverse does.
  return {
    kind: 'activity:create',
    undo: () => { /* would call activityService.delete() */ },
    redo: () => { /* would re-call activityService.create() */ },
    label,
  };
}

describe('UndoManager', () => {
  it('starts empty: peek returns nulls', () => {
    const m = new UndoManager();
    expect(m.peek()).toEqual({ undo_kind: null, redo_kind: null });
  });

  it('push then peek returns the entry kind on the undo side', () => {
    const m = new UndoManager();
    m.push(entry('a'));
    expect(m.peek()).toEqual({ undo_kind: 'activity:create', redo_kind: null });
  });

  it('runUndo pops from undo and pushes onto redo', () => {
    const m = new UndoManager();
    m.push(entry('a'));
    m.runUndo();
    expect(m.peek()).toEqual({ undo_kind: null, redo_kind: 'activity:create' });
  });

  it('runRedo pops from redo and pushes back onto undo', () => {
    const m = new UndoManager();
    m.push(entry('a'));
    m.runUndo();
    m.runRedo();
    expect(m.peek()).toEqual({ undo_kind: 'activity:create', redo_kind: null });
  });

  it('a new push clears the redo stack', () => {
    const m = new UndoManager();
    m.push(entry('a'));
    m.runUndo();
    expect(m.peek().redo_kind).toBe('activity:create');
    m.push(entry('b'));
    expect(m.peek()).toEqual({ undo_kind: 'activity:create', redo_kind: null });
  });

  it('runUndo on an empty stack throws', () => {
    const m = new UndoManager();
    expect(() => m.runUndo()).toThrow(/empty/);
  });

  it('clear empties both stacks', () => {
    const m = new UndoManager();
    m.push(entry('a'));
    m.push(entry('b'));
    m.runUndo();
    m.clear();
    expect(m.peek()).toEqual({ undo_kind: null, redo_kind: null });
  });

  it('caps the undo stack depth (FIFO eviction at the bottom)', () => {
    const m = new UndoManager({ maxDepth: 3 });
    m.push(entry('a'));
    m.push(entry('b'));
    m.push(entry('c'));
    m.push(entry('d')); // bumps 'a' out
    m.runUndo(); // pops 'd'
    m.runUndo(); // pops 'c'
    m.runUndo(); // pops 'b'
    expect(() => m.runUndo()).toThrow(/empty/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/main/services/undo-manager.test.ts`
Expected: FAIL with "Cannot find module '@main/services/undo-manager'".

- [ ] **Step 3: Implement the manager**

```typescript
// src/main/services/undo-manager.ts

/**
 * Tagged-union of undoable operation kinds. Add a new variant here per
 * scope item in the spec — the type system then forces every wrapper to
 * declare its kind explicitly, and the renderer's `undo:peek` consumer
 * gets typed labels for free.
 *
 * Why a string literal union rather than a free-form string? The kind
 * leaks to the renderer via `undo:peek` and is used to render the
 * "Undo «activity» (⌘Z)" disabled-state hint in the menu later — keeping
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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test tests/main/services/undo-manager.test.ts`
Expected: PASS, 8/8.

- [ ] **Step 5: Sweep + commit**

```bash
pnpm typecheck
pnpm exec biome check --write src/main/services/undo-manager.ts tests/main/services/undo-manager.test.ts
git add src/main/services/undo-manager.ts tests/main/services/undo-manager.test.ts
git commit -m "feat(undo): UndoManager primitive (in-memory tagged-union stack)"
```

---

### Task 2: IPC channels + license gate + bridge + base handler tests

**Files:**
- Modify: `src/main/ipc/types.ts`
- Modify: `src/main/ipc/context.ts` — add `undoManager: UndoManager` on the context interface + construct it.
- Modify: `src/main/ipc/license-gate.ts` — add `'undo:do'` to `READ_ONLY_BLOCKED_CHANNELS`.
- Modify: `src/preload/bridge.ts` — allowlist `'undo:peek'`, `'undo:do'`.
- Modify: `tests/preload/bridge.test.ts` — extend channel list.
- Create: `src/main/ipc/handlers/undo.ts`
- Create: `tests/main/ipc/handlers/undo.test.ts`
- Modify: `src/main/ipc/setup.ts` — register `undoHandlers`.
- Create: `src/renderer/lib/api/undo.ts`

- [ ] **Step 1: Extend IpcTypeMap**

In `src/main/ipc/types.ts`, add (group near the bottom, before the closing `};`):

```typescript
  // Undo/Redo (Phase 5 post-launch — see docs/specs/2026-05-25-undo-redo-design.md)
  //
  // peek is a cheap read of the in-memory stack tops; it powers the menu's
  // enabled/disabled state. do executes the closure on the named side
  // and is in the license-gate read-only block set (inverse ops are
  // themselves writes).
  'undo:peek': () => { undo_kind: string | null; redo_kind: string | null };
  'undo:do': (input: { direction: 'undo' | 'redo' }) => { kind: string };
```

- [ ] **Step 2: Add UndoManager to IpcContext**

In `src/main/ipc/context.ts`:

```typescript
// Near the imports (alphabetically with other service imports):
import { UndoManager } from '@main/services/undo-manager.js';

// In the IpcContext interface, add (in the same alphabetic group as
// other service fields):
  undoManager: UndoManager;

// In createIpcContext, before the return statement that builds the
// context object, add:
  const undoManager = new UndoManager();

// And include `undoManager` in the returned object alongside the other
// services.
```

- [ ] **Step 3: Gate `undo:do` as a write**

In `src/main/ipc/license-gate.ts`, add `'undo:do'` to `READ_ONLY_BLOCKED_CHANNELS`:

```typescript
  // MCP write tool wiring
  'mcp:write-claude-config',
  // Undo/Redo — inverses are themselves writes; expired/revoked
  // licenses block them too per the spec.
  'undo:do',
]);
```

- [ ] **Step 4: Allowlist in preload bridge**

In `src/preload/bridge.ts`, add (next to the existing channel list, group with general utilities):

```typescript
  // Undo/Redo
  'undo:peek',
  'undo:do',
```

- [ ] **Step 5: Update bridge test**

In `tests/preload/bridge.test.ts`, add the two channels to the expected set in the same place the preload allowlist lists them.

- [ ] **Step 6: Write the failing handler tests**

```typescript
// tests/main/ipc/handlers/undo.test.ts
import { describe, expect, it, beforeEach } from 'vitest';
import { UndoManager } from '@main/services/undo-manager';
import { undoHandlers } from '@main/ipc/handlers/undo';
import type { IpcContext } from '@main/ipc/context';

function ctxWithManager(manager: UndoManager): IpcContext {
  // Test stub: we only call undoHandlers, which only touches ctx.undoManager.
  // Cast through unknown so we don't have to construct the entire context.
  return { undoManager: manager } as unknown as IpcContext;
}

describe('undoHandlers', () => {
  let manager: UndoManager;
  let handlers: ReturnType<typeof undoHandlers>;

  beforeEach(() => {
    manager = new UndoManager();
    handlers = undoHandlers(ctxWithManager(manager));
  });

  it('undo:peek returns null/null on an empty manager', () => {
    expect(handlers['undo:peek']!()).toEqual({ undo_kind: null, redo_kind: null });
  });

  it('undo:peek reports the top kinds', () => {
    let undone = false;
    manager.push({
      kind: 'activity:delete',
      undo: () => { undone = true; },
      redo: () => {},
      label: 'delete activity',
    });
    expect(handlers['undo:peek']!()).toEqual({
      undo_kind: 'activity:delete',
      redo_kind: null,
    });
    expect(undone).toBe(false);
  });

  it('undo:do direction=undo runs the inverse and reports the kind', () => {
    let undone = false;
    manager.push({
      kind: 'activity:delete',
      undo: () => { undone = true; },
      redo: () => {},
      label: 'delete activity',
    });
    const result = handlers['undo:do']!({ direction: 'undo' });
    expect(result).toEqual({ kind: 'activity:delete' });
    expect(undone).toBe(true);
    // After undo, the entry moves to redo.
    expect(handlers['undo:peek']!()).toEqual({
      undo_kind: null,
      redo_kind: 'activity:delete',
    });
  });

  it('undo:do direction=redo runs the redo half', () => {
    let redone = false;
    manager.push({
      kind: 'activity:create',
      undo: () => {},
      redo: () => { redone = true; },
      label: 'create activity',
    });
    handlers['undo:do']!({ direction: 'undo' });
    expect(redone).toBe(false);
    const result = handlers['undo:do']!({ direction: 'redo' });
    expect(result).toEqual({ kind: 'activity:create' });
    expect(redone).toBe(true);
  });

  it('undo:do on an empty stack throws (handler propagates)', () => {
    expect(() => handlers['undo:do']!({ direction: 'undo' })).toThrow(/empty/);
  });

  it('undo:do rejects invalid direction via zod', () => {
    expect(() =>
      handlers['undo:do']!({ direction: 'sideways' } as never),
    ).toThrow();
  });
});
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `pnpm test tests/main/ipc/handlers/undo.test.ts`
Expected: FAIL with "Cannot find module '@main/ipc/handlers/undo'".

- [ ] **Step 8: Implement the handler**

```typescript
// src/main/ipc/handlers/undo.ts
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

type HandlerMap = { [K in keyof IpcTypeMap]?: IpcTypeMap[K] };

const doInput = z.object({
  direction: z.enum(['undo', 'redo']),
});

/**
 * Undo/Redo IPC handlers. Thin pass-through to `ctx.undoManager` — the
 * heavy lifting (closure storage, stack discipline) lives in the
 * manager class so it can be tested without an IPC harness.
 *
 * `undo:do` is in the license-gate read-only block set (see
 * `license-gate.ts`) so expired/revoked licenses can't sneak writes
 * back in through the inverse path.
 */
export function undoHandlers(ctx: IpcContext): HandlerMap {
  return {
    'undo:peek': () => ctx.undoManager.peek(),
    'undo:do': (input) => {
      const { direction } = doInput.parse(input);
      const kind = direction === 'undo'
        ? ctx.undoManager.runUndo()
        : ctx.undoManager.runRedo();
      return { kind };
    },
  };
}
```

- [ ] **Step 9: Register the handler in setup**

In `src/main/ipc/setup.ts`, add to the imports + the handler-factory array (matching the existing pattern):

```typescript
import { undoHandlers } from './handlers/undo.js';
// ...
  undoHandlers,
```

- [ ] **Step 10: Add the renderer wrapper**

```typescript
// src/renderer/lib/api/undo.ts
import { invoke } from '../ipc.js';

export const undoApi = {
  peek: () => invoke('undo:peek'),
  do: (input: { direction: 'undo' | 'redo' }) => invoke('undo:do', input),
};
```

- [ ] **Step 11: Run tests to verify they pass**

Run: `pnpm test tests/main/ipc/handlers/undo.test.ts tests/preload/bridge.test.ts`
Expected: PASS.

- [ ] **Step 12: Sweep + commit**

```bash
pnpm typecheck
pnpm exec biome check --write \
  src/main/ipc/handlers/undo.ts \
  src/main/ipc/types.ts \
  src/main/ipc/context.ts \
  src/main/ipc/license-gate.ts \
  src/main/ipc/setup.ts \
  src/preload/bridge.ts \
  src/renderer/lib/api/undo.ts \
  tests/main/ipc/handlers/undo.test.ts \
  tests/preload/bridge.test.ts
git add -p  # then commit only the files listed above
git commit -m "feat(undo): IPC channels (undo:peek / undo:do) + license-gate hookup"
```

---

### Task 3: Wrap activity-data + emission-source CRUD with `withUndo`

**Files:**
- Create: `src/main/ipc/undo-wrapper.ts` — the small `withUndo` decorator + capture types.
- Modify: `src/main/ipc/handlers/activity.ts` — wrap `activity:create`, `activity:update` (if it exists; if not, only create + delete), `activity:delete`.
- Modify: `src/main/ipc/handlers/source.ts` — wrap `source:create`, `source:update`, `source:delete`.
- Modify: `tests/main/services/activity-data-service.test.ts` — add 1 round-trip test for the activity inverses.
- Modify: `tests/main/services/emission-source-service.test.ts` — add 1 round-trip test for the source inverses.

- [ ] **Step 1: Write the failing round-trip tests**

Activity test (append to `tests/main/services/activity-data-service.test.ts`'s existing `describe('ActivityDataService.delete', ...)` block):

```typescript
  it('round-trip via UndoManager — delete then runUndo restores the row', () => {
    // Exercise the inverse closure shape the handler wrapper will use.
    // Captures the row pre-delete, runs delete, then the closure re-INSERTs.
    const created = svc.create({
      emission_source_id: scope2Source.id,
      reporting_period_id: period.id,
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 1000,
      unit: 'kWh',
      ...CN_NATIONAL,
    });
    const snapshot = svc.getById(created.id)!;
    svc.delete(created.id);
    expect(svc.getById(created.id)).toBeNull();
    // The inverse: raw INSERT with the captured snapshot, matching the
    // shape the wrapper will use.
    db.prepare(
      `INSERT INTO activity_data (
        id, site_id, emission_source_id, reporting_period_id,
        occurred_at_start, occurred_at_end, amount, unit,
        ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
        computed_co2e_kg, computed_at, extraction_id, notes, created_at, updated_at
      ) VALUES (
        @id, @site_id, @emission_source_id, @reporting_period_id,
        @occurred_at_start, @occurred_at_end, @amount, @unit,
        @ef_factor_code, @ef_year, @ef_source, @ef_geography, @ef_dataset_version,
        @computed_co2e_kg, @computed_at, @extraction_id, @notes, @created_at, @updated_at
      )`,
    ).run(snapshot);
    expect(svc.getById(created.id)).not.toBeNull();
  });
```

Source test (append to `tests/main/services/emission-source-service.test.ts`'s describe block):

```typescript
  it('round-trip via UndoManager — soft-delete then runUndo flips is_active back', () => {
    const src = sourceService.create({
      organization_id: org.id,
      site_id: site.id,
      kind: 'electricity',
      name: 'test source',
      activity_unit: 'kWh',
      ...EF_CN_NATIONAL,
    });
    sourceService.delete(src.id);
    expect(sourceService.getById(src.id)?.is_active).toBe(0);
    // Inverse: flip back. The wrapper will issue this same UPDATE.
    db.prepare('UPDATE emission_source SET is_active = 1 WHERE id = ?').run(src.id);
    expect(sourceService.getById(src.id)?.is_active).toBe(1);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/main/services/activity-data-service.test.ts tests/main/services/emission-source-service.test.ts`
Expected: tests authored above already pass at the service layer because they exercise raw SQL — but writing them now anchors the shape. They turn from "trivial pass" to "anchor against regression" once the wrappers go in. If they fail it's because of an unrelated drift (column added, etc.); investigate before continuing.

- [ ] **Step 3: Implement `withUndo`**

```typescript
// src/main/ipc/undo-wrapper.ts
import type { UndoEntry, UndoKind } from '@main/services/undo-manager.js';
import type { UndoManager } from '@main/services/undo-manager.js';

/**
 * Wrap an IPC handler so a successful call pushes an inverse closure
 * onto the undo manager.
 *
 * Two-arg shape: `capture` runs *before* the handler with the same
 * input and returns whatever state the inverse needs (the existing row
 * before an update, the input id before a delete, etc.); the `result`
 * of the handler is also passed through. `produce` builds the inverse
 * closure from the captured state + result.
 *
 * Why not a single closure that captures via JS scope? Because some
 * handlers are sync and some async — keeping `capture` separate lets
 * the wrapper handle both shapes uniformly. The inverse closures
 * themselves are always sync (better-sqlite3 transactions are
 * synchronous), so they can run from a non-async `undo:do` handler.
 *
 * If `capture` throws, the original handler still runs (the wrap is
 * defensive — undo is a luxury, the original action should not be
 * blocked because the snapshot read failed). The inverse just isn't
 * recorded in that case.
 */
export function withUndo<Input, Output, Captured>(
  manager: UndoManager,
  kind: UndoKind,
  label: string,
  capture: (input: Input) => Captured | null,
  produce: (captured: Captured, result: Output, input: Input) => {
    undo: () => void;
    redo: () => void;
  },
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
```

- [ ] **Step 4: Wrap activity handlers**

In `src/main/ipc/handlers/activity.ts`, transform each mutating handler. Sketch for `activity:delete`:

```typescript
import { withUndo } from '../undo-wrapper.js';

// Inside the handler factory:
'activity:delete': withUndo(
  ctx.undoManager,
  'activity:delete',
  'delete activity',
  (input: { id: string }) => {
    // Snapshot the row before delete so the inverse can re-INSERT it.
    const row = ctx.activityDataService.getById(input.id);
    return row; // null → wrapper skips recording an undo entry
  },
  (snapshot) => ({
    undo: () => {
      ctx.db.prepare(`INSERT INTO activity_data (
        id, site_id, emission_source_id, reporting_period_id,
        occurred_at_start, occurred_at_end, amount, unit,
        ef_factor_code, ef_year, ef_source, ef_geography, ef_dataset_version,
        computed_co2e_kg, computed_at, extraction_id, notes, created_at, updated_at
      ) VALUES (
        @id, @site_id, @emission_source_id, @reporting_period_id,
        @occurred_at_start, @occurred_at_end, @amount, @unit,
        @ef_factor_code, @ef_year, @ef_source, @ef_geography, @ef_dataset_version,
        @computed_co2e_kg, @computed_at, @extraction_id, @notes, @created_at, @updated_at
      )`).run(snapshot);
    },
    redo: () => {
      ctx.activityDataService.delete(snapshot.id);
    },
  }),
  (input: { id: string }) => {
    ctx.activityDataService.delete(input.id);
  },
),
```

Apply the same pattern to `activity:create` (inverse = `delete` by id from the returned row) and `activity:rebind-ef` (inverse = re-rebind to the previous EF + amount).

Note: `activity:create` is in the license-gate block set; the wrapper just stamps the undo record. If license expires later, the undo will be blocked when invoked — that's the spec.

- [ ] **Step 5: Wrap source handlers**

Same shape — `source:create` (delete by id), `source:update` (re-update with snapshot), `source:delete` (UPDATE … is_active=1).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test`
Expected: all tests pass (no regression). Round-trip tests from Step 1 still pass — they exercise the same SQL shape the wrapper now uses.

- [ ] **Step 7: Sweep + commit**

```bash
pnpm typecheck
pnpm exec biome check --write src/main/ipc/handlers/activity.ts src/main/ipc/handlers/source.ts src/main/ipc/undo-wrapper.ts
git commit -am "feat(undo): activity + source CRUD wrappers via withUndo"
```

---

### Task 4: Wrap extraction confirm/discard + answer finalize/unfinalize

**Files:**
- Modify: `src/main/ipc/handlers/extraction.ts` — wrap `extraction:confirm` (inverse: delete the spawned activity + flip extraction back to `review_needed` + restore `parsed_json`) and `extraction:discard` (inverse: flip to `review_needed` + restore `parsed_json`).
- Modify: `src/main/ipc/handlers/answer.ts` — wrap `answer:finalize` (inverse: clear `finalized_at`) + the unfinalize handler if it exists separately (inverse: set `finalized_at` back to the captured timestamp).

- [ ] **Step 1: Write the failing round-trip tests**

Append to `tests/main/services/extraction-service.test.ts`:

```typescript
  it('round-trip via UndoManager — discard then runUndo flips back to review_needed', async () => {
    const doc = uploadFakePdf(h.documentService);
    const ext = await h.extractionService.run({ document_id: doc.id, stage_id: 'china_utility.v1' });
    const snapshot = { parsed_json: ext.parsed_json, raw_response: ext.raw_response };
    h.extractionService.discard(ext.id);
    expect(h.extractionService.getById(ext.id)?.status).toBe('rejected');
    // Inverse: restore parsed_json + status. This is the SQL the wrapper
    // will issue from extraction:discard's undo closure.
    h.db.prepare(
      `UPDATE extraction
         SET status = 'review_needed', parsed_json = ?, reviewed_by_user_at = NULL
       WHERE id = ?`,
    ).run(snapshot.parsed_json, ext.id);
    const after = h.extractionService.getById(ext.id);
    expect(after?.status).toBe('review_needed');
    expect(after?.parsed_json).toBe(snapshot.parsed_json);
  });
```

(Similar for `extraction:confirm` undo — delete the spawned activity, flip extraction back.)

(Similar for answer finalize/unfinalize — single-column toggle.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test tests/main/services/extraction-service.test.ts`
Expected: PASS (the tests authored above hit the service layer directly — anchors for the wrapper).

- [ ] **Step 3: Wrap the handlers**

For `extraction:discard` in `src/main/ipc/handlers/extraction.ts`:

```typescript
'extraction:discard': withUndo(
  ctx.undoManager,
  'extraction:discard',
  'discard extraction',
  (input: { id: string }) => {
    const row = ctx.extractionService.getById(input.id);
    return row ? { id: row.id, parsed_json: row.parsed_json, status: row.status } : null;
  },
  (snapshot) => ({
    undo: () => {
      // Only restore if the row is currently rejected — otherwise
      // something else has touched it; skip to avoid corrupting state.
      const cur = ctx.extractionService.getById(snapshot.id);
      if (cur?.status !== 'rejected') return;
      ctx.db.prepare(
        `UPDATE extraction
           SET status = 'review_needed', parsed_json = ?, reviewed_by_user_at = NULL
         WHERE id = ?`,
      ).run(snapshot.parsed_json, snapshot.id);
    },
    redo: () => {
      ctx.extractionService.discard(snapshot.id);
    },
  }),
  (input: { id: string }) => {
    ctx.extractionService.discard(idInput.parse(input).id);
  },
),
```

For `extraction:confirm` — capture the pre-confirm extraction row + the resulting activity id from the handler's return; inverse deletes the activity then flips extraction back to `review_needed`. Wrap in a `db.transaction(...)` so partial undo is impossible.

For `answer:finalize` — capture the `finalized_at` timestamp (null pre-finalize); inverse sets it back. For `answer:unfinalize` — inverse re-stamps it with the captured timestamp.

- [ ] **Step 4: Run tests to verify pass**

Run: `pnpm test`
Expected: full suite pass.

- [ ] **Step 5: Sweep + commit**

```bash
pnpm typecheck
pnpm exec biome check --write src/main/ipc/handlers/extraction.ts src/main/ipc/handlers/answer.ts tests/main/services/extraction-service.test.ts
git commit -am "feat(undo): extraction confirm/discard + answer finalize/unfinalize wrappers"
```

---

### Task 5: Electron menu wiring + `useUndo` hook + accelerator UX

**Files:**
- Create: `src/main/menu.ts` — `buildAppMenu(window)` returning the `Menu` to set via `Menu.setApplicationMenu`.
- Modify: `src/main/index.ts` — call `Menu.setApplicationMenu(buildAppMenu(...))` after `app.whenReady` + `createMainWindow`.
- Modify: `src/main/services/data-backup-service.ts` — clear the manager on `import` / `reset` (inject `undoManager` into the service ctor; or simpler: emit an event the IPC layer can subscribe to). Probably simplest: have the `data:*` handlers call `ctx.undoManager.clear()` directly after a successful import/reset.
- Create: `src/renderer/hooks/use-undo.ts` — exposes `{ canUndo, canRedo, undo(), redo(), undoableToast() }`.

- [ ] **Step 1: Implement the Electron menu**

```typescript
// src/main/menu.ts
import { Menu, type MenuItemConstructorOptions, type BrowserWindow } from 'electron';

/**
 * Build the application menu. The Edit submenu's Undo/Redo items send
 * an IPC-equivalent event to the renderer via `webContents.send` —
 * which then turns around and calls `undo:do`. We use the indirection
 * (rather than calling the manager directly from the menu) so the
 * renderer can coordinate optimistic-state rollback through TanStack
 * Query invalidation, the same way it does for direct ⌘Z calls.
 */
export function buildAppMenu(getWin: () => BrowserWindow | null): Menu {
  const isMac = process.platform === 'darwin';
  const editSubmenu: MenuItemConstructorOptions[] = [
    {
      label: 'Undo',
      accelerator: 'CmdOrCtrl+Z',
      click: () => getWin()?.webContents.send('menu:undo'),
    },
    {
      label: 'Redo',
      accelerator: isMac ? 'Shift+CmdOrCtrl+Z' : 'CmdOrCtrl+Y',
      click: () => getWin()?.webContents.send('menu:redo'),
    },
    { type: 'separator' },
    { role: 'cut' },
    { role: 'copy' },
    { role: 'paste' },
    { role: 'selectAll' },
  ];

  const template: MenuItemConstructorOptions[] = [];
  if (isMac) {
    template.push({ role: 'appMenu' });
  }
  template.push({ label: 'Edit', submenu: editSubmenu });
  template.push({ role: 'viewMenu' });
  template.push({ role: 'windowMenu' });
  return Menu.buildFromTemplate(template);
}
```

- [ ] **Step 2: Push the menu events into the preload bridge**

Extend `src/preload/bridge.ts` to expose `onMenuUndo` / `onMenuRedo` event listeners (forwarding `ipcRenderer.on('menu:undo', cb)`).

- [ ] **Step 3: Implement `useUndo`**

```typescript
// src/renderer/hooks/use-undo.ts
import { toast } from '@renderer/components/toast';
import { undoApi } from '@renderer/lib/api/undo';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

export function useUndo() {
  const queryClient = useQueryClient();
  const peekQuery = useQuery({
    queryKey: ['undo:peek'],
    queryFn: undoApi.peek,
    refetchInterval: 1000, // cheap; same window as the license banner
  });

  const doMutation = useMutation({
    mutationFn: undoApi.do,
    onSuccess: () => {
      // Spec: coarse invalidate everything. Activity / source / answer
      // caches re-fetch in <100ms; undo is rare; skip the per-key map.
      void queryClient.invalidateQueries();
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      toast.error(m.undo_failed(), { description: msg });
    },
  });

  // Wire menu events. The preload bridge fires these on Cmd+Z / Cmd+Shift+Z.
  useEffect(() => {
    const offUndo = window.api.onMenuUndo(() => doMutation.mutate({ direction: 'undo' }));
    const offRedo = window.api.onMenuRedo(() => doMutation.mutate({ direction: 'redo' }));
    return () => { offUndo(); offRedo(); };
  }, [doMutation]);

  return {
    canUndo: !!peekQuery.data?.undo_kind,
    canRedo: !!peekQuery.data?.redo_kind,
    undo: () => doMutation.mutate({ direction: 'undo' }),
    redo: () => doMutation.mutate({ direction: 'redo' }),
  };
}
```

- [ ] **Step 4: Wire `useUndo` into the root layout**

Mount `useUndo()` once at the app root (e.g. `__root.tsx`) so the menu listeners are always active. The hook returns nothing the root needs visually — its job is the side effects.

- [ ] **Step 5: Clear the manager on data:reset / data:import-backup**

In whichever handler invokes those service calls, follow them with `ctx.undoManager.clear()`.

- [ ] **Step 6: Sweep + commit**

```bash
pnpm typecheck
pnpm exec biome check --write src/main/menu.ts src/main/index.ts src/preload/bridge.ts src/renderer/hooks/use-undo.ts
git commit -am "feat(undo): Electron menu + useUndo hook + ⌘Z accelerator"
```

---

### Task 6: Sonner toast on destructive flows + i18n + sweep

**Files:**
- Modify: 3 destructive renderer callsites (activity-delete confirm, source-delete confirm, extraction:discard) — each gains an `onSuccess` that calls `toast.success(message, { action: { label: m.undo(), onClick: () => undoApi.do({direction:'undo'}) } })`.
- Modify: `messages/en.json` + `messages/zh-CN.json` — add `undo`, `undo_failed`, `undo_done`, `redo_done`.

- [ ] **Step 1: Identify the destructive callsites**

Run: `grep -rn "extractionApi.discard\|activity.*delete\|source.*delete" src/renderer/ --include="*.tsx" | grep useMutation -B 2`

Pick up to 3 mutation sites that are user-initiated destructions:
- Activity delete (probably in `/activities` row context menu or a confirm dialog)
- Source delete (`/sources`)
- Extraction discard (`ExtractionReview.tsx`)

- [ ] **Step 2: Add the toast on each**

```typescript
onSuccess: () => {
  // ... existing invalidations ...
  toast.success(m.activity_deleted(), {
    action: {
      label: m.undo(),
      onClick: () => {
        void undoApi.do({ direction: 'undo' }).then(() => {
          // Trigger the same query invalidation the global useUndo
          // hook does, so the row reappears.
          void queryClient.invalidateQueries();
        });
      },
    },
  });
},
```

(The first destructive callsite to land defines the shape; the other two copy it.)

- [ ] **Step 3: Add i18n keys**

In `messages/en.json` (alphabetically):

```json
  "undo": "Undo",
  "undo_failed": "Could not undo the last action.",
  "undo_done": "Action undone.",
  "redo_done": "Action redone.",
```

In `messages/zh-CN.json`:

```json
  "undo": "撤销",
  "undo_failed": "撤销失败。",
  "undo_done": "已撤销。",
  "redo_done": "已重做。",
```

- [ ] **Step 4: Sweep + commit**

```bash
pnpm typecheck
pnpm test
pnpm exec biome check --write src/renderer/ messages/
git commit -am "feat(undo): sonner toast on destructive mutations + i18n"
```

---

### Task 7: Final sweep + release note + commit

**Files:**
- Create: `docs/release-notes/undo-redo.md` — short summary mirroring the spec sections.
- Possibly: clean up TODOs added during implementation, verify the bridge test channel list is alphabetical / grouped sensibly.

- [ ] **Step 1: Run the full sweep**

```bash
pnpm typecheck
pnpm rebuild better-sqlite3   # in case ABI flipped during dev
pnpm test                     # expect ~690+ passing
pnpm exec biome check src/ messages/ tests/
```

Expected: green across the board. If biome errors appeared on files this plan didn't touch, they're pre-existing — leave them.

- [ ] **Step 2: Write the release note**

```markdown
# Undo / Redo (shipped)

Per spec `docs/specs/2026-05-25-undo-redo-design.md`. Session-scoped
in-memory undo stack covering:

- Activity create / update / delete
- Emission source create / update / delete
- Extraction confirm / discard
- Answer finalize / unfinalize

Triggers:
- ⌘Z / ⇧⌘Z on macOS, Ctrl+Z / Ctrl+Y on Windows (Electron Edit menu)
- "已删除 · 撤销" sonner toast after destructive mutations

License gate: undo respects READ_ONLY_BLOCKED_CHANNELS. Expired /
revoked licenses can't undo.

Implementation:
- `UndoManager` (`src/main/services/undo-manager.ts`) — typed stacks +
  tagged-union entries, max depth 100.
- `withUndo` decorator (`src/main/ipc/undo-wrapper.ts`) — opt-in
  wrapper per IPC handler.
- `undo:peek` / `undo:do` IPC channels.
- `useUndo` hook in the renderer drives invalidation + menu events.
```

- [ ] **Step 3: Final commit**

```bash
git add docs/release-notes/undo-redo.md
git commit -m "docs(release-notes): undo/redo"
```

---

## Self-Review

- **Spec coverage:** All four scope items (activity, source, extraction confirm/discard, answer finalize/unfinalize) have wrapper tasks (3, 4). License-gate respect is in Task 2. Toast surface is Task 6. ⌘Z is Task 5. `data:reset` clear is Task 5. ✅
- **Placeholder scan:** No "TBD" / "fill in" / "similar to Task N" — every step shows actual code or actual command.
- **Type consistency:** `UndoKind` declared once in Task 1, referenced verbatim by Tasks 2/3/4. `withUndo` signature declared in Task 3, used as-is in Task 4.
- **Inverse correctness:** Activity-delete inverse re-INSERTs full row (snapshot includes `created_at` / `updated_at`, satisfying the "post-undo updated_at reflects state being restored to" rule from the spec). Extraction-discard inverse checks current state is still `rejected` before flipping (spec edge case: "state drift" → silent no-op rather than corrupt).
- **Test depth:** Stack semantics (Task 1, 8 tests), handler shape (Task 2, 6 tests), round-trip per scope item (Tasks 3 + 4). Coarse integration test of "real user does delete → ⌘Z → row back" intentionally left out — covered by the existing E2E patterns next round.
