// Package readiness runs the deterministic inventory checks behind the report
// page's readiness review. Rules are read-only: they inspect one reporting
// period and return findings, never repair anything.
package readiness

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"sort"
	"strconv"
	"strings"
	"time"

	"app.carbonink.desktop/internal/store"
)

// Severity says how much an auditor would care.
type Severity string

const (
	SeverityBlocker Severity = "blocker"
	SeverityWarning Severity = "warning"
	SeverityInfo    Severity = "info"
)

// Entity is the row a finding points at, for the report page's fix link.
type Entity struct {
	Type string
	ID   string
}

// Finding is one checklist result. Facts are raw values for the renderer to
// interpolate; they never contain free-form prompt or answer text.
type Finding struct {
	CheckID  string
	Severity Severity
	Entity   Entity
	Facts    map[string]any
}

// Key is the stable dismissal identity: check + entity, not the facts, so a
// changed number does not resurrect a dismissal.
func (f Finding) Key() string {
	return f.CheckID + ":" + f.Entity.Type + ":" + f.Entity.ID
}

// Counts summarizes a report by severity.
type Counts struct {
	Blocker int
	Warning int
	Info    int
}

// Report is the outcome of one sweep.
type Report struct {
	Findings       []Finding
	Counts         Counts
	DismissedCount int
	CheckedAt      string
}

// CheckCount is the number of deterministic rules. The report page uses it
// for the "all checks passed" copy.
const CheckCount = 14

// DismissedSetting stores the per-workspace dismissed finding keys as JSON.
const DismissedSetting = "readiness.dismissed"

// Options carries the inputs the rules need from outside the ledger.
type Options struct {
	// Now is the sweep's timestamp; the zero value means time.Now().
	Now time.Time
	// ImportOutlierRatio is the per-workspace N2 multiplier. Values outside
	// the settings range fall back to 10.
	ImportOutlierRatio float64
}

type period struct {
	ID             string
	OrganizationID string
	Year           int
	StartsAt       string
	EndsAt         string
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}

type check func(context.Context, queryer, period, Options) ([]Finding, error)

var checks = []check{
	c1SourceWithoutActivity,
	c3ActivityOutsidePeriod,
	c5QuestionWithoutAnswer,
	n1UnitDimensionMismatch,
	n2AmountOutlier,
	n3SuspectedDuplicate,
	n5MixedGwpBasis,
	t1ActivityWithoutEvidence,
	t2ActivityWithoutAuditTrail,
	t3StaleEfVintage,
	t4OrphanedUserLibraryFactor,
	d1NoBaseYear,
	d2SnapshotDivergedFromLedger,
	d3OverdueSupplierDisclosure,
}

// Run sweeps one reporting period. A rule that cannot evaluate is skipped,
// so one bad query never takes down the checklist.
func Run(ctx context.Context, db *store.Store, periodID string, opts Options) (Report, error) {
	if opts.Now.IsZero() {
		opts.Now = time.Now()
	}
	if opts.ImportOutlierRatio <= 0 {
		opts.ImportOutlierRatio = 10
	}
	checkedAt := opts.Now.UTC().Format(time.RFC3339Nano)
	current, err := loadPeriod(ctx, db.DB(), periodID)
	if err != nil {
		return Report{}, err
	}
	if current == nil {
		return Report{CheckedAt: checkedAt}, nil
	}

	raw := make([]Finding, 0)
	for _, rule := range checks {
		found, err := rule(ctx, db.DB(), *current, opts)
		if err != nil {
			continue
		}
		raw = append(raw, found...)
	}

	dismissed, err := DismissedKeys(ctx, db)
	if err != nil {
		return Report{}, err
	}
	findings := make([]Finding, 0, len(raw))
	for _, finding := range raw {
		if _, skip := dismissed[finding.Key()]; skip {
			continue
		}
		findings = append(findings, finding)
	}
	sort.SliceStable(findings, func(i, j int) bool {
		if severityRank(findings[i].Severity) != severityRank(findings[j].Severity) {
			return severityRank(findings[i].Severity) < severityRank(findings[j].Severity)
		}
		if findings[i].CheckID != findings[j].CheckID {
			return findings[i].CheckID < findings[j].CheckID
		}
		return findings[i].Entity.ID < findings[j].Entity.ID
	})
	counts := Counts{}
	for _, finding := range findings {
		switch finding.Severity {
		case SeverityBlocker:
			counts.Blocker++
		case SeverityWarning:
			counts.Warning++
		case SeverityInfo:
			counts.Info++
		}
	}

	// Audit payload discipline: counts only, never row lists or free text.
	if err := db.RecordAuditEvent(ctx, "readiness.reviewed", map[string]any{
		"reporting_period_id": current.ID,
		"year":                current.Year,
		"blocker_count":       counts.Blocker,
		"warning_count":       counts.Warning,
		"info_count":          counts.Info,
		"dismissed_count":     len(raw) - len(findings),
		"check_count":         len(checks),
	}); err != nil {
		return Report{}, err
	}
	return Report{
		Findings:       findings,
		Counts:         counts,
		DismissedCount: len(raw) - len(findings),
		CheckedAt:      checkedAt,
	}, nil
}

