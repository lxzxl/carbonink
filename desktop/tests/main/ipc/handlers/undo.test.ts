import type { IpcContext } from '@main/ipc/context';
import { undoHandlers } from '@main/ipc/handlers/undo';
import { UndoManager } from '@main/services/undo-manager';
import { beforeEach, describe, expect, it } from 'vitest';

function ctxWithManager(manager: UndoManager): IpcContext {
  // Test stub: undoHandlers only touches ctx.undoManager. Cast through
  // unknown so we don't have to construct the whole service graph.
  return { undoManager: manager } as unknown as IpcContext;
}

describe('undoHandlers', () => {
  let manager: UndoManager;
  let handlers: ReturnType<typeof undoHandlers>;

  beforeEach(() => {
    manager = new UndoManager();
    handlers = undoHandlers(ctxWithManager(manager));
  });

  // biome-ignore lint/style/noNonNullAssertion: handler factory returns Partial
  const peek = () => handlers['undo:peek']!();
  // biome-ignore lint/style/noNonNullAssertion: handler factory returns Partial
  const doIt = (direction: 'undo' | 'redo') => handlers['undo:do']!({ direction });

  it('undo:peek returns null/null on an empty manager', () => {
    expect(peek()).toEqual({ undo_kind: null, redo_kind: null });
  });

  it('undo:peek reports the top kinds', () => {
    let undone = false;
    manager.push({
      kind: 'activity:delete',
      undo: () => {
        undone = true;
      },
      redo: () => {},
      label: 'delete activity',
    });
    expect(peek()).toEqual({
      undo_kind: 'activity:delete',
      redo_kind: null,
    });
    expect(undone).toBe(false);
  });

  it('undo:do direction=undo runs the inverse and reports the kind', () => {
    let undone = false;
    manager.push({
      kind: 'activity:delete',
      undo: () => {
        undone = true;
      },
      redo: () => {},
      label: 'delete activity',
    });
    const result = doIt('undo');
    expect(result).toEqual({ kind: 'activity:delete' });
    expect(undone).toBe(true);
    expect(peek()).toEqual({
      undo_kind: null,
      redo_kind: 'activity:delete',
    });
  });

  it('undo:do direction=redo runs the redo half', () => {
    let redone = false;
    manager.push({
      kind: 'activity:create',
      undo: () => {},
      redo: () => {
        redone = true;
      },
      label: 'create activity',
    });
    doIt('undo');
    expect(redone).toBe(false);
    const result = doIt('redo');
    expect(result).toEqual({ kind: 'activity:create' });
    expect(redone).toBe(true);
  });

  it('undo:do on an empty stack throws (handler propagates)', () => {
    expect(() => doIt('undo')).toThrow(/empty/);
  });

  it('undo:do rejects invalid direction via zod', () => {
    expect(() =>
      // biome-ignore lint/style/noNonNullAssertion: testing rejection path
      handlers['undo:do']!({ direction: 'sideways' as never }),
    ).toThrow();
  });
});
