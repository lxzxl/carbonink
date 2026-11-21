package activityimport

import (
	"encoding/json"
	"sort"
	"strconv"
	"strings"
)

const (
	// OutlierRatio flags rows more than this factor away from the group median.
	OutlierRatio = 10.0
	// OutlierMinGroupSize is the smallest group a median is trusted for.
	OutlierMinGroupSize = 5
)

// ResolvedRow is a valid row whose source name now points at a real source.
type ResolvedRow struct {
	ValidRow
	SourceID string
}

// Group is one human EF decision: rows sharing description, unit, and source.
type Group struct {
	Key         string
	Description string
	Unit        string
	SourceID    string
	SourceName  string
	RowCount    int
	AmountTotal float64
	Rows        []ResolvedRow
}

// NormalizeDescription is deliberately conservative: lower-case and collapse
// whitespace. The stored activity keeps the user's raw text.
func NormalizeDescription(text string) string {
	return strings.Join(strings.Fields(strings.ToLower(text)), " ")
}

// GroupKey is a stable opaque key for (description, unit, source).
func GroupKey(description, unit, sourceID string) string {
	key, _ := json.Marshal([]string{
		NormalizeDescription(description), strings.ToLower(unit), sourceID,
	})
	return string(key)
}

// BuildGroups folds resolved rows into confirmation units, preserving first
// occurrence order.
func BuildGroups(rows []ResolvedRow, sourceNameOf func(string) string) []Group {
	groups := make([]Group, 0)
	index := make(map[string]int)
	for _, row := range rows {
		key := GroupKey(row.Description, row.Unit, row.SourceID)
		if at, ok := index[key]; ok {
			groups[at].RowCount++
			groups[at].AmountTotal += row.Amount
			groups[at].Rows = append(groups[at].Rows, row)
			continue
		}
		index[key] = len(groups)
		groups = append(groups, Group{
			Key: key, Description: row.Description, Unit: row.Unit,
			SourceID: row.SourceID, SourceName: sourceNameOf(row.SourceID),
			RowCount: 1, AmountTotal: row.Amount, Rows: []ResolvedRow{row},
		})
	}
	return groups
}

// DetectOutliers flags rows more than ratio× away from their group's median in
// either direction. Groups below OutlierMinGroupSize are skipped. Warnings
// only; nothing is blocked.
func DetectOutliers(rows []ResolvedRow, ratio float64) []Issue {
	if ratio <= 0 {
		ratio = OutlierRatio
	}
	buckets := make(map[string][]ResolvedRow)
	var order []string
	for _, row := range rows {
		key := GroupKey(row.Description, row.Unit, row.SourceID)
		if _, ok := buckets[key]; !ok {
			order = append(order, key)
		}
		buckets[key] = append(buckets[key], row)
	}
	var issues []Issue
	for _, key := range order {
		bucket := buckets[key]
		if len(bucket) < OutlierMinGroupSize {
			continue
		}
		amounts := make([]float64, len(bucket))
		for i, row := range bucket {
			amounts[i] = row.Amount
		}
		sort.Float64s(amounts)
		mid := len(amounts) / 2
		median := amounts[mid]
		if len(amounts)%2 == 0 {
			median = (amounts[mid-1] + amounts[mid]) / 2
		}
		if median <= 0 {
			continue
		}
		for _, row := range bucket {
			if row.Amount > median*ratio || row.Amount < median/ratio {
				issues = append(issues, Issue{Row: row.Row, Code: "amount_outlier",
					Detail: formatAmount(row.Amount) + " vs " + formatAmount(median)})
			}
		}
	}
	sort.Slice(issues, func(i, j int) bool { return issues[i].Row < issues[j].Row })
	return issues
}

func formatAmount(v float64) string {
	return strconv.FormatFloat(v, 'f', -1, 64)
}
