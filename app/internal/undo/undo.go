// Package undo keeps the session's in-memory undo and redo stacks. Each entry
// carries its own inverse closure, so the manager stays independent of the
// domain packages and never serializes row data.
package undo

import "context"

// Action is one reversible mutation. Undo reverses the change; Redo applies it
// again. Kind is a stable identifier for status text and tests.
type Action struct {
	Kind string
	Undo func(context.Context) error
	Redo func(context.Context) error
}

// Manager is a bounded, in-memory history. The zero value is ready to use.
type Manager struct {
	undo []Action
	redo []Action
	max  int
}

// New returns a manager capped at max entries (100 when max is not positive).
func New(max int) *Manager {
	if max <= 0 {
		max = 100
	}
	return &Manager{max: max}
}

// Push records an action and clears the redo branch, as editing after undo
// starts a new history.
func (m *Manager) Push(action Action) {
	if action.Undo == nil || action.Redo == nil {
		return
	}
	m.ensure()
	m.undo = append(m.undo, action)
	if len(m.undo) > m.max {
		m.undo = append([]Action(nil), m.undo[len(m.undo)-m.max:]...)
	}
	m.redo = nil
}

// Undo reverses the newest action and moves it to the redo stack. The entry is
// consumed even when its closure fails, so a stale inverse cannot be retried
// forever.
func (m *Manager) Undo(ctx context.Context) (string, error) {
	m.ensure()
	if len(m.undo) == 0 {
		return "", nil
	}
	action := m.undo[len(m.undo)-1]
	m.undo = m.undo[:len(m.undo)-1]
	if err := action.Undo(ctx); err != nil {
		return action.Kind, err
	}
	m.redo = append(m.redo, action)
	return action.Kind, nil
}

// Redo reapplies the newest undone action.
func (m *Manager) Redo(ctx context.Context) (string, error) {
	m.ensure()
	if len(m.redo) == 0 {
		return "", nil
	}
	action := m.redo[len(m.redo)-1]
	m.redo = m.redo[:len(m.redo)-1]
	if err := action.Redo(ctx); err != nil {
		return action.Kind, err
	}
	m.undo = append(m.undo, action)
	return action.Kind, nil
}

// Peek reports the newest undo and redo kinds without changing either stack.
func (m *Manager) Peek() (undoKind, redoKind string) {
	m.ensure()
	if len(m.undo) > 0 {
		undoKind = m.undo[len(m.undo)-1].Kind
	}
	if len(m.redo) > 0 {
		redoKind = m.redo[len(m.redo)-1].Kind
	}
	return undoKind, redoKind
}

// Clear forgets both stacks.
func (m *Manager) Clear() {
	if m == nil {
		return
	}
	m.undo = nil
	m.redo = nil
}

func (m *Manager) ensure() {
	if m.max <= 0 {
		m.max = 100
	}
}
