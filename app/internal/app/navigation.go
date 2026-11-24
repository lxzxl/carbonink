package app

import "github.com/nsgo-dev/nsgo/core"

// screenNav is the shell's destination history. 1.x's toolbar carried back
// and forward arrows over the router's history; the native shell keeps the
// same stack here so the arrows travel between screens the way they did.
//
// Set is the only way a screen changes: it truncates any forward entries
// first, so a new destination after going back replaces that branch. rev
// changes with the stack so the arrows' enabled state follows it.
type screenNav struct {
	active  *core.Signal[Screen]
	rev     *core.Signal[int]
	entries []Screen
	cursor  int
}

func newScreenNav(cx *core.Scope, start Screen) *screenNav {
	return &screenNav{
		active:  core.NewSignal(cx, start),
		rev:     core.NewSignal(cx, 0),
		entries: []Screen{start},
	}
}

// Get is the screen showing now.
func (n *screenNav) Get() Screen { return n.active.Get() }

// Set travels to id, adding it to the history.
func (n *screenNav) Set(id Screen) {
	if id == n.active.Get() {
		return
	}
	if n.cursor < len(n.entries)-1 {
		n.entries = n.entries[:n.cursor+1]
	}
	n.entries = append(n.entries, id)
	n.cursor = len(n.entries) - 1
	n.active.Set(id)
	n.bump()
}

// Back shows the entry before this one.
func (n *screenNav) Back() {
	if n.cursor == 0 {
		return
	}
	n.cursor--
	n.active.Set(n.entries[n.cursor])
	n.bump()
}

// Forward shows the entry back left behind.
func (n *screenNav) Forward() {
	if n.cursor >= len(n.entries)-1 {
		return
	}
	n.cursor++
	n.active.Set(n.entries[n.cursor])
	n.bump()
}

// CanBack and CanForward say whether an arrow has somewhere to go. Both read
// rev so a view that shows them re-renders when the stack moves.
func (n *screenNav) CanBack() bool {
	_ = n.rev.Get()
	return n.cursor > 0
}

func (n *screenNav) CanForward() bool {
	_ = n.rev.Get()
	return n.cursor < len(n.entries)-1
}

func (n *screenNav) bump() { n.rev.Set(n.rev.Get() + 1) }
