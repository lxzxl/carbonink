package app

import (
	"context"
	"strings"

	"app.carbonink.desktop/internal/routing"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

// amapKeyCard stores the AMap web-service key used by "look up distance" on
// freight and travel rows. The key lives in the workspace settings table, not
// the keychain, matching 1.x: it is a low-risk public service credential.
func (s *Session) amapKeyCard(cx *core.Scope) core.Node {
	ctx := context.Background()
	stored, err := routing.StoredKey(ctx, s.db)
	key := core.NewSignal(cx, stored)
	status := core.NewSignal(cx, "")
	failed := core.NewSignal(cx, false)
	if err != nil {
		status.Set(err.Error())
		failed.Set(true)
	}

	save := func() {
		if err := routing.SaveKey(ctx, s.db, key.Get()); err != nil {
			failed.Set(true)
			status.Set(locales.SettingsSaveFailed(cx) + ": " + err.Error())
			return
		}
		key.Set(strings.TrimSpace(key.Get()))
		failed.Set(false)
		status.Set(locales.SettingsAmapSaved(cx))
	}

	return settingsCard(cx, lucide.MapPin,
		locales.SettingsAmapHeading, locales.SettingsAmapBody,
		core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignEnd,
			Wrap: core.Wrap, Gap: 8}, Children: []core.Node{
			core.View{Style: core.Style{FlexGrow: 1, MinWidth: core.Pt(200), Gap: 4}, Children: []core.Node{
				core.Text{ContentFunc: func() string { return locales.SettingsAmapLabel(cx) },
					Style: core.Style{FontSize: typeBody, FontWeight: ui.Medium}},
				namedNode(ui.Input{Value: key.Get, OnChange: key.Set,
					Placeholder: locales.SettingsAmapPlaceholder(cx),
					TestID:      "settings-amap-key"},
					func() string { return locales.SettingsAmapLabel(cx) }),
			}},
			ui.Button{Text: locales.SettingsSave(cx),
				OnPress: save, TestID: "settings-amap-save"},
		}},
		core.Show{When: func() bool { return status.Get() != "" },
			Then: func(cx *core.Scope) core.Node {
				return core.Text{ContentFunc: func() string { return status.Get() },
					Style: core.Style{FontSize: typeCaption}, StyleFunc: func() core.Style {
						if failed.Get() {
							return ui.Colored(ui.ColorsOf(cx).Danger)()
						}
						return ui.Colored(ui.ColorsOf(cx).Muted)()
					}}
			}},
	)
}
