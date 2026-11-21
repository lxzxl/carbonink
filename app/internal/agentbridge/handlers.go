package agentbridge

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"

	"app.carbonink.desktop/internal/store"
)

// Handlers maps the three allowlisted channels onto the store operations the
// UI itself uses. OnWrite runs after a successful write so the desktop can
// refresh its cached rows.
type Handlers struct {
	Store   *store.Store
	OnWrite func()
}

// Dispatch implements the bridge's Dispatch signature.
func (h *Handlers) Dispatch(ctx context.Context, channel string, args []json.RawMessage) (any, error) {
	if h.Store == nil {
		return nil, errors.New("agentbridge: store is not available")
	}
	switch channel {
	case "answer:save":
		return h.saveAnswer(ctx, args)
	case "activity:create":
		return h.createActivity(ctx, args)
	case "source:create":
		return h.createSource(ctx, args)
	}
	return nil, &RemoteError{Code: ErrorNotAllowed, Message: "Unknown channel: " + channel}
}

type answerSaveInput struct {
	QuestionID string  `json:"question_id"`
	Value      string  `json:"value"`
	Unit       *string `json:"unit"`
	Finalize   bool    `json:"finalize"`
	SourceKind string  `json:"source_kind"`
}

func (h *Handlers) saveAnswer(ctx context.Context, args []json.RawMessage) (any, error) {
	var in answerSaveInput
	if err := decodeArg(args, &in); err != nil {
		return nil, err
	}
	unit := ""
	if in.Unit != nil {
		unit = *in.Unit
	}
	sourceKind := in.SourceKind
	if sourceKind == "" {
		sourceKind = "ai_suggested"
	}
	answer, err := h.Store.SaveAnswer(ctx, store.SaveAnswerInput{
		QuestionID: in.QuestionID, Value: in.Value, Unit: unit,
		SourceKind: sourceKind, Finalize: in.Finalize,
	})
	if err != nil {
		return nil, err
	}
	h.wrote()
	return map[string]any{
		"id": answer.ID, "question_id": answer.QuestionID, "value": answer.Value,
		"unit": answer.Unit, "source_kind": answer.SourceKind,
		"finalized_at": answer.FinalizedAt,
	}, nil
}

type activityCreateInput struct {
	EmissionSourceID  string  `json:"emission_source_id"`
	ReportingPeriodID string  `json:"reporting_period_id"`
	OccurredAtStart   string  `json:"occurred_at_start"`
	OccurredAtEnd     string  `json:"occurred_at_end"`
	Amount            float64 `json:"amount"`
	Unit              string  `json:"unit"`
	EFFactorCode      string  `json:"ef_factor_code"`
	EFYear            int     `json:"ef_year"`
	EFSource          string  `json:"ef_source"`
	EFGeography       string  `json:"ef_geography"`
	EFDatasetVersion  string  `json:"ef_dataset_version"`
	FuelCode          *string `json:"fuel_code"`
	Notes             *string `json:"notes"`
}

func (h *Handlers) createActivity(ctx context.Context, args []json.RawMessage) (any, error) {
	var in activityCreateInput
	if err := decodeArg(args, &in); err != nil {
		return nil, err
	}
	fuelCode := ""
	if in.FuelCode != nil {
		fuelCode = *in.FuelCode
	}
	notes := ""
	if in.Notes != nil {
		notes = *in.Notes
	}
	created, err := h.Store.CreateActivity(ctx, store.ActivityInput{
		EmissionSourceID: in.EmissionSourceID, ReportingPeriodID: in.ReportingPeriodID,
		OccurredAtStart: in.OccurredAtStart, OccurredAtEnd: in.OccurredAtEnd,
		Amount: in.Amount, Unit: in.Unit,
		EF: store.EmissionFactorKey{
			FactorCode: in.EFFactorCode, Year: in.EFYear, Source: in.EFSource,
			Geography: in.EFGeography, DatasetVersion: in.EFDatasetVersion,
		},
		FuelCode: fuelCode, Notes: notes,
	})
	if err != nil {
		return nil, err
	}
	h.wrote()
	return map[string]any{
		"id": created.ID, "activity_id": created.ID,
		"emission_source_id":  created.EmissionSourceID,
		"reporting_period_id": created.ReportingPeriodID,
		"amount":              created.Amount, "unit": created.Unit,
		"computed_co2e_kg": created.CO2eKg,
	}, nil
}

type sourceCreateInput struct {
	SiteID          string  `json:"site_id"`
	Name            string  `json:"name"`
	Scope           int     `json:"scope"`
	Category        *string `json:"category"`
	GHGProtocolPath *string `json:"ghg_protocol_path"`
}

func (h *Handlers) createSource(ctx context.Context, args []json.RawMessage) (any, error) {
	var in sourceCreateInput
	if err := decodeArg(args, &in); err != nil {
		return nil, err
	}
	category := ""
	if in.Category != nil {
		category = *in.Category
	}
	path := ""
	if in.GHGProtocolPath != nil {
		path = *in.GHGProtocolPath
	}
	created, err := h.Store.CreateSource(ctx, store.SourceInput{
		SiteID: in.SiteID, Name: in.Name, Scope: in.Scope,
		Category: category, GHGProtocolPath: path,
	})
	if err != nil {
		return nil, err
	}
	h.wrote()
	return map[string]any{
		"id": created.ID, "site_id": created.SiteID, "name": created.Name,
		"scope": created.Scope, "category": created.Category,
	}, nil
}

func (h *Handlers) wrote() {
	if h.OnWrite != nil {
		h.OnWrite()
	}
}

func decodeArg(args []json.RawMessage, out any) error {
	if len(args) == 0 || len(args[0]) == 0 || string(args[0]) == "null" {
		return errors.New("missing tool arguments")
	}
	decoder := json.NewDecoder(bytes.NewReader(args[0]))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(out); err != nil {
		return errors.New("invalid tool arguments: " + err.Error())
	}
	return nil
}
