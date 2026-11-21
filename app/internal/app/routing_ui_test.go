package app

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"app.carbonink.desktop/internal/routing"
	"app.carbonink.desktop/internal/store"
	"app.carbonink.desktop/locales"

	"app.carbonink.desktop/internal/platform"
	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
	"github.com/nsgo-dev/nsgo/ui"
)

// TestSettingsAmapKey saves a key and then clears it, checking that an empty
// input removes the stored row instead of persisting an empty string.
func TestSettingsAmapKey(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.Press("id:nav:settings")
	ui.WaitFor("id:settings-amap-key", 5*time.Second)

	ctx := context.Background()
	check, err := store.OpenReadOnly(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	defer check.Close()

	ui.Type("id:settings-amap-key", " test-key ")
	ui.Press("id:settings-amap-save")
	ui.WaitFor("text:AMap key saved", 3*time.Second)
	if key, err := routing.StoredKey(ctx, check); err != nil || key != "test-key" {
		t.Fatalf("stored key = %q, %v", key, err)
	}

	ui.Clear("id:settings-amap-key")
	ui.Press("id:settings-amap-save")
	ui.WaitFor("text:AMap key saved", 3*time.Second)
	ui.WaitUntil(3*time.Second, func() bool {
		key, err := routing.StoredKey(ctx, check)
		return err == nil && key == ""
	})
}

// routingFormRoot mounts the activity form alone so the lookup can be tested
// without a document extraction round-trip.
func routingFormRoot(seed *activityPrefill, session **Session) func(*core.Scope) core.Node {
	return func(cx *core.Scope) core.Node {
		log := platform.NewLogger(cx.LogsDir())
		s, err := open(cx, log)
		if err != nil {
			return core.Text{Content: err.Error()}
		}
		*session = s
		rev := core.NewSignal(cx, 0)
		form := s.newActivityForm(cx, rev, func() *store.Activity { return nil },
			func() *activityPrefill { return seed },
			locales.DataAddActivity, locales.DataCreate, "test-activity", nil)
		return core.View{Children: []core.Node{
			ui.Button{Text: "Open", OnPress: form.show, TestID: "open-activity"},
			form.dialog,
		}}
	}
}

func TestActivityRoutingLookupFillsTravelAmount(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	var session *Session
	seed := &activityPrefill{
		SourceID: "src", PeriodID: "period", Start: "2025-01-01", End: "2025-01-31",
		Unit: "km", RoutingStage: "travel", RoutingOrigin: "PEK",
		RoutingDestination: "PVG", TravelMode: "air",
	}
	ui := nsgotest.Start(t, routingFormRoot(seed, &session), nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	t.Cleanup(func() {
		if session != nil {
			_ = session.db.Close()
		}
	})

	ui.Press("id:open-activity")
	ui.WaitFor("id:test-activity-routing-lookup", 3*time.Second)
	ui.Press("id:test-activity-routing-lookup")
	ui.WaitFor("text:Haversine:", 3*time.Second)
	amount := ui.Find("id:test-activity-amount").Text
	km, err := strconv.Atoi(amount)
	if err != nil || km < 1000 || km > 1200 {
		t.Fatalf("travel amount = %q, want the PEK-PVG distance", amount)
	}
}

func TestActivityRoutingLookupLeavesFreightAmount(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"1","route":{"paths":[{"distance":"1085000"}]}}`))
	}))
	defer server.Close()
	oldBase, oldClient := routing.AMapBase, routing.AMapClient
	routing.AMapBase = server.URL
	routing.AMapClient = server.Client()
	defer func() { routing.AMapBase, routing.AMapClient = oldBase, oldClient }()

	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ctx := context.Background()
	setup, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if err := routing.SaveKey(ctx, setup, "test-key"); err != nil {
		t.Fatal(err)
	}
	_ = setup.Close()

	var session *Session
	seed := &activityPrefill{
		SourceID: "src", PeriodID: "period", Start: "2025-01-01", End: "2025-01-31",
		Amount: 1250, Unit: "kg", RoutingStage: "freight",
		RoutingOrigin: "Shanghai", RoutingDestination: "Hangzhou",
	}
	ui := nsgotest.Start(t, routingFormRoot(seed, &session), nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	t.Cleanup(func() {
		if session != nil {
			_ = session.db.Close()
		}
	})

	ui.Press("id:open-activity")
	ui.WaitFor("id:test-activity-routing-lookup", 3*time.Second)
	ui.Press("id:test-activity-routing-lookup")
	ui.WaitFor("text:AMap: 1085 km", 3*time.Second)
	if amount := ui.Find("id:test-activity-amount").Text; amount != "1250" {
		t.Fatalf("freight amount = %q, want it unchanged", amount)
	}
}

func TestActivityRoutingLookupWithoutKeyExplains(t *testing.T) {
	dbPath := fixtureDB(t)
	t.Setenv("CARBONINK_TEST_DB", dbPath)
	var session *Session
	seed := &activityPrefill{
		SourceID: "src", PeriodID: "period", Start: "2025-01-01", End: "2025-01-31",
		Amount: 42, Unit: "km", RoutingStage: "travel", RoutingOrigin: "Shanghai",
		RoutingDestination: "Hangzhou", TravelMode: "taxi",
	}
	ui := nsgotest.Start(t, routingFormRoot(seed, &session), nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	t.Cleanup(func() {
		if session != nil {
			_ = session.db.Close()
		}
	})

	ui.Press("id:open-activity")
	ui.WaitFor("id:test-activity-routing-lookup", 3*time.Second)
	ui.Press("id:test-activity-routing-lookup")
	ui.WaitFor("text:AMap API key not configured", 3*time.Second)
	if amount := ui.Find("id:test-activity-amount").Text; amount != "42" {
		t.Fatalf("amount after a failed lookup = %q, want it unchanged", amount)
	}
}