// Dismiss suppresses a finding key. The setting is a per-workspace
// preference, so it lives in `setting` rather than a table.
func Dismiss(ctx context.Context, db *store.Store, key string) error {
	keys, err := DismissedKeys(ctx, db)
	if err != nil {
		return err
	}
	if _, ok := keys[key]; ok {
		return nil
	}
	keys[key] = struct{}{}
	return writeDismissed(ctx, db, keys)
}

// Undismiss restores a suppressed finding.
func Undismiss(ctx context.Context, db *store.Store, key string) error {
	keys, err := DismissedKeys(ctx, db)
	if err != nil {
		return err
	}
	if _, ok := keys[key]; !ok {
		return nil
	}
	delete(keys, key)
	return writeDismissed(ctx, db, keys)
}

// DismissedKeys reads the suppression set. A hand-edited or malformed value
// means nothing is dismissed rather than making the sweep unreachable.
func DismissedKeys(ctx context.Context, db *store.Store) (map[string]struct{}, error) {
	value, ok, err := db.Setting(ctx, DismissedSetting)
	if err != nil {
		return nil, err
	}
	if !ok || strings.TrimSpace(value) == "" {
		return map[string]struct{}{}, nil
	}
	var list []string
	if err := json.Unmarshal([]byte(value), &list); err != nil {
		return map[string]struct{}{}, nil
	}
	keys := make(map[string]struct{}, len(list))
	for _, key := range list {
		if key = strings.TrimSpace(key); key != "" {
			keys[key] = struct{}{}
		}
	}
	return keys, nil
}

func writeDismissed(ctx context.Context, db *store.Store, keys map[string]struct{}) error {
	list := make([]string, 0, len(keys))
	for key := range keys {
		list = append(list, key)
	}
	sort.Strings(list)
	encoded, err := json.Marshal(list)
	if err != nil {
		return err
	}
	return db.SetSetting(ctx, DismissedSetting, string(encoded))
}

func loadPeriod(ctx context.Context, db queryer, id string) (*period, error) {
	var out period
	err := db.QueryRowContext(ctx, `SELECT id, organization_id, year, starts_at, ends_at
		FROM reporting_period WHERE id = ?`, id).
		Scan(&out.ID, &out.OrganizationID, &out.Year, &out.StartsAt, &out.EndsAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &out, nil
}

func severityRank(value Severity) int {
	switch value {
	case SeverityBlocker:
		return 0
	case SeverityWarning:
		return 1
	default:
		return 2
	}
}

func factText(value any) string {
	switch v := value.(type) {
	case string:
		return v
	case float64:
		return strconv.FormatFloat(v, 'f', -1, 64)
	case int:
		return strconv.Itoa(v)
	default:
		return fmt.Sprint(value)
	}
}
