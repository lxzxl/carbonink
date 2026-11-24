package app

import (
	"context"
	"strings"
	"testing"
	"time"

	"app.carbonink.desktop/internal/store"

	"github.com/nsgo-dev/nsgo/core"
	"github.com/nsgo-dev/nsgo/nsgotest"
)

func TestBuildMonthBucketsWindowAndSums(t *testing.T) {
	activities := []store.Activity{
		{OccurredAtEnd: "2026-11-03", CO2eKg: 10.5},
		{OccurredAtEnd: "2026-10-31", CO2eKg: 4},
		{OccurredAtEnd: "2025-10-31", CO2eKg: 99},
		{OccurredAtEnd: "not-a-date", CO2eKg: 1},
	}
	buckets := buildMonthBuckets(activities, 2026)
	if len(buckets) != 12 {
		t.Fatalf("buckets = %d, want 12", len(buckets))
	}
	if first, last := buckets[0].label, buckets[11].label; first != "2026-01" || last != "2026-12" {
		t.Errorf("window = %s..%s, want 2026-01..2026-12", first, last)
	}
	if got := buckets[10].total; got != 10.5 {
		t.Errorf("November total = %v, want 10.5", got)
	}
	if got := buckets[9].total; got != 4 {
		t.Errorf("October total = %v, want 4", got)
	}
	sum := 0.0
	for _, bucket := range buckets {
		sum += bucket.total
	}
	if sum != 14.5 {
		t.Errorf("window sum = %v, want only in-window rows (14.5)", sum)
	}
}

func TestBuildMonthBucketsApportionsDateRanges(t *testing.T) {
	activities := []store.Activity{
		{OccurredAt: "2026-01-01", OccurredAtEnd: "2026-12-31", CO2eKg: 365},
		{OccurredAt: "2026-03-16", OccurredAtEnd: "2026-04-15", CO2eKg: 62},
		{OccurredAt: "2026-01-10", CO2eKg: 10},
	}
	buckets := buildMonthBuckets(activities, 2026)
	for i, bucket := range buckets {
		want := float64(time.Date(2026, time.Month(i+2), 0, 0, 0, 0, 0, time.UTC).Day())
		if i == 2 {
			want += 32
		}
		if i == 3 {
			want += 30
		}
		if i == 0 {
			want += 10
		}
		if got := bucket.total; got != want {
			t.Errorf("%s total = %v, want %v", bucket.label, got, want)
		}
	}
}

func TestRecentActivitiesNewestFive(t *testing.T) {
	activities := []store.Activity{
		{ID: "a", OccurredAtEnd: "2026-01-01"},
		{ID: "b", OccurredAtEnd: "2026-05-01"},
		{ID: "c", OccurredAtEnd: "2026-03-01"},
		{ID: "d", OccurredAtEnd: "2026-02-01"},
		{ID: "e", OccurredAtEnd: "2026-04-01"},
		{ID: "f", OccurredAtEnd: "2026-06-01"},
	}
	got := recentActivities(activities)
	if len(got) != 5 {
		t.Fatalf("recent = %d rows, want 5", len(got))
	}
	want := []string{"f", "b", "e", "c", "d"}
	for i := range want {
		if got[i].ID != want[i] {
			t.Errorf("recent[%d] = %s, want %s", i, got[i].ID, want[i])
		}
	}
}

