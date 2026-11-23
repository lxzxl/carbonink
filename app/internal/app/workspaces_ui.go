package app

import (
	"errors"
	"strconv"

	"app.carbonink.desktop/internal/workspace"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/desktop"
	"github.com/nsgo-dev/nsgo/ui"
)

// workspacesCard manages the registry of client databases. Creating,
// renaming and removing never touches the open workspace; switching marks the
// new one active and restarts into it.
func (s *Session) workspacesCard(cx *core.Scope) core.Node {
	if s.workspaces == nil {
		return core.View{}
	}
	rev := core.NewSignal(cx, 0)
	status := core.NewSignal(cx, "")
	failed := core.NewSignal(cx, false)
	createName := core.NewSignal(cx, "")
	createBusy := core.NewSignal(cx, false)

	renameOpen := core.NewSignal(cx, false)
	renameID := core.NewSignal(cx, "")
	renameName := core.NewSignal(cx, "")
	renameStatus := core.NewSignal(cx, "")
	renameBusy := core.NewSignal(cx, false)

	switchOpen := core.NewSignal(cx, false)
	switchID := core.NewSignal(cx, "")
	switchName := core.NewSignal(cx, "")

	deleteOpen := core.NewSignal(cx, false)
	deleteID := core.NewSignal(cx, "")
	deleteName := core.NewSignal(cx, "")
	deleteStatus := core.NewSignal(cx, "")
	deleteBusy := core.NewSignal(cx, false)

	reload := func() { rev.Set(rev.Get() + 1) }
	report := func(message string, isFailure bool) {
		status.Set(message)
		failed.Set(isFailure)
	}

	create := func() {
		createBusy.Set(true)
		_, err := s.workspaces.Create(createName.Get())
		createBusy.Set(false)
		switch {
		case errors.Is(err, workspace.ErrInvalidName):
			report(locales.WorkspaceInvalidName(cx), true)
		case err != nil:
			report(err.Error(), true)
		default:
			createName.Set("")
			report(locales.WorkspaceCreatedToast(cx), false)
			reload()
		}
	}
	rename := func() {
		renameBusy.Set(true)
		err := s.workspaces.Rename(renameID.Get(), renameName.Get())
		renameBusy.Set(false)
		if errors.Is(err, workspace.ErrInvalidName) {
			renameStatus.Set(locales.WorkspaceInvalidName(cx))
			return
		}
		if err != nil {
			renameStatus.Set(err.Error())
			return
		}
		renameOpen.Set(false)
		report("", false)
		reload()
	}
	remove := func() {
		deleteBusy.Set(true)
		_, err := s.workspaces.Remove(deleteID.Get())
		deleteBusy.Set(false)
		switch {
		case errors.Is(err, workspace.ErrActiveWorkspace),
			errors.Is(err, workspace.ErrLastWorkspace):
			deleteStatus.Set(locales.WorkspaceDeleteFailed(cx))
			return
		case err != nil:
			deleteStatus.Set(err.Error())
			return
		}
		deleteOpen.Set(false)
		report(locales.WorkspaceDeletedToast(cx), false)
		reload()
	}
	openRename := func(w workspace.Workspace) {
		renameID.Set(w.ID)
		renameName.Set(w.Name)
		renameStatus.Set("")
		renameOpen.Set(true)
	}
	openSwitch := func(w workspace.Workspace) {
		switchID.Set(w.ID)
		switchName.Set(w.Name)
		switchOpen.Set(true)
	}
	openDelete := func(w workspace.Workspace) {
		deleteID.Set(w.ID)
		deleteName.Set(w.Name)
		deleteStatus.Set("")
		deleteOpen.Set(true)
	}

	list := core.Dynamic(func(cx *core.Scope) core.Node {
		_ = rev.Get()
		reg, err := s.workspaces.Load()
		if err != nil {
			return core.Text{Content: err.Error(), Style: core.Style{FontSize: 12},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Danger)}
		}
		rows := make([]core.Node, 0, len(reg.Workspaces))
		for i, w := range reg.Workspaces {
			w := w
			// List test ids stay stable across renames: rows are keyed by
			// position, not by the user-editable name.
			index := strconv.Itoa(i)
			active := w.ID == reg.ActiveID
			badge := []core.Node{}
			if active {
				badge = append(badge, ui.Badge{Text: locales.WorkspaceActiveBadge(cx), Variant: ui.BadgeAccent})
			}
			buttons := []core.Node{
				ui.Button{Text: locales.WorkspaceRenameButton(cx), Variant: ui.ButtonGhost, Size: ui.SizeSmall,
					OnPress: func() { openRename(w) }, TestID: "workspace-rename-" + index},
				ui.Button{Text: locales.WorkspaceSwitchButton(cx), Variant: ui.ButtonGhost, Size: ui.SizeSmall,
					Disabled: func() bool { return active }, OnPress: func() { openSwitch(w) },
					TestID: "workspace-switch-" + index},
				ui.Button{Text: locales.WorkspaceDeleteButton(cx), Variant: ui.ButtonGhost, Size: ui.SizeSmall,
					Disabled: func() bool { return active || len(reg.Workspaces) <= 1 },
					OnPress:  func() { openDelete(w) }, TestID: "workspace-delete-" + index},
			}
			created := w.CreatedAt
			if len(created) >= 10 {
				created = created[:10]
			}
			rows = append(rows, core.View{
				TestID: "workspace-row-" + index,
				StyleFunc: func() core.Style {
					style := core.Style{Gap: 6, Padding: core.Symmetric(8, 0),
						Borders: core.Edges{Bottom: 1}, BorderColor: ui.ColorsOf(cx).Line()}
					if cx.Env().Window().Width >= 900 {
						style.Direction = core.Row
						style.AlignItems = core.AlignCenter
						style.Gap = 8
					}
					return style
				},
				Children: []core.Node{
					core.View{Style: core.Style{FlexGrow: 1, Gap: 2}, Children: []core.Node{
						core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 6},
							Children: append([]core.Node{
								core.Text{Content: w.Name, Style: core.Style{FontSize: 13, FontWeight: ui.Medium}, MaxLines: 1},
							}, badge...)},
						core.Text{Content: locales.WorkspaceCreatedAt(cx, created), Style: core.Style{FontSize: 11},
							StyleFunc: ui.Colored(ui.ColorsOf(cx).Faint)},
					}},
					core.View{Style: core.Style{Direction: core.Row, Wrap: core.Wrap, Gap: 4}, Children: buttons},
				},
			})
		}
		return core.View{Style: core.Style{Gap: 0}, Children: rows}
	})

	return dataCard(cx,
		dataHeading(cx, locales.WorkspaceHeading(cx), locales.WorkspaceBody(cx)),
		list,
		dataHeaderRow(cx,
			dataField(cx, locales.WorkspaceCreateButton(cx),
				ui.Input{Value: createName.Get, OnChange: createName.Set,
					Placeholder: locales.WorkspaceCreatePlaceholder(cx), TestID: "workspace-create-input"}),
			ui.Button{Text: locales.WorkspaceCreateButton(cx), Busy: createBusy.Get, OnPress: create,
				TestID: "workspace-create-button"},
		),
		core.Show{When: func() bool { return status.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return status.Get() },
					Style: core.Style{FontSize: 11},
					StyleFunc: func() core.Style {
						if failed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
		dataDialog(cx, renameOpen, locales.WorkspaceRenameButton(cx), []core.Node{
			dataField(cx, locales.WorkspaceRenameButton(cx),
				ui.Input{Value: renameName.Get, OnChange: renameName.Set, TestID: "workspace-rename-input"}),
			dataError(cx, renameStatus),
		}, []core.Node{
			dataCancelButton(cx, renameOpen, "workspace-rename-cancel"),
			ui.Button{Text: locales.WorkspaceRenameSave(cx), Busy: renameBusy.Get, OnPress: rename,
				TestID: "workspace-rename-save"},
		}, "workspace-rename-dialog"),
		dataDialog(cx, switchOpen, locales.WorkspaceSwitchButton(cx), []core.Node{
			core.Text{ContentFunc: func() string {
				return locales.WorkspaceSwitchConfirm(cx, switchName.Get())
			}, Style: core.Style{FontSize: 13}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		}, []core.Node{
			dataCancelButton(cx, switchOpen, "workspace-switch-cancel"),
			ui.Button{Text: locales.WorkspaceSwitchButton(cx), OnPress: func() {
				if err := s.workspaces.SetActive(switchID.Get()); err != nil {
					report(locales.WorkspaceSwitchFailed(cx), true)
					return
				}
				switchOpen.Set(false)
				desktop.Restart(cx)
			}, TestID: "workspace-switch-confirm"},
		}, "workspace-switch-dialog"),
		dataDialog(cx, deleteOpen, locales.WorkspaceDeleteButton(cx), []core.Node{
			core.Text{ContentFunc: func() string {
				return locales.WorkspaceDeleteConfirm(cx, deleteName.Get())
			}, Style: core.Style{FontSize: 13}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			dataError(cx, deleteStatus),
		}, []core.Node{
			dataCancelButton(cx, deleteOpen, "workspace-delete-cancel"),
			ui.Button{Text: locales.WorkspaceDeleteButton(cx), Busy: deleteBusy.Get, OnPress: remove,
				TestID: "workspace-delete-confirm"},
		}, "workspace-delete-dialog"),
	)
}
