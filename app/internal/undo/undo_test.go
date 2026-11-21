package undo

import (
	"context"
	"errors"
	"testing"
)

func TestUndoRedoAndBranching(t *testing.T) {
	ctx := context.Background()
	m := New(2)
	value := 0
	push := func(kind string, delta int) {
		m.Push(Action{
			Kind: kind,
			Undo: func(context.Context) error { value -= delta; return nil },
			Redo: func(context.Context) error { value += delta; return nil },
		})
	}
	push("one", 1)
	value = 1
	push("two", 2)
	value = 3

	if kind, err := m.Undo(ctx); err != nil || kind != "two" || value != 1 {
		t.Fatalf("undo = %q, %v, value=%d", kind, err, value)
	}
	if undoKind, redoKind := m.Peek(); undoKind != "one" || redoKind != "two" {
		t.Fatalf("peek = %q/%q", undoKind, redoKind)
	}
	if kind, err := m.Redo(ctx); err != nil || kind != "two" || value != 3 {
		t.Fatalf("redo = %q, %v, value=%d", kind, err, value)
	}
	if kind, err := m.Undo(ctx); err != nil || kind != "two" || value != 1 {
		t.Fatalf("second undo = %q, %v, value=%d", kind, err, value)
	}
	push("three", 3)
	value = 4
	if _, redoKind := m.Peek(); redoKind != "" {
		t.Fatalf("push kept redo %q", redoKind)
	}
}

func TestUndoConsumesFailedEntry(t *testing.T) {
	ctx := context.Background()
	m := New(10)
	m.Push(Action{
		Kind: "fails",
		Undo: func(context.Context) error { return errors.New("stale") },
		Redo: func(context.Context) error { return nil },
	})
	if kind, err := m.Undo(ctx); err == nil || kind != "fails" {
		t.Fatalf("undo = %q, %v", kind, err)
	}
	if undoKind, redoKind := m.Peek(); undoKind != "" || redoKind != "" {
		t.Fatalf("failed undo stayed: %q/%q", undoKind, redoKind)
	}
}

func TestStackCap(t *testing.T) {
	m := New(2)
	for _, kind := range []string{"one", "two", "three"} {
		kind := kind
		m.Push(Action{
			Kind: kind,
			Undo: func(context.Context) error { return nil },
			Redo: func(context.Context) error { return nil },
		})
	}
	seen := []string{}
	ctx := context.Background()
	for {
		kind, err := m.Undo(ctx)
		if err != nil || kind == "" {
			break
		}
		seen = append(seen, kind)
	}
	if len(seen) != 2 || seen[0] != "three" || seen[1] != "two" {
		t.Fatalf("seen = %v", seen)
	}
}
