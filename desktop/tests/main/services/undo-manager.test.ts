import { type UndoEntry, UndoManager } from '@main/services/undo-manager';
import { describe, expect, it } from 'vitest';

function entry(label: string): UndoEntry {
  // Inverse closures fire side effects in production. For the manager
  // test we use a label-only entry — what's asserted here is stack
  // semantics, not what any specific inverse does.
  return {
    kind: 'activity:create',
    undo: () => {
      /* would call activityService.delete() */
    },
    redo: () => {
      /* would re-call activityService.create() */
    },
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
    let undone = false;
    m.push({
      kind: 'activity:delete',
      undo: () => {
        undone = true;
      },
      redo: () => {},
      label: 'd',
    });
    const kind = m.runUndo();
    expect(kind).toBe('activity:delete');
    expect(undone).toBe(true);
    expect(m.peek()).toEqual({ undo_kind: null, redo_kind: 'activity:delete' });
  });

  it('runRedo pops from redo and pushes back onto undo', () => {
    const m = new UndoManager();
    let redone = false;
    m.push({
      kind: 'activity:create',
      undo: () => {},
      redo: () => {
        redone = true;
      },
      label: 'c',
    });
    m.runUndo();
    const kind = m.runRedo();
    expect(kind).toBe('activity:create');
    expect(redone).toBe(true);
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

  it('runRedo on an empty stack throws', () => {
    const m = new UndoManager();
    expect(() => m.runRedo()).toThrow(/empty/);
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
