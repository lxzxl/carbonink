package app

import (
	"context"
	"encoding/base64"
	"os"

	"app.carbonink.desktop/internal/report"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/ui"
)

// maxLogoBytes mirrors the 1.x cap: the data URL stays well inside the
// setting table's comfort zone and the print payload stays light.
const maxLogoBytes = 512 << 10

// reportLogoCard edits the per-workspace logo printed on ISO and TCFD covers.
func (s *Session) reportLogoCard(cx *core.Scope) core.Node {
	logo := core.NewSignal[*[]byte](cx, s.logoBytes())
	status := core.NewSignal(cx, "")
	failed := core.NewSignal(cx, false)

	pick := func() {
		cx.PickFiles(core.PickFilesOptions{
			Types:  []string{".png", ".jpg", ".jpeg"},
			Title:  locales.SettingsReportLogoPick(cx),
			Button: locales.SettingsReportLogoPick(cx),
		}, func(files []core.File, err error) {
			if err != nil || len(files) == 0 {
				return
			}
			path := files[0].Path
			info, err := os.Stat(path)
			if err != nil {
				status.Set(locales.SettingsReportLogoInvalid(cx))
				failed.Set(true)
				return
			}
			if info.Size() > maxLogoBytes {
				status.Set(locales.SettingsReportLogoTooLarge(cx))
				failed.Set(true)
				return
			}
			data, err := os.ReadFile(path)
			if err != nil {
				status.Set(locales.SettingsReportLogoInvalid(cx))
				failed.Set(true)
				return
			}
			mime := logoMIME(data)
			if mime == "" {
				status.Set(locales.SettingsReportLogoInvalid(cx))
				failed.Set(true)
				return
			}
			url := "data:" + mime + ";base64," + base64.StdEncoding.EncodeToString(data)
			if err := s.db.SetSetting(context.Background(), report.LogoSetting, url); err != nil {
				status.Set(locales.SettingsReportLogoInvalid(cx))
				failed.Set(true)
				return
			}
			logo.Set(&data)
			status.Set(locales.SettingsReportLogoSaved(cx))
			failed.Set(false)
		})
	}
	clear := func() {
		if err := s.db.DeleteSetting(context.Background(), report.LogoSetting); err != nil {
			status.Set(locales.SettingsReportLogoInvalid(cx))
			failed.Set(true)
			return
		}
		logo.Set(nil)
		status.Set(locales.SettingsReportLogoCleared(cx))
		failed.Set(false)
	}

	preview := func(cx *core.Scope) core.Node {
		data := logo.Get()
		if data == nil {
			return ui.Button{Text: locales.SettingsReportLogoPick(cx), Variant: ui.ButtonSecondary,
				OnPress: pick, TestID: "settings-report-logo-pick"}
		}
		return ui.Button{Text: locales.SettingsReportLogoReplace(cx), Variant: ui.ButtonSecondary,
			OnPress: pick, TestID: "settings-report-logo-replace"}
	}

	return core.View{
		Style: core.Style{Padding: core.All(16), Gap: 10, CornerRadius: 10, BorderWidth: 1},
		StyleFunc: func() core.Style {
			return core.Style{Background: ui.ColorsOf(cx).Surface(), BorderColor: ui.ColorsOf(cx).Border()}
		},
		Children: []core.Node{
			core.Text{ContentFunc: func() string { return locales.SettingsReportLogoHeading(cx) },
				Style: core.Style{FontSize: 13, FontWeight: ui.Semibold}},
			core.Text{ContentFunc: func() string { return locales.SettingsReportLogoBody(cx) },
				Style: core.Style{FontSize: 12}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), MaxLines: 3},
			core.Dynamic(func(cx *core.Scope) core.Node {
				data := logo.Get()
				actions := core.View{Style: core.Style{Direction: core.Row, Gap: 8},
					Children: []core.Node{preview(cx)}}
				if data != nil {
					actions.Children = append([]core.Node{
						ui.Image{Source: core.ImageSource{Data: *data}, TestID: "settings-report-logo",
							ResizeMode: core.Contain,
							Style:      core.Style{Width: core.Pt(120), Height: core.Pt(48)}},
					}, actions.Children...)
					actions.Children = append(actions.Children,
						ui.Button{Text: locales.SettingsReportLogoClear(cx), Variant: ui.ButtonGhost,
							OnPress: clear, TestID: "settings-report-logo-clear"})
				}
				return actions
			}),
			core.Show{When: func() bool { return status.Get() != "" },
				Then: func(cx *core.Scope) core.Node {
					return core.Text{ContentFunc: func() string { return status.Get() },
						Style: core.Style{FontSize: 12},
						StyleFunc: func() core.Style {
							if failed.Get() {
								return ui.Colored(ui.ColorsOf(cx).Danger)()
							}
							return ui.Colored(ui.ColorsOf(cx).Muted)()
						}}
				}},
		},
	}
}

// logoBytes reads the workspace's current logo for the preview.
func (s *Session) logoBytes() *[]byte {
	data, _ := report.LoadLogo(context.Background(), s.db)
	if data == nil {
		return nil
	}
	return &data
}

// logoMIME accepts PNG and JPEG by their magic bytes, so a renamed text file
// cannot land in the setting table as a broken image.
func logoMIME(data []byte) string {
	switch {
	case len(data) >= 8 && string(data[:8]) == "\x89PNG\r\n\x1a\n":
		return "image/png"
	case len(data) >= 3 && data[0] == 0xff && data[1] == 0xd8 && data[2] == 0xff:
		return "image/jpeg"
	}
	return ""
}
