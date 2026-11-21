package app

import (
	"context"
	"time"

	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/internal/undo"
	"app.carbonink.desktop/locales"

	"github.com/nsgo-dev/nsgo/core"
)

// pushUndo records one reversible UI mutation. Entries are in-memory only, so
// they vanish on quit, backup import and reset, matching 1.x.
func (s *Session) pushUndo(action undo.Action) {
	if s.undo != nil {
		s.undo.Push(action)
	}
}

func (s *Session) pushUndoAction(kind string, undoFn, redoFn func(context.Context) error) {
	s.pushUndo(undo.Action{Kind: kind, Undo: undoFn, Redo: redoFn})
}

// performHistory runs the newest undo or redo, reloads the ledger and shows a
// short sidebar status. Individual actions also refresh the dialog they came
// from, because a root reload cannot rebuild a screen's local struct.
func (s *Session) performHistory(cx *core.Scope, rev *core.Signal[int], redo bool) {
	ctx := context.Background()
	var kind string
	var err error
	if redo {
		kind, err = s.undo.Redo(ctx)
	} else {
		kind, err = s.undo.Undo(ctx)
	}
	if err != nil {
		message := locales.UndoFailed(cx)
		if redo {
			message = locales.RedoFailed(cx)
		}
		s.setUndoStatus(cx, message+": "+err.Error())
		return
	}
	if kind == "" {
		return
	}
	if err := s.reload(ctx); err != nil {
		s.setUndoStatus(cx, locales.UndoFailed(cx)+": "+err.Error())
		return
	}
	rev.Set(rev.Get() + 1)
	message := locales.UndoDone(cx)
	if redo {
		message = locales.RedoDone(cx)
	}
	s.setUndoStatus(cx, message)
}

func (s *Session) setUndoStatus(cx *core.Scope, message string) {
	if s.undoStatus == nil {
		return
	}
	s.undoStatus.Set(message)
	time.AfterFunc(4*time.Second, func() {
		s.scope.Post(func() {
			if s.undoStatus.Get() == message {
				s.undoStatus.Set("")
			}
		})
	})
}

// activityInputOf turns a captured row back into the editable fields. It is
// used by both directions of an activity update.
func activityInputOf(a store.Activity) store.ActivityInput {
	return store.ActivityInput{
		EmissionSourceID: a.EmissionSourceID, ReportingPeriodID: a.ReportingPeriodID,
		OccurredAtStart: a.OccurredAt, OccurredAtEnd: a.OccurredAtEnd,
		Amount: a.Amount, Unit: a.Unit,
		EF: store.EmissionFactorKey{
			FactorCode: a.EFFactorCode, Year: a.EFYear, Source: a.EFSource,
			Geography: a.EFGeography, DatasetVersion: a.EFDatasetVersion,
		},
		FuelCode: a.FuelCode, Notes: a.Notes, ExtractionID: a.ExtractionID,
	}
}

func (s *Session) recordActivityCreate(created *store.Activity, extraction *store.Extraction,
	onSaved func(), dataRev *core.Signal[int]) {
	if created == nil {
		return
	}
	ctx := context.Background()
	snapshot := *created
	evidence, _ := s.db.ListEvidence(ctx, store.EvidenceTarget{ActivityDataID: created.ID})
	refresh := func() {
		if onSaved != nil {
			onSaved()
			return
		}
		if err := dataRefresh(s, dataRev); err != nil {
			s.log.Warn("refresh after undo failed", "err", err)
		}
	}
	if extraction == nil {
		s.pushUndoAction("activity.create",
			func(ctx context.Context) error {
				if err := s.db.DeleteActivity(ctx, snapshot.ID); err != nil {
					return err
				}
				refresh()
				return nil
			},
			func(ctx context.Context) error {
				if err := s.db.RestoreActivity(ctx, snapshot, evidence); err != nil {
					return err
				}
				refresh()
				return nil
			})
		return
	}
	before := *extraction
	s.pushUndoAction("extraction.confirm",
		func(ctx context.Context) error {
			if err := s.db.DeleteActivity(ctx, snapshot.ID); err != nil {
				return err
			}
			if err := s.db.RestoreExtraction(ctx, before); err != nil {
				return err
			}
			refresh()
			return nil
		},
		func(ctx context.Context) error {
			if err := s.db.RestoreActivity(ctx, snapshot, evidence); err != nil {
				return err
			}
			if err := s.db.ConfirmExtraction(ctx, before.ID); err != nil {
				return err
			}
			refresh()
			return nil
		})
}

func (s *Session) recordActivityUpdate(before, after *store.Activity,
	onSaved func(), dataRev *core.Signal[int]) {
	if before == nil || after == nil {
		return
	}
	oldRow := *before
	newRow := *after
	refresh := func() {
		if onSaved != nil {
			onSaved()
			return
		}
		if err := dataRefresh(s, dataRev); err != nil {
			s.log.Warn("refresh after undo failed", "err", err)
		}
	}
	s.pushUndoAction("activity.update",
		func(ctx context.Context) error {
			if _, err := s.db.UpdateActivity(ctx, oldRow.ID, activityInputOf(oldRow)); err != nil {
				return err
			}
			refresh()
			return nil
		},
		func(ctx context.Context) error {
			if _, err := s.db.UpdateActivity(ctx, newRow.ID, activityInputOf(newRow)); err != nil {
				return err
			}
			refresh()
			return nil
		})
}

