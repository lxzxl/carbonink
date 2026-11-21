package app

import (
	"encoding/json"
	"strconv"
	"strings"

	"app.carbonink.desktop/internal/store"
)

// extractionPrefill maps a staged extraction onto the activity form. The
// mapping is intentionally conservative: it fills the quantity, unit and
// dates the document states, and leaves source, period and EF choices to the
// user when no obvious match exists.
func (s *Session) extractionPrefill(document store.Document, row *store.Extraction) *activityPrefill {
	var data map[string]any
	if err := json.Unmarshal([]byte(row.ParsedJSON), &data); err != nil {
		return nil
	}
	seed := &activityPrefill{
		ExtractionID:       row.ID,
		EvidenceDocumentID: document.ID,
		SourceID:           s.defaultSourceForStage(row.PromptVersion),
	}
	period := dataYearPeriod(s.periods)
	if period != nil {
		seed.PeriodID = period.ID
	}

	switch row.PromptVersion {
	case "china_utility.v1":
		seed.Amount = numberValue(data["amount_kwh"])
		seed.Unit = "kWh"
		seed.Start = dateValue(data["period_start"])
		seed.End = dateValue(data["period_end"])
		seed.Notes = joinNotes(textValue(data["supplier_name"]),
			withPrefix("account ", textValue(data["account_no"])))
	case "fuel_receipt.v1":
		seed.Amount = numberValue(data["volume_l"])
		seed.Unit = "L"
		seed.Start = dateValue(data["occurred_at"])
		seed.End = seed.Start
		seed.Notes = joinNotes(textValue(data["supplier_name"]), textValue(data["fuel_type"]),
			withPrefix("CNY ", numberText(data["amount_yuan"])))
	case "freight.v1":
		seed.Amount = numberValue(data["weight_kg"])
		seed.Unit = "kg"
		seed.Start = dateValue(data["occurred_at"])
		seed.End = seed.Start
		seed.Notes = joinNotes(textValue(data["supplier_name"]), textValue(data["mode"]),
			routeText(data["origin"], data["destination"]), textValue(data["tracking_no"]))
	case "purchase.v1":
		if kg := numberValue(data["quantity_kg"]); kg > 0 {
			seed.Amount, seed.Unit = kg, "kg"
		} else {
			seed.Amount, seed.Unit = numberValue(data["amount_yuan"]), "CNY"
		}
		seed.Start = dateValue(data["occurred_at"])
		seed.End = seed.Start
		seed.Notes = joinNotes(textValue(data["supplier_name"]),
			textValue(data["item_description"]), textValue(data["invoice_no"]))
	case "travel.v1":
		if km := numberValue(data["distance_km"]); km > 0 {
			seed.Amount, seed.Unit = km, "km"
		} else {
			seed.Amount, seed.Unit = numberValue(data["amount_yuan"]), "CNY"
		}
		seed.Start = dateValue(data["departure_at"])
		seed.End = seed.Start
		seed.Notes = joinNotes(textValue(data["supplier_name"]), textValue(data["mode"]),
			routeText(data["origin"], data["destination"]),
			firstText(data["flight_or_train_no"], data["ticket_no"]))
	default:
		return nil
	}

	if period != nil {
		if seed.Start == "" {
			seed.Start = dateValue(period.StartsAt)
		}
		if seed.End == "" {
			seed.End = dateValue(period.EndsAt)
		}
	}
	if seed.End == "" {
		seed.End = seed.Start
	}
	seed.Notes = truncateRunes(seed.Notes, 2000)
	return seed
}

// defaultSourceForStage picks the first active source whose category matches
// the stage, then falls back to the first active source.
func (s *Session) defaultSourceForStage(stageID string) string {
	wanted := map[string][]string{
		"china_utility.v1": {"electricity"},
		"fuel_receipt.v1":  {"fuel."},
		"freight.v1":       {"freight"},
		"purchase.v1":      {"purchase"},
		"travel.v1":        {"travel"},
	}
	for _, prefix := range wanted[stageID] {
		for _, source := range s.sources {
			if source.IsActive && strings.HasPrefix(source.Category, prefix) {
				return source.ID
			}
		}
	}
	for _, source := range s.sources {
		if source.IsActive {
			return source.ID
		}
	}
	return ""
}

func textValue(value any) string {
	switch v := value.(type) {
	case string:
		return strings.TrimSpace(v)
	case nil:
		return ""
	default:
		return strings.TrimSpace(numberText(value))
	}
}

func numberValue(value any) float64 {
	switch v := value.(type) {
	case float64:
		return v
	case string:
		f, _ := strconv.ParseFloat(strings.TrimSpace(v), 64)
		return f
	default:
		return 0
	}
}

func numberText(value any) string {
	switch v := value.(type) {
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case string:
		return strings.TrimSpace(v)
	case nil:
		return ""
	default:
		return ""
	}
}

func dateValue(value any) string {
	text := textValue(value)
	if len(text) >= 10 {
		return text[:10]
	}
	return text
}

func withPrefix(prefix, value string) string {
	if value == "" {
		return ""
	}
	return prefix + value
}

func routeText(origin, destination any) string {
	from, to := textValue(origin), textValue(destination)
	switch {
	case from != "" && to != "":
		return from + " → " + to
	case from != "":
		return from
	default:
		return to
	}
}

func firstText(values ...any) string {
	for _, value := range values {
		if text := textValue(value); text != "" {
			return text
		}
	}
	return ""
}

func joinNotes(values ...string) string {
	parts := make([]string, 0, len(values))
	for _, value := range values {
		if value = strings.TrimSpace(value); value != "" {
			parts = append(parts, value)
		}
	}
	return strings.Join(parts, " · ")
}
