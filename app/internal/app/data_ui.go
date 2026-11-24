package app

import (
	"context"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"app.carbonink.desktop/internal/backup"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/desktop"
	"github.com/nsgo-dev/nsgo/icons/lucide"
	"github.com/nsgo-dev/nsgo/ui"
)

// dataCard is Settings → Data: backup export/import, the auto-backup gate,
// cache cleanup and the typed reset. Restore and reset close the database,
// replace or remove the active workspace file, and restart the app, so the
// next launch runs migrations and opens a clean (or restored) database.
func (s *Session) dataCard(cx *core.Scope) core.Node {
	ctx := context.Background()
	status := core.NewSignal(cx, "")
	failed := core.NewSignal(cx, false)
	importOpen := core.NewSignal(cx, false)
	importStatus := core.NewSignal(cx, "")
	importFailed := core.NewSignal(cx, false)
	resetText := core.NewSignal(cx, "")
	resetBusy := core.NewSignal(cx, false)
	stats := core.NewSignal[*store.CacheStats](cx, nil)
	autoOn := core.NewSignal(cx, autoBackupEnabled(ctx, s.db))

	report := func(message string, isFailure bool) {
		status.Set(message)
		failed.Set(isFailure)
	}
	refreshStats := func() {
		st, err := s.db.CacheStats(ctx)
		if err != nil {
			report(err.Error(), true)
			return
		}
		fileSt := s.llmCache.Stats()
		st.ExtractionRawCount += fileSt.Count
		st.ExtractionRawBytes += fileSt.Bytes
		stats.Set(&st)
	}
	refreshStats()

	export := func() {
		report("", false)
		dir, err := os.MkdirTemp("", "carbonink-backup-")
		if err != nil {
			report(locales.SettingsDataExportFailed(cx)+": "+err.Error(), true)
			return
		}
		dest := filepath.Join(dir, "backup.sqlite")
		if err := s.db.Backup(ctx, dest); err != nil {
			os.RemoveAll(dir)
			report(locales.SettingsDataExportFailed(cx)+": "+err.Error(), true)
			return
		}
		size := int64(0)
		if info, err := os.Stat(dest); err == nil {
			size = info.Size()
		}
		name := "carbonink-backup-" + time.Now().Format("2006-01-02") + ".carbonink-backup"
		cx.SaveFile(core.SaveOptions{Name: name, MIME: "application/vnd.sqlite3", Path: dest},
			func(saved bool, _ string, err error) {
				// The platform copies Path before this callback, so the
				// temporary snapshot is safe to remove here.
				os.RemoveAll(dir)
				switch {
				case err != nil:
					report(locales.SettingsDataExportFailed(cx)+": "+err.Error(), true)
				case !saved:
					// The user dismissed the save dialog; keep the card quiet.
				default:
					report(locales.SettingsDataExportSuccess(cx)+" · "+documentSize(size), false)
				}
			})
	}

	importBackup := func() {
		importOpen.Set(false)
		cx.PickFiles(core.PickFilesOptions{
			Title: locales.SettingsDataImportButton(cx),
			Types: []string{".carbonink-backup", ".sqlite", ".db", ".sqlite3"},
		}, func(files []core.File, err error) {
			if err != nil {
				importFailed.Set(true)
				importStatus.Set(locales.SettingsDataImportFailed(cx) + ": " + err.Error())
				return
			}
			if len(files) == 0 {
				return
			}
			source := files[0].Path
			if source == "" {
				importFailed.Set(true)
				importStatus.Set(locales.SettingsDataImportFailed(cx))
				return
			}
			if err := store.ValidateBackupFile(ctx, source); err != nil {
				importFailed.Set(true)
				importStatus.Set(locales.SettingsDataImportFailed(cx) + ": " + err.Error())
				return
			}
			importFailed.Set(false)
			importStatus.Set(locales.SettingsDataImportSuccess(cx))
			if err := s.replaceDatabase(cx, source); err != nil {
				importFailed.Set(true)
				importStatus.Set(locales.SettingsDataImportFailed(cx) + ": " + err.Error())
			}
		})
	}

	clearCache := func() {
		rows, freed, err := s.db.ClearExtractionRawCache(ctx)
		if err != nil {
			report(err.Error(), true)
			return
		}
		fileRows, fileFreed, fileErr := s.llmCache.Clear()
		if fileErr != nil {
			report(fileErr.Error(), true)
			return
		}
		refreshStats()
		report(locales.SettingsDataCacheClearSuccess(cx,
			strconv.FormatInt(rows+fileRows, 10), documentSize(freed+fileFreed)), false)
	}

	openBackups := func() {
		dir := filepath.Join(cx.DataDir(), backup.DirName)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			report(locales.SettingsDataAutoBackupOpenFailed(cx)+": "+err.Error(), true)
			return
		}
		desktop.RevealFile(cx, dir, nil)
	}

	setAutoBackup := func(on bool) {
		value := "false"
		if on {
			value = "true"
		}
		if err := s.db.SetSetting(ctx, autoBackupSettingKey, value); err != nil {
			report(locales.SettingsDataAutoBackupToggleFailed(cx)+": "+err.Error(), true)
			return
		}
		autoOn.Set(on)
	}

	reset := func() {
		if !resetArmed(resetText.Get()) {
			return
		}
		resetBusy.Set(true)
		if err := s.resetDatabase(cx); err != nil {
			resetBusy.Set(false)
			report(err.Error(), true)
		}
	}

	statLine := func() string {
		st := stats.Get()
		if st == nil {
			return ""
		}
		return locales.SettingsDataDbSize(cx) + ": " + documentSize(st.DBFileBytes)
	}
	cacheLine := func() string {
		st := stats.Get()
		if st == nil || st.ExtractionRawCount == 0 {
			return locales.SettingsDataCacheExtractionEmpty(cx)
		}
		return locales.SettingsDataCacheExtractionSummary(cx,
			strconv.FormatInt(st.ExtractionRawCount, 10), documentSize(st.ExtractionRawBytes))
	}
	cacheClearable := func() bool {
		st := stats.Get()
		return st != nil && st.ExtractionRawCount > 0
	}

	return core.View{Style: core.Style{Gap: 16, AlignSelf: core.AlignStretch}, Children: []core.Node{
		settingsCard(cx, lucide.ArchiveRestore,
			locales.SettingsDataBackupHeading, locales.SettingsDataBackupBody,
			core.View{Style: core.Style{Direction: core.Row, Wrap: core.Wrap, Gap: 8},
				Children: []core.Node{
					ui.Button{Text: locales.SettingsDataExportButton(cx), Variant: ui.ButtonSecondary,
						Icon: lucide.Download, OnPress: export, TestID: "data-export"},
					ui.Button{Text: locales.SettingsDataImportButton(cx), Variant: ui.ButtonSecondary,
						Icon: lucide.Upload, OnPress: func() { importOpen.Set(true) },
						TestID: "data-import"},
				}},
			core.Show{When: func() bool { return importStatus.Get() != "" },
				Then: func(cx *core.Scope) core.Node {
					return core.Text{ContentFunc: func() string { return importStatus.Get() },
						Style: core.Style{FontSize: typeCaption},
						StyleFunc: func() core.Style {
							if importFailed.Get() {
								return ui.Colored(ui.ColorsOf(cx).Danger)()
							}
							return ui.Colored(ui.ColorsOf(cx).Muted)()
						}}
				}},
		),
		settingsCard(cx, lucide.Database,
			locales.SettingsDataCacheHeading, locales.SettingsDataCacheBody,
			core.Text{ContentFunc: statLine,
				Style:     core.Style{FontSize: typeCaption, FontVariant: core.FontTabularNums},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), TestID: "data-cache-db-size"},
			core.Text{ContentFunc: cacheLine,
				Style:     core.Style{FontSize: typeCaption, FontVariant: core.FontTabularNums},
				StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted), TestID: "data-cache-summary"},
			core.View{Style: core.Style{Direction: core.Row}, Children: []core.Node{
				ui.Button{Text: locales.SettingsDataCacheClearButton(cx),
					Variant: ui.ButtonSecondary, Icon: lucide.Trash,
					Disabled: func() bool { return !cacheClearable() }, OnPress: clearCache,
					TestID: "data-cache-clear"},
			}},
		),
		settingsCard(cx, lucide.Calendar,
			locales.SettingsDataAutoBackupHeading, locales.SettingsDataAutoBackupBody,
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignCenter,
				Wrap: core.Wrap, Gap: 10}, Children: []core.Node{
				ui.Switch{Checked: autoOn.Get, OnChange: setAutoBackup,
					Label:  locales.SettingsDataAutoBackupToggleLabel(cx),
					TestID: "data-auto-backup-toggle"},
				ui.Button{Text: locales.SettingsDataAutoBackupOpen(cx), Variant: ui.ButtonOutline,
					Icon: lucide.FolderOpen, OnPress: openBackups, TestID: "data-auto-backup-open"},
			}},
		),
		settingsDangerCard(cx, lucide.TriangleAlert,
			locales.SettingsDataResetHeading, locales.SettingsDataResetBody,
			core.View{Style: core.Style{Direction: core.Row, AlignItems: core.AlignEnd,
				Wrap: core.Wrap, Gap: 8}, Children: []core.Node{
				core.View{Style: core.Style{FlexGrow: 1, MinWidth: core.Pt(200)},
					Children: []core.Node{
						dataField(cx, locales.SettingsDataResetConfirmInput(cx),
							ui.Input{Value: resetText.Get, OnChange: resetText.Set,
								Placeholder: "RESET", MaxLength: 10, TestID: "data-reset-input"}),
					}},
				ui.Button{Text: locales.SettingsDataResetButton(cx), Color: ui.ColorsOf(cx).Danger,
					Disabled: func() bool { return !resetArmed(resetText.Get()) || resetBusy.Get() },
					Busy:     resetBusy.Get, OnPress: reset, TestID: "data-reset"},
			}},
		),

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

		dataDialog(cx, importOpen, locales.SettingsDataImportButton(cx), []core.Node{
			core.Text{Content: locales.SettingsDataImportConfirm(cx),
				Style: core.Style{FontSize: typeBody}, StyleFunc: ui.Colored(ui.ColorsOf(cx).Muted)},
		}, []core.Node{
			dataCancelButton(cx, importOpen, "data-import-cancel"),
			ui.Button{Text: locales.SettingsDataImportButton(cx), Color: ui.ColorsOf(cx).Danger,
				OnPress: importBackup, TestID: "data-import-confirm"},
		}, "data-import-dialog"),
	}}
}

func resetArmed(text string) bool {
	return strings.ToUpper(strings.TrimSpace(text)) == "RESET"
}

// replaceDatabase copies source over the active workspace file and restarts.
// An empty source is a reset: the file is removed and the next launch creates
// an empty database and walks onboarding again.
func (s *Session) replaceDatabase(cx *core.Scope, source string) error {
	path := s.db.Path()
	staged := ""
	if source != "" {
		// Copy beside the workspace first so a read error leaves the open
		// database and the UI untouched.
		staged = path + ".restore-tmp"
		if err := copyBackupFile(source, staged); err != nil {
			return err
		}
	}
	if err := s.db.Close(); err != nil {
		os.Remove(staged)
		return err
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		_ = os.Remove(path + suffix)
	}
	if source != "" {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return err
		}
		if err := os.Rename(staged, path); err != nil {
			return err
		}
	} else if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
		return err
	}
	desktop.Restart(cx)
	return nil
}

func (s *Session) resetDatabase(cx *core.Scope) error {
	return s.replaceDatabase(cx, "")
}

func copyBackupFile(source, dest string) error {
	data, err := os.ReadFile(source)
	if err != nil {
		return err
	}
	return os.WriteFile(dest, data, 0o600)
}
