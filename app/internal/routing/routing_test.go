package routing

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"

	"app.carbonink.desktop/internal/store"
)

func testStore(t *testing.T) (*store.Store, context.Context) {
	t.Helper()
	ctx := context.Background()
	db, err := store.Open(ctx, filepath.Join(t.TempDir(), "routing.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = db.Close() })
	if _, err := db.Migrate(ctx); err != nil {
		t.Fatal(err)
	}
	return db, ctx
}

func TestAirUsesAirportsAndCaches(t *testing.T) {
	db, ctx := testStore(t)
	first, err := Lookup(ctx, db, ModeAir, "PEK", "PVG")
	if err != nil {
		t.Fatal(err)
	}
	if first.Source != SourceHaversine || first.Cached || first.DistanceKM < 1000 ||
		first.DistanceKM > 1200 {
		t.Fatalf("PEK-PVG = %+v, want ~1080 km by haversine", first)
	}
	second, err := Lookup(ctx, db, ModeAir, " pek ", " pvg ")
	if err != nil {
		t.Fatal(err)
	}
	if !second.Cached || second.DistanceKM != first.DistanceKM {
		t.Fatalf("second lookup = %+v, want the cached first", second)
	}

	_, err = Lookup(ctx, db, ModeAir, "ZZZ", "PEK")
	if KindOf(err) != KindAirportUnknown {
		t.Fatalf("unknown airport error = %v, want KindAirportUnknown", err)
	}
}

func TestAmapLookupAndRetry(t *testing.T) {
	var calls atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/direction/driving" {
			t.Errorf("path = %q", r.URL.Path)
		}
		if r.URL.Query().Get("key") != "test-key" {
			t.Errorf("key = %q", r.URL.Query().Get("key"))
		}
		if calls.Add(1) == 1 {
			_, _ = w.Write([]byte(`{"status":"0","info":"server busy","infocode":"50000"}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"1","route":{"paths":[{"distance":"1085000"}]}}`))
	}))
	defer server.Close()
	oldBase, oldClient := AMapBase, AMapClient
	AMapBase = server.URL
	AMapClient = server.Client()
	defer func() { AMapBase, AMapClient = oldBase, oldClient }()

	db, ctx := testStore(t)
	if err := SaveKey(ctx, db, " test-key "); err != nil {
		t.Fatal(err)
	}
	result, err := Lookup(ctx, db, ModeDriving, "Shanghai", "Hangzhou")
	if err != nil {
		t.Fatal(err)
	}
	if result.DistanceKM != 1085 || result.Source != SourceAMap || result.Cached {
		t.Fatalf("result = %+v", result)
	}
	if calls.Load() != 2 {
		t.Fatalf("AMap calls = %d, want one retry", calls.Load())
	}
	again, err := Lookup(ctx, db, ModeDriving, "Shanghai", "Hangzhou")
	if err != nil {
		t.Fatal(err)
	}
	if !again.Cached || calls.Load() != 2 {
		t.Fatalf("cached lookup = %+v, calls = %d", again, calls.Load())
	}
}

func TestAmapFailures(t *testing.T) {
	var calls atomic.Int32
	mode := "rate"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		if mode == "rate" {
			_, _ = w.Write([]byte(`{"status":"0","info":"limit","infocode":"10003"}`))
			return
		}
		_, _ = w.Write([]byte(`{"status":"0","info":"no route","infocode":"20800"}`))
	}))
	defer server.Close()
	oldBase, oldClient := AMapBase, AMapClient
	AMapBase = server.URL
	AMapClient = server.Client()
	defer func() { AMapBase, AMapClient = oldBase, oldClient }()

	db, ctx := testStore(t)
	if err := SaveKey(ctx, db, "k"); err != nil {
		t.Fatal(err)
	}
	_, err := Lookup(ctx, db, ModeDriving, "A", "B")
	if KindOf(err) != KindRateLimited {
		t.Fatalf("rate limit error = %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("rate limit retried: %d calls", calls.Load())
	}
	mode = "route"
	calls.Store(0)
	_, err = Lookup(ctx, db, ModeTransit, "C", "D")
	if KindOf(err) != KindRouteNotFound {
		t.Fatalf("route error = %v", err)
	}
	if calls.Load() != 1 {
		t.Fatalf("route-not-found retried: %d calls", calls.Load())
	}
}

func TestTransitParsesItsOwnShape(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/direction/transit/integrated" {
			t.Errorf("path = %q", r.URL.Path)
		}
		_, _ = w.Write([]byte(`{"status":"1","route":{"transits":[{"distance":"302400"}]}}`))
	}))
	defer server.Close()
	oldBase, oldClient := AMapBase, AMapClient
	AMapBase = server.URL
	AMapClient = server.Client()
	defer func() { AMapBase, AMapClient = oldBase, oldClient }()

	db, ctx := testStore(t)
	if err := SaveKey(ctx, db, "k"); err != nil {
		t.Fatal(err)
	}
	result, err := Lookup(ctx, db, ModeTransit, "Shanghai Hongqiao", "Nanjing South")
	if err != nil {
		t.Fatal(err)
	}
	if result.DistanceKM != 302 {
		t.Fatalf("transit = %+v, want 302 km", result)
	}
}

func TestMissingKeyAndClearing(t *testing.T) {
	db, ctx := testStore(t)
	_, err := Lookup(ctx, db, ModeDriving, "A", "B")
	if KindOf(err) != KindKeyMissing {
		t.Fatalf("missing key error = %v", err)
	}
	if !strings.Contains(err.Error(), "Settings") {
		t.Fatalf("message = %q, want a pointer to Settings", err)
	}
	if err := SaveKey(ctx, db, " first "); err != nil {
		t.Fatal(err)
	}
	if key, err := StoredKey(ctx, db); err != nil || key != "first" {
		t.Fatalf("key = %q, %v", key, err)
	}
	if err := SaveKey(ctx, db, "  "); err != nil {
		t.Fatal(err)
	}
	if key, err := StoredKey(ctx, db); err != nil || key != "" {
		t.Fatalf("cleared key = %q, %v", key, err)
	}
}

func TestInferMode(t *testing.T) {
	for _, tc := range []struct{ stage, travel, want string }{
		{"freight", "", ModeDriving},
		{"travel", "air", ModeAir},
		{"travel", "rail", ModeTransit},
		{"travel", "taxi", ModeDriving},
		{"travel", "", ModeDriving},
	} {
		if got := InferMode(tc.stage, tc.travel); got != tc.want {
			t.Errorf("InferMode(%q, %q) = %q, want %q", tc.stage, tc.travel, got, tc.want)
		}
	}
}

func TestAirportTableLoads(t *testing.T) {
	codes := AirportCodes()
	if len(codes) < 15 {
		t.Fatalf("only %d airports", len(codes))
	}
	body, _ := json.Marshal(codes)
	if !strings.Contains(string(body), "PEK") {
		t.Fatalf("airports = %s", body)
	}
}
