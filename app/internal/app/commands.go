package app

import (
	"bytes"
	"encoding/csv"
	"strconv"
	"strings"
	"time"

	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/base"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/desktop"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

// commandDialog lists the screens and the places the app keeps its files.
// Cmd+K (Ctrl+K on Windows and Linux) opens it.
func (s *Session) commandDialog(cx *core.Scope, open *core.Signal[bool], nav *screenNav) core.Node {
	items := func() []base.CommandItem {
		out := make([]base.CommandItem, 0, len(screens)+6)
		for _, sc := range screens {
			out = append(out, base.CommandItem{
				ID: "go:" + string(sc.ID), Label: sc.Title(cx),
				Group: locales.CommandGoTo(cx), Icon: sc.Icon(),
				Keywords: []string{string(sc.ID)},
			})
		}
		out = append(out,
			base.CommandItem{ID: "new-activity", Label: locales.ActivitiesAddButton(cx),
				Group: locales.CommandActions(cx), Icon: lucide.Plus()},
			base.CommandItem{ID: "import-activities", Label: locales.ActivityImportButton(cx),
				Group: locales.CommandActions(cx), Icon: lucide.Upload()},
			base.CommandItem{ID: "export-activities", Label: locales.CommandExportActivities(cx),
				Group: locales.CommandActions(cx), Icon: lucide.Download()},
			base.CommandItem{ID: "add-source", Label: locales.SourcesCatalogButton(cx),
				Group: locales.CommandActions(cx), Icon: lucide.Plus()},
		)
		return append(out,
			base.CommandItem{ID: "reveal-data", Label: locales.CommandRevealData(cx),
				Group: locales.CommandFiles(cx), Icon: lucide.FolderOpen()},
			base.CommandItem{ID: "reveal-db", Label: locales.CommandRevealWorkspace(cx),
				Group: locales.CommandFiles(cx), Icon: lucide.Database()},
		)
	}

	hint := func(cx *core.Scope) core.Node {
		return core.View{
			Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter, Gap: 8,
				Padding: core.Symmetric(8, 16), Borders: core.Edges{Top: 1}},
			StyleFunc: func() core.Style {
				return core.Style{BorderColor: ui.ColorsOf(cx).Line()}
			},
			Children: []core.Node{
				core.Text{ContentFunc: func() string { return locales.CommandHints(cx) },
					Style:     core.Style{FontSize: 11},
					StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
			},
		}
	}

	return ui.Dialog{
		TestID: "command-palette",
		Open:   open.Get,
		OnOpenChange: func(o bool, _ base.Reason) {
			open.Set(o)
		},
		Bare:  true,
		Style: core.Style{Width: core.Pt(640)},
		Children: []core.Node{core.Dynamic(func(cx *core.Scope) core.Node {
			height := core.Points(440)
			if room := cx.Env().Window().Height - 40 - 38; room < height {
				height = max(220, room)
			}
			return core.View{Style: core.Style{Gap: 0}, Children: []core.Node{
				ui.Command{
					Items:       items,
					Placeholder: locales.CommandSearch(cx),
					SearchLabel: locales.CommandSearch(cx),
					Label:       locales.CommandSearch(cx),
					AutoFocus:   true,
					TestID:      "command-palette-list",
					Style: core.Style{FlexGrow: 1, FlexShrink: 1, MinHeight: core.Pt(0),
						Height: core.Pt(height)},
					OnCancel: func() { open.Set(false) },
					OnSelect: func(id string) {
						open.Set(false)
						switch {
						case strings.HasPrefix(id, "go:"):
							nav.Set(Screen(strings.TrimPrefix(id, "go:")))
						case id == "new-activity":
							s.pendingNewActivity = true
							nav.Set(ScreenActivities)
						case id == "import-activities":
							s.pendingImportActivities = true
							nav.Set(ScreenActivities)
						case id == "export-activities":
							s.exportActivitiesCSV(cx)
						case id == "add-source":
							s.pendingSourceCatalog = true
							nav.Set(ScreenSources)
						case id == "reveal-data":
							desktop.RevealFile(cx, cx.DataDir(), nil)
						case id == "reveal-db":
							desktop.RevealFile(cx, s.db.Path(), nil)
						}
					},
				},
				hint(cx),
			}}
		})},
	}
}

// exportActivitiesCSV writes the ledger with the column names the batch
// importer reads, so an export can come back in without remapping.
func (s *Session) exportActivitiesCSV(cx *core.Scope) {
	var buf bytes.Buffer
	writer := csv.NewWriter(&buf)
	_ = writer.Write([]string{"Source", "Description", "Amount", "Unit",
		"Start date", "End date", "Notes", "Emission factor", "kg CO2e"})
	for _, activity := range s.activities {
		// The importer requires a description and groups by it; the ledger has
		// no separate field, so the source name keeps rows grouped on re-import.
		_ = writer.Write([]string{
			activity.Source,
			activity.Source,
			strconv.FormatFloat(activity.Amount, 'f', -1, 64),
			activity.Unit,
			activity.OccurredAt,
			activity.OccurredAtEnd,
			activity.Notes,
			activity.EFFactorCode,
			strconv.FormatFloat(activity.CO2eKg, 'f', -1, 64),
		})
	}
	writer.Flush()
	if err := writer.Error(); err != nil {
		return
	}
	cx.SaveFile(core.SaveOptions{
		Name: "carbonink-activities-" + time.Now().Format("2006-01-02") + ".csv",
		MIME: "text/csv",
		Data: buf.Bytes(),
	}, func(bool, string, error) {})
}