func TestDashboardShowsTrendAndRecentActivities(t *testing.T) {
	dbPath := fixtureDB(t)
	ctx := context.Background()
	db, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	today := "2025-11-21"
	if _, err := db.DB().ExecContext(ctx,
		`UPDATE activity_data SET occurred_at_start = ?, occurred_at_end = ?`, today, today); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:nav:dashboard")

	ui.WaitFor("id:dashboard-monthly-trend", 5*time.Second)
	ui.WaitFor("id:dashboard-trend-2025-11", 5*time.Second)
	ui.WaitFor("id:dashboard-recent", 5*time.Second)
	ui.WaitFor("text:外购电力", 3*time.Second)
	ui.WaitFor("text:120.00 kg CO2e", 3*time.Second)

	ui.WaitFor("id:dashboard-readiness", 3*time.Second)
	ui.Press("id:dashboard-readiness-open")
	ui.WaitFor("id:reports-period-period", 3*time.Second)
	ui.Press("id:reports-period-period")
	ui.WaitFor("id:reports-kind", 3*time.Second)
	ui.Press("id:nav:dashboard")

	ui.Press("id:dashboard-recent-view-all")
	ui.WaitFor("id:activities-table", 3*time.Second)
}

func TestDashboardWidgetsHideWithoutEmissions(t *testing.T) {
	dbPath := fixtureDB(t)
	ctx := context.Background()
	db, err := store.Open(ctx, dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := db.DB().ExecContext(ctx, `DELETE FROM activity_data`); err != nil {
		db.Close()
		t.Fatal(err)
	}
	if err := db.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:nav:dashboard")
	ui.WaitFor("text:Start here", 3*time.Second)
	if rows := ui.Query("id:dashboard-monthly-trend"); len(rows) != 0 {
		t.Errorf("monthly trend showed without data: %d views", len(rows))
	}
	if rows := ui.Query("id:dashboard-recent"); len(rows) != 0 {
		t.Errorf("recent activities showed without data: %d views", len(rows))
	}
}

func TestDashboardRecentActivityTruncatesLongSource(t *testing.T) {
	dbPath := fixtureDB(t)
	longName := strings.Repeat("超长排放源名称", 20)
	s, err := store.Open(context.Background(), dbPath)
	if err != nil {
		t.Fatal(err)
	}
	today := time.Now().Format("2006-01-02")
	if _, err := s.DB().ExecContext(context.Background(),
		`UPDATE emission_source SET name = ? WHERE id = 'src'`, longName); err != nil {
		s.Close()
		t.Fatal(err)
	}
	if _, err := s.DB().ExecContext(context.Background(),
		`UPDATE activity_data SET occurred_at_start = ?, occurred_at_end = ?`, today, today); err != nil {
		s.Close()
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:nav:dashboard")
	ui.WaitFor("id:dashboard-recent", 5*time.Second)

	source := ui.Find("id:dashboard-recent >> text:" + longName)
	if source.MaxLines != 1 {
		t.Fatalf("source MaxLines = %d, want 1", source.MaxLines)
	}
	if parent := source.Parent; parent != nil &&
		source.Frame.Origin.X+source.Frame.Size.Width > parent.Frame.Size.Width+1 {
		t.Fatalf("source overflows its row: source width %v, row width %v",
			source.Frame.Size.Width, parent.Frame.Size.Width)
	}
}

func TestDashboardRecentActivityShowsTheEndDate(t *testing.T) {
	dbPath := fixtureDB(t)
	s, err := store.Open(context.Background(), dbPath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.DB().ExecContext(context.Background(),
		`UPDATE activity_data SET occurred_at_start = '2025-01-05', occurred_at_end = '2025-03-20'`); err != nil {
		s.Close()
		t.Fatal(err)
	}
	if err := s.Close(); err != nil {
		t.Fatal(err)
	}

	t.Setenv("CARBONINK_TEST_DB", dbPath)
	ui := nsgotest.Start(t, Root, nsgotest.Size(1280, 820),
		nsgotest.Environment(core.Environment{Locale: "en-US"}))
	ui.WaitFor("id:activities-table", 5*time.Second)
	ui.Press("id:nav:dashboard")
	ui.WaitFor("id:dashboard-recent >> text:2025-03-20", 3*time.Second)
	if ui.Exists("id:dashboard-recent >> text:2025-01-05") {
		t.Fatal("dashboard shows the start date; 1.x shows the end date")
	}
}