func (s *Session) recordSourceCreate(created *store.EmissionSource,
	dataRev *core.Signal[int]) {
	if created == nil {
		return
	}
	row := *created
	refresh := func() {
		if err := dataRefresh(s, dataRev); err != nil {
			s.log.Warn("refresh after undo failed", "err", err)
		}
	}
	s.pushUndoAction("source.create",
		func(ctx context.Context) error {
			if err := s.db.DeleteSource(ctx, row.ID); err != nil {
				return err
			}
			refresh()
			return nil
		},
		func(ctx context.Context) error {
			if err := s.db.RestoreSource(ctx, row); err != nil {
				return err
			}
			refresh()
			return nil
		})
}

func (s *Session) recordSourceUpdate(before, after store.EmissionSource,
	dataRev *core.Signal[int]) {
	if before.ID == "" {
		return
	}
	refresh := func() {
		if err := dataRefresh(s, dataRev); err != nil {
			s.log.Warn("refresh after undo failed", "err", err)
		}
	}
	apply := func(ctx context.Context, src store.EmissionSource) error {
		if err := s.db.UpdateSource(ctx, src.ID, store.SourcePatch{
			Name: src.Name, Scope: src.Scope, Category: src.Category,
			GHGProtocolPath: src.GHGProtocolPath, IsActive: src.IsActive,
		}); err != nil {
			return err
		}
		refresh()
		return nil
	}
	s.pushUndoAction("source.update",
		func(ctx context.Context) error { return apply(ctx, before) },
		func(ctx context.Context) error { return apply(ctx, after) })
}

func (s *Session) recordSourceBatchCreate(created []*store.EmissionSource,
	dataRev *core.Signal[int]) {
	if len(created) == 0 {
		return
	}
	rows := make([]store.EmissionSource, 0, len(created))
	ids := make([]string, 0, len(created))
	for _, src := range created {
		if src == nil {
			continue
		}
		rows = append(rows, *src)
		ids = append(ids, src.ID)
	}
	refresh := func() {
		if err := dataRefresh(s, dataRev); err != nil {
			s.log.Warn("refresh after undo failed", "err", err)
		}
	}
	s.pushUndoAction("source.create",
		func(ctx context.Context) error {
			if err := s.db.DeleteSources(ctx, ids); err != nil {
				return err
			}
			refresh()
			return nil
		},
		func(ctx context.Context) error {
			if err := s.db.RestoreSources(ctx, rows); err != nil {
				return err
			}
			refresh()
			return nil
		})
}

func (s *Session) recordAnswerSave(d *questionnaireDetail, kind string,
	before, after *store.Answer) {
	if after == nil {
		return
	}
	refresh := func() {
		if d.open.Get() {
			_ = d.load()
			d.syncSelected()
			d.rev.Set(d.rev.Get() + 1)
		}
	}
	afterRow := *after
	if before == nil {
		s.pushUndoAction(kind,
			func(ctx context.Context) error {
				if err := s.db.DeleteAnswer(ctx, afterRow.ID); err != nil {
					return err
				}
				refresh()
				return nil
			},
			func(ctx context.Context) error {
				if err := s.db.RestoreAnswer(ctx, afterRow); err != nil {
					return err
				}
				refresh()
				return nil
			})
		return
	}
	beforeRow := *before
	s.pushUndoAction(kind,
		func(ctx context.Context) error {
			if err := s.db.RestoreAnswer(ctx, beforeRow); err != nil {
				return err
			}
			refresh()
			return nil
		},
		func(ctx context.Context) error {
			if err := s.db.RestoreAnswer(ctx, afterRow); err != nil {
				return err
			}
			refresh()
			return nil
		})
}

func (s *Session) recordFinalizeAll(d *questionnaireDetail, before []store.Answer,
	beforeStatus string) {
	if len(before) == 0 && beforeStatus == "" {
		return
	}
	beforeRows := append([]store.Answer(nil), before...)
	refresh := func() {
		if q, err := s.db.QuestionnaireByID(context.Background(), d.id); err == nil && q != nil {
			d.status.Set(q.Status)
		}
		if d.open.Get() {
			_ = d.load()
			d.syncSelected()
			d.rev.Set(d.rev.Get() + 1)
		}
	}
	s.pushUndoAction("answer.finalize",
		func(ctx context.Context) error {
			if err := s.db.RestoreAnswers(ctx, beforeRows); err != nil {
				return err
			}
			if beforeStatus != "" {
				if err := s.db.RestoreQuestionnaireStatus(ctx, d.id, beforeStatus); err != nil {
					return err
				}
			}
			refresh()
			return nil
		},
		func(ctx context.Context) error {
			if err := s.db.FinalizeQuestionnaire(ctx, d.id); err != nil {
				return err
			}
			refresh()
			return nil
		})
}
