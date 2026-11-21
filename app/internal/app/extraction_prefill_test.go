package app

import (
	"strings"
	"testing"

	"app.carbonink.desktop/internal/store"
)

func prefillSession() *Session {
	return &Session{
		sources: []store.EmissionSource{
			{ID: "other", Category: "electricity.grid", IsActive: true},
		},
		periods: []store.ReportingPeriod{
			{ID: "period", Year: 2025, StartsAt: "2025-01-01", EndsAt: "2025-12-31", IsActive: true},
		},
	}
}

func TestExtractionPrefillMapsStages(t *testing.T) {
	document := store.Document{ID: "doc"}
	cases := []struct {
		name     string
		stage    string
		json     string
		amount   float64
		unit     string
		start    string
		contains string
	}{
		{
			name: "china utility", stage: "china_utility.v1",
			json:   `{"doc_type":"china_utility","supplier_name":"国网","account_no":"A1","amount_kwh":523.5,"period_start":"2025-09-01","period_end":"2025-09-30","confidence":"high"}`,
			amount: 523.5, unit: "kWh", start: "2025-09-01", contains: "国网",
		},
		{
			name: "fuel", stage: "fuel_receipt.v1",
			json:   `{"doc_type":"fuel_receipt","supplier_name":"中国石化","fuel_type":"92#汽油","fuel_category":"gasoline","volume_l":38.5,"amount_yuan":302.23,"occurred_at":"2026-04-15","confidence":"high"}`,
			amount: 38.5, unit: "L", start: "2026-04-15", contains: "92#汽油",
		},
		{
			name: "freight", stage: "freight.v1",
			json:   `{"doc_type":"freight","supplier_name":"顺丰","mode":"road","weight_kg":1250,"origin":"广州","destination":"上海","tracking_no":"SF1","amount_yuan":2680,"occurred_at":"2026-05-08","confidence":"high"}`,
			amount: 1250, unit: "kg", start: "2026-05-08", contains: "广州 → 上海",
		},
		{
			name: "purchase by weight", stage: "purchase.v1",
			json:   `{"doc_type":"purchase","supplier_name":"宝钢","item_description":"钢板","category":"raw_material","quantity_kg":7500,"amount_yuan":48650,"occurred_at":"2026-04-22","confidence":"medium"}`,
			amount: 7500, unit: "kg", start: "2026-04-22", contains: "钢板",
		},
		{
			name: "purchase by amount", stage: "purchase.v1",
			json:   `{"doc_type":"purchase","supplier_name":"咨询公司","item_description":"咨询","category":"service","quantity_kg":null,"amount_yuan":10000,"occurred_at":"2026-04-22","confidence":"high"}`,
			amount: 10000, unit: "CNY", start: "2026-04-22", contains: "咨询",
		},
		{
			name: "travel by distance", stage: "travel.v1",
			json:   `{"doc_type":"travel","supplier_name":"国航","mode":"air","origin":"北京","destination":"上海","departure_at":"2026-04-15T08:30","distance_km":1200,"amount_yuan":1250,"flight_or_train_no":"CA1234","confidence":"high"}`,
			amount: 1200, unit: "km", start: "2026-04-15", contains: "北京 → 上海",
		},
		{
			name: "travel by amount", stage: "travel.v1",
			json:   `{"doc_type":"travel","supplier_name":"国航","mode":"air","origin":"北京","destination":"上海","departure_at":"2026-04-15","distance_km":null,"amount_yuan":1250,"confidence":"high"}`,
			amount: 1250, unit: "CNY", start: "2026-04-15", contains: "国航",
		},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			s := prefillSession()
			row := &store.Extraction{
				ID: "extraction", DocumentID: document.ID, PromptVersion: tc.stage,
				ParsedJSON: tc.json, Status: store.ExtractionReviewNeeded,
			}
			seed := s.extractionPrefill(document, row)
			if seed == nil {
				t.Fatal("no prefill")
			}
			if seed.Amount != tc.amount || seed.Unit != tc.unit || seed.Start != tc.start {
				t.Fatalf("seed = %+v, want %v %s %s", seed, tc.amount, tc.unit, tc.start)
			}
			if seed.End == "" || seed.PeriodID != "period" || seed.SourceID != "other" {
				t.Fatalf("seed ids = %+v", seed)
			}
			if seed.ExtractionID != "extraction" || seed.EvidenceDocumentID != document.ID {
				t.Fatalf("seed provenance = %+v", seed)
			}
			if !strings.Contains(seed.Notes, tc.contains) {
				t.Errorf("notes = %q, want %q", seed.Notes, tc.contains)
			}
		})
	}
}

func TestExtractionPrefillFallsBackToPeriodDates(t *testing.T) {
	s := prefillSession()
	seed := s.extractionPrefill(store.Document{ID: "doc"}, &store.Extraction{
		ID: "extraction", PromptVersion: "china_utility.v1",
		ParsedJSON: `{"doc_type":"china_utility","supplier_name":"国网","amount_kwh":1,` +
			`"period_start":"","period_end":"","confidence":"low"}`,
	})
	if seed == nil || seed.Start != "2025-01-01" || seed.End != "2025-12-31" {
		t.Fatalf("seed = %+v", seed)
	}
}

// TestExtractionPrefillCarriesRoutingHints checks the endpoints the distance
// lookup needs: freight rows can be looked up without a travel mode, and
// travel rows keep the mode that selects air / rail / road.
func TestExtractionPrefillCarriesRoutingHints(t *testing.T) {
	s := prefillSession()
	freight := s.extractionPrefill(store.Document{ID: "doc"}, &store.Extraction{
		ID: "freight", PromptVersion: "freight.v1",
		ParsedJSON: `{"doc_type":"freight","weight_kg":1,"origin":"Guangzhou",` +
			`"destination":"Shanghai","occurred_at":"2026-05-08"}`,
	})
	if freight == nil || freight.RoutingStage != "freight" ||
		freight.RoutingOrigin != "Guangzhou" || freight.RoutingDestination != "Shanghai" ||
		freight.TravelMode != "" {
		t.Fatalf("freight routing = %+v", freight)
	}
	travel := s.extractionPrefill(store.Document{ID: "doc"}, &store.Extraction{
		ID: "travel", PromptVersion: "travel.v1",
		ParsedJSON: `{"doc_type":"travel","mode":"air","origin":"Beijing",` +
			`"destination":"Shanghai","departure_at":"2026-04-15"}`,
	})
	if travel == nil || travel.RoutingStage != "travel" ||
		travel.RoutingOrigin != "Beijing" || travel.RoutingDestination != "Shanghai" ||
		travel.TravelMode != "air" {
		t.Fatalf("travel routing = %+v", travel)
	}
}

func TestExtractionPrefillRejectsBadInput(t *testing.T) {
	s := prefillSession()
	if seed := s.extractionPrefill(store.Document{}, &store.Extraction{
		PromptVersion: "unknown.v1", ParsedJSON: `{}`,
	}); seed != nil {
		t.Fatalf("unknown stage seed = %+v", seed)
	}
	if seed := s.extractionPrefill(store.Document{}, &store.Extraction{
		PromptVersion: "china_utility.v1", ParsedJSON: `not json`,
	}); seed != nil {
		t.Fatalf("bad json seed = %+v", seed)
	}
}
