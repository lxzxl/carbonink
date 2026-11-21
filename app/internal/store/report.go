package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
)

// ReportData is everything the ISO 14064-1 and TCFD reports print.
type ReportData struct {
	Organization ReportOrganization
	Period       ReportPeriod
	Sites        []ReportSite
	Totals       ReportTotals
	Sources      []ReportSource
	Activities   []ReportActivity
	EFSources    []ReportEFSource
	PriorPeriod  *ReportYearTotal
	BaseYear     *ReportYearTotal
	Significant  string
}

// ReportOrganization is the reporting entity's profile.
type ReportOrganization struct {
	ID              string
	NameZH          string
	NameEN          string
	Industry        string
	CountryCode     string
	BoundaryKind    string
	Responsible     string
	ResponsibleRole string
}

// ReportPeriod is the inventory year.
type ReportPeriod struct {
	ID    string
	Year  int
	Start string
	End   string
}

// ReportSite is one active site in the boundary.
type ReportSite struct {
	ID      string
	NameZH  string
	NameEN  string
	Address string
}

// ReportTotals aggregates computed CO2e by scope.
type ReportTotals struct {
	Scope1Kg float64
	Scope2Kg float64
	Scope3Kg float64
	TotalKg  float64
}

// ReportSource is one emission source's share of the inventory.
type ReportSource struct {
	Name     string
	Scope    int
	CO2eKg   float64
	SharePct float64
}

// ReportActivity is one ledger row in the appendix.
type ReportActivity struct {
	ID       string
	Site     string
	Source   string
	Scope    int
	Amount   float64
	Unit     string
	CO2eKg   float64
	EFSource string
	EFYear   int
	Notes    string
	GWPBasis string
}

// ReportEFSource counts the pinned factors the inventory used.
type ReportEFSource struct {
	Source   string
	Count    int
	GWPBasis string
}

// ReportYearTotal is a comparison year's headline.
type ReportYearTotal struct {
	Year    int
	TotalKg float64
}

