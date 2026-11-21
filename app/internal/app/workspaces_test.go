package app

import (
	"testing"
	"time"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

// TestWorkspacesManageClientDatabases proves Settings can create, rename,
// remove and switch client workspaces against the real registry. The data
// directory is nsgotest's temp one; legacy import is disabled so the test
// never reads the developer's Electron install.
func TestWorkspacesManageClientDatabases(t *testing.T) {
	t.Setenv("CARBONINK_NO_LEGACY_IMPORT", "1")
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:settings")
	ui.WaitFor("id:workspace-create-input", 5*time.Second)
	ui.WaitFor("id:workspace-row-0", 2*time.Second)
	ui.WaitFor("id:workspace-row-0 >> text:默认账套", 2*time.Second)

	// The only workspace is active, so it cannot be switched to or removed.
	if ui.Enabled("id:workspace-switch-0") {
		t.Error("Switch is enabled for the active workspace")
	}
	if ui.Enabled("id:workspace-delete-0") {
		t.Error("Delete is enabled for the active workspace")
	}

	// An empty name is rejected with the dedicated message.
	ui.Press("id:workspace-create-button")
	ui.WaitFor("text:Name must be 1–60 characters", 2*time.Second)

	ui.Type("id:workspace-create-input", "Client B")
	ui.Press("id:workspace-create-button")
	ui.WaitFor("id:workspace-row-1", 2*time.Second)
	ui.WaitFor("id:workspace-row-1 >> text:Client B", 2*time.Second)
	ui.WaitFor("text:Workspace created", 2*time.Second)

	// Creating never switches, so the new workspace offers Switch/Delete.
	if !ui.Enabled("id:workspace-switch-1") || !ui.Enabled("id:workspace-delete-1") {
		t.Error("Switch/Delete are disabled for a non-active workspace")
	}

	// Rename changes the label only; the row keeps its position.
	ui.Press("id:workspace-rename-1")
	ui.WaitFor("id:workspace-rename-dialog", 2*time.Second)
	ui.Clear("id:workspace-rename-input")
	ui.Type("id:workspace-rename-input", "Client C")
	ui.Press("id:workspace-rename-save")
	ui.WaitFor("id:workspace-row-1 >> text:Client C", 2*time.Second)
	ui.WaitForGone("id:workspace-rename-dialog", 2*time.Second)

	// Removing a non-active workspace archives it and drops the row.
	ui.Press("id:workspace-delete-1")
	ui.WaitFor("id:workspace-delete-dialog", 2*time.Second)
	ui.Press("id:workspace-delete-confirm")
	ui.WaitForGone("id:workspace-row-1", 2*time.Second)
	ui.WaitFor("text:database file archived", 2*time.Second)

	// Switching marks the new workspace active and restarts the app.
	ui.Type("id:workspace-create-input", "Client D")
	ui.Press("id:workspace-create-button")
	ui.WaitFor("id:workspace-row-1 >> text:Client D", 2*time.Second)
	ui.Press("id:workspace-switch-1")
	ui.WaitFor("id:workspace-switch-dialog", 2*time.Second)
	ui.Press("id:workspace-switch-confirm")
	if ui.Restarts != 1 {
		t.Fatalf("restarts = %d, want 1", ui.Restarts)
	}
	ui.WaitForGone("id:workspace-switch-dialog", 2*time.Second)
}