// ReportInventory assembles the report inputs for one reporting period.
func (s *Store) ReportInventory(ctx context.Context, periodID string) (*ReportData, error) {
	data := &ReportData{}
	var orgID string
	var significant sql.NullString
	err := s.db.QueryRowContext(ctx, `SELECT id, organization_id, year, starts_at, ends_at,
			significant_changes_text
		FROM reporting_period WHERE id = ?`, periodID).
		Scan(&data.Period.ID, &orgID, &data.Period.Year, &data.Period.Start, &data.Period.End,
			&significant)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, fmt.Errorf("reporting period not found: %s", periodID)
	}
	if err != nil {
		return nil, err
	}
	data.Significant = significant.String

	var baseYearID sql.NullString
	err = s.db.QueryRowContext(ctx, `SELECT id, coalesce(name_zh, ''), coalesce(name_en, ''),
			coalesce(industry, ''), country_code, boundary_kind,
			coalesce(responsible_person_name, ''), coalesce(responsible_person_role, ''),
			base_year_period_id
		FROM organization WHERE id = ?`, orgID).
		Scan(&data.Organization.ID, &data.Organization.NameZH, &data.Organization.NameEN,
			&data.Organization.Industry, &data.Organization.CountryCode,
			&data.Organization.BoundaryKind, &data.Organization.Responsible,
			&data.Organization.ResponsibleRole, &baseYearID)
	if err != nil {
		return nil, err
	}

	rows, err := s.db.QueryContext(ctx, `SELECT id, coalesce(name_zh, ''), coalesce(name_en, ''),
			coalesce(address, '')
		FROM site WHERE organization_id = ? AND is_active = 1 ORDER BY created_at`, orgID)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var site ReportSite
		if err := rows.Scan(&site.ID, &site.NameZH, &site.NameEN, &site.Address); err != nil {
			rows.Close()
			return nil, err
		}
		data.Sites = append(data.Sites, site)
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	const activityQuery = `SELECT a.id, coalesce(nullif(site.name_zh, ''),
			nullif(site.name_en, ''), ''), es.name, es.scope, a.amount, a.unit,
			a.computed_co2e_kg, a.ef_source, a.ef_year, coalesce(a.notes, ''),
			coalesce(pef.gwp_basis, '')
		FROM activity_data a
		JOIN emission_source es ON es.id = a.emission_source_id AND es.site_id = a.site_id
		LEFT JOIN site ON site.id = a.site_id
		LEFT JOIN pinned_emission_factor pef
		  ON pef.factor_code = a.ef_factor_code
		 AND pef.year = a.ef_year
		 AND pef.source = a.ef_source
		 AND pef.geography = a.ef_geography
		 AND pef.dataset_version = a.ef_dataset_version
		WHERE a.reporting_period_id = ?
		ORDER BY es.scope, es.name, a.computed_at, a.id`
	rows, err = s.db.QueryContext(ctx, activityQuery, periodID)
	if err != nil {
		return nil, err
	}
	efCounts := map[string]int{}
	efBasis := map[string]string{}
	for rows.Next() {
		var a ReportActivity
		if err := rows.Scan(&a.ID, &a.Site, &a.Source, &a.Scope, &a.Amount, &a.Unit,
			&a.CO2eKg, &a.EFSource, &a.EFYear, &a.Notes, &a.GWPBasis); err != nil {
			rows.Close()
			return nil, err
		}
		data.Activities = append(data.Activities, a)
		switch a.Scope {
		case 1:
			data.Totals.Scope1Kg += a.CO2eKg
		case 2:
			data.Totals.Scope2Kg += a.CO2eKg
		case 3:
			data.Totals.Scope3Kg += a.CO2eKg
		}
		data.Totals.TotalKg += a.CO2eKg
		efCounts[a.EFSource]++
		if a.GWPBasis != "" {
			efBasis[a.EFSource] = a.GWPBasis
		}
	}
	if err := rows.Close(); err != nil {
		return nil, err
	}

	sourceTotals := map[string]*ReportSource{}
	for _, a := range data.Activities {
		key := a.Source + "\x00" + fmt.Sprint(a.Scope)
		source, ok := sourceTotals[key]
		if !ok {
			source = &ReportSource{Name: a.Source, Scope: a.Scope}
			sourceTotals[key] = source
		}
		source.CO2eKg += a.CO2eKg
	}
	for _, source := range sourceTotals {
		if data.Totals.TotalKg > 0 {
			source.SharePct = source.CO2eKg / data.Totals.TotalKg * 100
		}
		data.Sources = append(data.Sources, *source)
	}
	sortReportSources(data.Sources)
	for source, count := range efCounts {
		data.EFSources = append(data.EFSources,
			ReportEFSource{Source: source, Count: count, GWPBasis: efBasis[source]})
	}
	sortEFSources(data.EFSources)

	if prior, err := s.yearTotal(ctx, orgID, data.Period.Year-1); err != nil {
		return nil, err
	} else {
		data.PriorPeriod = prior
	}
	if baseYearID.Valid && baseYearID.String != "" {
		if base, err := s.yearTotalByID(ctx, baseYearID.String); err != nil {
			return nil, err
		} else {
			data.BaseYear = base
		}
	}
	return data, nil
}

func (s *Store) yearTotal(ctx context.Context, orgID string, year int) (*ReportYearTotal, error) {
	var periodID string
	err := s.db.QueryRowContext(ctx, `SELECT id FROM reporting_period
		WHERE organization_id = ? AND year = ? ORDER BY created_at LIMIT 1`, orgID, year).
		Scan(&periodID)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return s.yearTotalByID(ctx, periodID)
}

func (s *Store) yearTotalByID(ctx context.Context, periodID string) (*ReportYearTotal, error) {
	var total ReportYearTotal
	var year int
	err := s.db.QueryRowContext(ctx, `SELECT year FROM reporting_period WHERE id = ?`, periodID).
		Scan(&year)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	total.Year = year
	if err := s.db.QueryRowContext(ctx, `SELECT coalesce(sum(computed_co2e_kg), 0)
		FROM activity_data WHERE reporting_period_id = ?`, periodID).Scan(&total.TotalKg); err != nil {
		return nil, err
	}
	return &total, nil
}

func sortReportSources(sources []ReportSource) {
	for i := 1; i < len(sources); i++ {
		for j := i; j > 0 && sources[j].CO2eKg > sources[j-1].CO2eKg; j-- {
			sources[j], sources[j-1] = sources[j-1], sources[j]
		}
	}
}

func sortEFSources(sources []ReportEFSource) {
	for i := 1; i < len(sources); i++ {
		for j := i; j > 0 && sources[j].Source < sources[j-1].Source; j-- {
			sources[j], sources[j-1] = sources[j-1], sources[j]
		}
	}
}
