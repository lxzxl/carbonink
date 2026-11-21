package store

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"math"
	"strings"
	"time"
)

// Organization is the single organization a workspace belongs to.
type Organization struct {
	ID           string
	NameZH       string
	NameEN       string
	Industry     string
	CountryCode  string
	BoundaryKind string
	CreatedAt    string
	UpdatedAt    string
}

// Site is one physical location in the organization.
type Site struct {
	ID             string
	OrganizationID string
	NameZH         string
	NameEN         string
	Address        string
	CountryCode    string
	IsActive       bool
	CreatedAt      string
	UpdatedAt      string
}

// ReportingPeriod is one reporting window.
type ReportingPeriod struct {
	ID             string
	OrganizationID string
	Year           int
	Granularity    string
	StartsAt       string
	EndsAt         string
	IsActive       bool
	CreatedAt      string
}

// EmissionSource is a category of activity at one site.
type EmissionSource struct {
	ID              string
	SiteID          string
	SiteName        string
	Name            string
	Scope           int
	Category        string
	GHGProtocolPath string
	DefaultEFQuery  string
	TemplateOrigin  string
	IsActive        bool
	ActivityCount   int
	TotalCO2eKg     float64
	LastActivityAt  string
}

// EmissionFactor is one row of the read-only factor catalog.
type EmissionFactor struct {
	FactorCode      string
	Year            int
	Source          string
	Geography       string
	DatasetVersion  string
	Scope           int
	Category        string
	GHGProtocolPath string
	InputUnit       string
	CO2eKgPerUnit   float64
	CH4KgPerUnit    *float64
	N2OKgPerUnit    *float64
	GWPBasis        string
	NameZH          string
	NameEN          string
	CitationURL     string
}

// EmissionFactorKey is the composite primary key of an emission factor.
type EmissionFactorKey struct {
	FactorCode     string
	Year           int
	Source         string
	Geography      string
	DatasetVersion string
}

// OnboardingInput creates the organization, first site, and first period in
// one transaction.
type OnboardingInput struct {
	Organization OrganizationInput
	Site         SiteInput
	Year         int
}

// OrganizationInput is the editable organization profile.
type OrganizationInput struct {
	NameZH       string
	NameEN       string
	Industry     string
	CountryCode  string
	BoundaryKind string
}

// SiteInput is the editable site profile.
type SiteInput struct {
	OrganizationID string
	NameZH         string
	NameEN         string
	Address        string
	CountryCode    string
}

// PeriodInput creates an annual reporting period.
type PeriodInput struct {
	OrganizationID string
	Year           int
}

// SourceInput is the editable emission-source profile.
type SourceInput struct {
	SiteID          string
	Name            string
	Scope           int
	Category        string
	GHGProtocolPath string
	DefaultEFQuery  string
	TemplateOrigin  string
}

// SourcePatch updates the fields the source editor exposes.
type SourcePatch struct {
	Name            string
	Scope           int
	Category        string
	GHGProtocolPath string
	IsActive        bool
}

// EFFilter narrows the factor catalog.
type EFFilter struct {
	Scope    int
	Category string
	Search   string
	Limit    int
}

// Summary counts the records a workspace contains.
type Summary struct {
	Sites      int
	Periods    int
	Sources    int
	Activities int
}

// CurrentOrganization returns the singleton organization, or nil before
// onboarding.
func (s *Store) CurrentOrganization(ctx context.Context) (*Organization, error) {
	return organizationByQuery(ctx, s.db, `SELECT id, coalesce(name_zh, ''), coalesce(name_en, ''),
		coalesce(industry, ''), country_code, boundary_kind, created_at, updated_at
		FROM organization ORDER BY created_at ASC, id ASC LIMIT 1`)
}

// OrganizationByID reads one organization.
func (s *Store) OrganizationByID(ctx context.Context, id string) (*Organization, error) {
	return organizationByQuery(ctx, s.db, `SELECT id, coalesce(name_zh, ''), coalesce(name_en, ''),
		coalesce(industry, ''), country_code, boundary_kind, created_at, updated_at
		FROM organization WHERE id = ?`, id)
}

func organizationByQuery(ctx context.Context, q queryer, query string, args ...any) (*Organization, error) {
	var o Organization
	err := q.QueryRowContext(ctx, query, args...).Scan(&o.ID, &o.NameZH, &o.NameEN, &o.Industry,
		&o.CountryCode, &o.BoundaryKind, &o.CreatedAt, &o.UpdatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &o, nil
}

// CompleteOnboarding creates the singleton organization, its first site, and
// an annual reporting period atomically.
func (s *Store) CompleteOnboarding(ctx context.Context, in OnboardingInput) (*Organization, *Site, *ReportingPeriod, error) {
	org, err := normalizeOrganization(in.Organization)
	if err != nil {
		return nil, nil, nil, err
	}
	site, err := normalizeSite(in.Site)
	if err != nil {
		return nil, nil, nil, err
	}
	if err := validateYear(in.Year); err != nil {
		return nil, nil, nil, err
	}

	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, nil, nil, err
	}
	defer tx.Rollback()

	var count int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM organization`).Scan(&count); err != nil {
		return nil, nil, nil, err
	}
	if count != 0 {
		return nil, nil, nil, errors.New("organization already exists")
	}
	created, err := insertOrganization(ctx, tx, org)
	if err != nil {
		return nil, nil, nil, err
	}
	site.OrganizationID = created.ID
	createdSite, err := insertSite(ctx, tx, site)
	if err != nil {
		return nil, nil, nil, err
	}
	createdPeriod, err := insertPeriod(ctx, tx, created.ID, in.Year)
	if err != nil {
		return nil, nil, nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, nil, nil, err
	}
	return created, createdSite, createdPeriod, nil
}

// UpdateOrganization replaces the editable organization profile.
func (s *Store) UpdateOrganization(ctx context.Context, id string, in OrganizationInput) error {
	org, err := normalizeOrganization(in)
	if err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, `UPDATE organization
		SET name_zh = ?, name_en = ?, industry = ?, country_code = ?, boundary_kind = ?, updated_at = ?
		WHERE id = ?`, nullIfEmpty(org.NameZH), nullIfEmpty(org.NameEN), nullIfEmpty(org.Industry),
		org.CountryCode, org.BoundaryKind, now(), id)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("organization not found: %s", id)
	}
	return nil
}

// ListSites returns all sites for an organization, active or not.
func (s *Store) ListSites(ctx context.Context, organizationID string) ([]Site, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, organization_id, coalesce(name_zh, ''),
		coalesce(name_en, ''), coalesce(address, ''), country_code, is_active, created_at, updated_at
		FROM site WHERE organization_id = ? ORDER BY created_at ASC, id ASC`, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Site
	for rows.Next() {
		var site Site
		var active int
		if err := rows.Scan(&site.ID, &site.OrganizationID, &site.NameZH, &site.NameEN, &site.Address,
			&site.CountryCode, &active, &site.CreatedAt, &site.UpdatedAt); err != nil {
			return nil, err
		}
		site.IsActive = active == 1
		out = append(out, site)
	}
	return out, rows.Err()
}

// CreateSite adds a site to an organization.
func (s *Store) CreateSite(ctx context.Context, in SiteInput) (*Site, error) {
	site, err := normalizeSite(in)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(site.OrganizationID) == "" {
		return nil, errors.New("organization_id is required")
	}
	return insertSite(ctx, s.db, site)
}

func insertSite(ctx context.Context, q queryer, site SiteInput) (*Site, error) {
	id := newID()
	ts := now()
	_, err := q.ExecContext(ctx, `INSERT INTO site
		(id, organization_id, name_zh, name_en, address, country_code, is_active, created_at, updated_at)
		VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`, id, site.OrganizationID, nullIfEmpty(site.NameZH),
		nullIfEmpty(site.NameEN), nullIfEmpty(site.Address), site.CountryCode, ts, ts)
	if err != nil {
		return nil, err
	}
	return &Site{ID: id, OrganizationID: site.OrganizationID, NameZH: site.NameZH, NameEN: site.NameEN,
		Address: site.Address, CountryCode: site.CountryCode, IsActive: true, CreatedAt: ts, UpdatedAt: ts}, nil
}

// UpdateSite replaces the editable site profile.
func (s *Store) UpdateSite(ctx context.Context, id string, in SiteInput, active bool) error {
	site, err := normalizeSite(in)
	if err != nil {
		return err
	}
	result, err := s.db.ExecContext(ctx, `UPDATE site SET name_zh = ?, name_en = ?, address = ?,
		country_code = ?, is_active = ?, updated_at = ? WHERE id = ?`, nullIfEmpty(site.NameZH),
		nullIfEmpty(site.NameEN), nullIfEmpty(site.Address), site.CountryCode, boolInt(active), now(), id)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("site not found: %s", id)
	}
	return nil
}

// ListPeriods returns an organization's reporting periods, oldest first.
func (s *Store) ListPeriods(ctx context.Context, organizationID string) ([]ReportingPeriod, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT id, organization_id, year, granularity, starts_at,
		ends_at, is_active, created_at FROM reporting_period WHERE organization_id = ?
		ORDER BY year ASC, created_at ASC`, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ReportingPeriod
	for rows.Next() {
		var p ReportingPeriod
		var active int
		if err := rows.Scan(&p.ID, &p.OrganizationID, &p.Year, &p.Granularity, &p.StartsAt,
			&p.EndsAt, &active, &p.CreatedAt); err != nil {
			return nil, err
		}
		p.IsActive = active == 1
		out = append(out, p)
	}
	return out, rows.Err()
}

// CreatePeriod adds an annual reporting period.
func (s *Store) CreatePeriod(ctx context.Context, in PeriodInput) (*ReportingPeriod, error) {
	if strings.TrimSpace(in.OrganizationID) == "" {
		return nil, errors.New("organization_id is required")
	}
	if err := validateYear(in.Year); err != nil {
		return nil, err
	}
	return insertPeriod(ctx, s.db, in.OrganizationID, in.Year)
}

func insertPeriod(ctx context.Context, q queryer, organizationID string, year int) (*ReportingPeriod, error) {
	id := newID()
	ts := now()
	starts := fmt.Sprintf("%04d-01-01T00:00:00.000Z", year)
	ends := fmt.Sprintf("%04d-12-31T23:59:59.999Z", year)
	_, err := q.ExecContext(ctx, `INSERT INTO reporting_period
		(id, organization_id, year, granularity, starts_at, ends_at, is_active, created_at)
		VALUES (?, ?, ?, 'annual', ?, ?, 1, ?)`, id, organizationID, year, starts, ends, ts)
	if err != nil {
		return nil, err
	}
	return &ReportingPeriod{ID: id, OrganizationID: organizationID, Year: year, Granularity: "annual",
		StartsAt: starts, EndsAt: ends, IsActive: true, CreatedAt: ts}, nil
}

// UpdatePeriod changes the year and active flag. The stored date bounds follow
// the year so an edited period cannot keep inconsistent bounds.
func (s *Store) UpdatePeriod(ctx context.Context, id string, year int, active bool) error {
	if err := validateYear(year); err != nil {
		return err
	}
	starts := fmt.Sprintf("%04d-01-01T00:00:00.000Z", year)
	ends := fmt.Sprintf("%04d-12-31T23:59:59.999Z", year)
	result, err := s.db.ExecContext(ctx, `UPDATE reporting_period
		SET year = ?, starts_at = ?, ends_at = ?, is_active = ? WHERE id = ?`, year, starts, ends, boolInt(active), id)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("reporting period not found: %s", id)
	}
	return nil
}

// ListSources returns every source in an organization, with usage stats.
func (s *Store) ListSources(ctx context.Context, organizationID string) ([]EmissionSource, error) {
	rows, err := s.db.QueryContext(ctx, `SELECT es.id, es.site_id,
			coalesce(nullif(site.name_zh, ''), nullif(site.name_en, ''), ''),
			es.name, es.scope, coalesce(es.category, ''), coalesce(es.ghg_protocol_path, ''),
			coalesce(es.default_ef_query, ''), coalesce(es.template_origin, ''), es.is_active,
			coalesce(stats.cnt, 0), coalesce(stats.total_co2e, 0), coalesce(stats.last_at, '')
		FROM emission_source es
		JOIN site ON site.id = es.site_id
		LEFT JOIN (
			SELECT emission_source_id, count(*) AS cnt, sum(computed_co2e_kg) AS total_co2e,
			       max(occurred_at_end) AS last_at
			FROM activity_data GROUP BY emission_source_id
		) stats ON stats.emission_source_id = es.id
		WHERE site.organization_id = ?
		ORDER BY es.scope ASC, es.name ASC, es.id ASC`, organizationID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EmissionSource
	for rows.Next() {
		var src EmissionSource
		var active int
		if err := rows.Scan(&src.ID, &src.SiteID, &src.SiteName, &src.Name, &src.Scope, &src.Category,
			&src.GHGProtocolPath, &src.DefaultEFQuery, &src.TemplateOrigin, &active, &src.ActivityCount,
			&src.TotalCO2eKg, &src.LastActivityAt); err != nil {
			return nil, err
		}
		src.IsActive = active == 1
		out = append(out, src)
	}
	return out, rows.Err()
}

// CreateSource adds an emission source.
func (s *Store) CreateSource(ctx context.Context, in SourceInput) (*EmissionSource, error) {
	src, err := normalizeSource(in)
	if err != nil {
		return nil, err
	}
	id := newID()
	_, err = s.db.ExecContext(ctx, `INSERT INTO emission_source
		(id, site_id, name, scope, category, ghg_protocol_path, default_ef_query, template_origin, is_active)
		VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`, id, src.SiteID, src.Name, src.Scope,
		nullIfEmpty(src.Category), nullIfEmpty(src.GHGProtocolPath), nullIfEmpty(src.DefaultEFQuery),
		nullIfEmpty(src.TemplateOrigin))
	if err != nil {
		return nil, err
	}
	return s.sourceByID(ctx, id)
}

// UpdateSource replaces the editable source fields.
func (s *Store) UpdateSource(ctx context.Context, id string, in SourcePatch) error {
	name := strings.TrimSpace(in.Name)
	if name == "" {
		return errors.New("source name is required")
	}
	if len(name) > 200 {
		return errors.New("source name is too long")
	}
	if in.Scope < 1 || in.Scope > 3 {
		return errors.New("scope must be 1, 2, or 3")
	}
	result, err := s.db.ExecContext(ctx, `UPDATE emission_source SET name = ?, scope = ?,
		category = ?, ghg_protocol_path = ?, is_active = ? WHERE id = ?`, name, in.Scope,
		nullIfEmpty(in.Category), nullIfEmpty(in.GHGProtocolPath), boolInt(in.IsActive), id)
	if err != nil {
		return err
	}
	n, _ := result.RowsAffected()
	if n == 0 {
		return fmt.Errorf("emission source not found: %s", id)
	}
	return nil
}

func (s *Store) sourceByID(ctx context.Context, id string) (*EmissionSource, error) {
	var src EmissionSource
	var active int
	err := s.db.QueryRowContext(ctx, `SELECT es.id, es.site_id,
			coalesce(nullif(site.name_zh, ''), nullif(site.name_en, ''), ''),
			es.name, es.scope, coalesce(es.category, ''), coalesce(es.ghg_protocol_path, ''),
			coalesce(es.default_ef_query, ''), coalesce(es.template_origin, ''), es.is_active
		FROM emission_source es JOIN site ON site.id = es.site_id WHERE es.id = ?`, id).
		Scan(&src.ID, &src.SiteID, &src.SiteName, &src.Name, &src.Scope, &src.Category,
			&src.GHGProtocolPath, &src.DefaultEFQuery, &src.TemplateOrigin, &active)
	if errors.Is(err, sql.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	src.IsActive = active == 1
	return &src, nil
}

// ListEmissionFactors returns factors matching the filter, newest first.
func (s *Store) ListEmissionFactors(ctx context.Context, f EFFilter) ([]EmissionFactor, error) {
	limit := f.Limit
	if limit <= 0 || limit > 500 {
		limit = 100
	}
	clauses := []string{"1 = 1"}
	args := []any{}
	if f.Scope >= 1 && f.Scope <= 3 {
		clauses = append(clauses, "scope = ?")
		args = append(args, f.Scope)
	}
	if category := strings.TrimSpace(f.Category); category != "" {
		clauses = append(clauses, "(category = ? OR category LIKE ?)")
		args = append(args, category, category+".%")
	}
	if search := strings.TrimSpace(f.Search); search != "" {
		like := "%" + strings.ToLower(search) + "%"
		clauses = append(clauses, `(lower(coalesce(name_zh, '')) LIKE ? OR lower(coalesce(name_en, '')) LIKE ?
			OR lower(factor_code) LIKE ?)`)
		args = append(args, like, like, like)
	}
	args = append(args, limit)
	rows, err := s.db.QueryContext(ctx, `SELECT factor_code, year, source, geography, dataset_version,
			scope, coalesce(category, ''), coalesce(ghg_protocol_path, ''), input_unit, co2e_kg_per_unit,
			ch4_kg_per_unit, n2o_kg_per_unit, gwp_basis, coalesce(name_zh, ''), coalesce(name_en, ''),
			coalesce(citation_url, '')
		FROM emission_factor WHERE `+strings.Join(clauses, " AND ")+`
		ORDER BY factor_code ASC, year DESC LIMIT ?`, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []EmissionFactor
	for rows.Next() {
		ef, err := scanEmissionFactor(rows)
		if err != nil {
			return nil, err
		}
		out = append(out, ef)
	}
	return out, rows.Err()
}

// EmissionFactorByKey reads one factor by its composite key.
func (s *Store) EmissionFactorByKey(ctx context.Context, key EmissionFactorKey) (*EmissionFactor, error) {
	return emissionFactorByKey(ctx, s.db, key)
}

func emissionFactorByKey(ctx context.Context, q queryer, key EmissionFactorKey) (*EmissionFactor, error) {
	const columns = `factor_code, year, source, geography, dataset_version,
			scope, coalesce(category, ''), coalesce(ghg_protocol_path, ''), input_unit, co2e_kg_per_unit,
			ch4_kg_per_unit, n2o_kg_per_unit, gwp_basis, coalesce(name_zh, ''), coalesce(name_en, ''),
			coalesce(citation_url, '')`
	const match = `factor_code = ? AND year = ? AND source = ? AND geography = ? AND dataset_version = ?`
	args := []any{key.FactorCode, key.Year, key.Source, key.Geography, key.DatasetVersion}
	row := q.QueryRowContext(ctx, `SELECT `+columns+` FROM emission_factor WHERE `+match, args...)
	ef, err := scanEmissionFactor(row)
	if errors.Is(err, sql.ErrNoRows) {
		// A ledger row may keep a factor that has since left the catalog. The
		// pinned snapshot is the immutable copy the calculation used, so edits
		// and rebinds can still resolve it.
		row = q.QueryRowContext(ctx, `SELECT `+columns+` FROM pinned_emission_factor WHERE `+match, args...)
		ef, err = scanEmissionFactor(row)
		if errors.Is(err, sql.ErrNoRows) {
			return nil, nil
		}
	}
	if err != nil {
		return nil, err
	}
	return &ef, nil
}

type rowScanner interface {
	Scan(dest ...any) error
}

func scanEmissionFactor(row rowScanner) (EmissionFactor, error) {
	var ef EmissionFactor
	var ch4, n2o sql.NullFloat64
	err := row.Scan(&ef.FactorCode, &ef.Year, &ef.Source, &ef.Geography, &ef.DatasetVersion,
		&ef.Scope, &ef.Category, &ef.GHGProtocolPath, &ef.InputUnit, &ef.CO2eKgPerUnit, &ch4, &n2o,
		&ef.GWPBasis, &ef.NameZH, &ef.NameEN, &ef.CitationURL)
	if err != nil {
		return ef, err
	}
	if ch4.Valid {
		v := ch4.Float64
		ef.CH4KgPerUnit = &v
	}
	if n2o.Valid {
		v := n2o.Float64
		ef.N2OKgPerUnit = &v
	}
	return ef, nil
}

// Summary counts the workspace's records.
func (s *Store) Summary(ctx context.Context, organizationID string) (Summary, error) {
	var out Summary
	err := s.db.QueryRowContext(ctx, `SELECT
		(SELECT count(*) FROM site WHERE organization_id = ?),
		(SELECT count(*) FROM reporting_period WHERE organization_id = ?),
		(SELECT count(*) FROM emission_source es JOIN site ON site.id = es.site_id
			WHERE site.organization_id = ?),
		(SELECT count(*) FROM activity_data ad JOIN site ON site.id = ad.site_id
			WHERE site.organization_id = ?)`, organizationID, organizationID, organizationID, organizationID).
		Scan(&out.Sites, &out.Periods, &out.Sources, &out.Activities)
	return out, err
}

func normalizeOrganization(in OrganizationInput) (OrganizationInput, error) {
	out := OrganizationInput{
		NameZH:       strings.TrimSpace(in.NameZH),
		NameEN:       strings.TrimSpace(in.NameEN),
		Industry:     strings.TrimSpace(in.Industry),
		CountryCode:  strings.ToUpper(strings.TrimSpace(in.CountryCode)),
		BoundaryKind: strings.TrimSpace(in.BoundaryKind),
	}
	if out.NameZH == "" && out.NameEN == "" {
		return out, errors.New("organization name is required")
	}
	if len([]rune(out.NameZH)) > 255 || len([]rune(out.NameEN)) > 255 {
		return out, errors.New("organization name is too long")
	}
	if len([]rune(out.Industry)) > 100 {
		return out, errors.New("industry is too long")
	}
	if len(out.CountryCode) < 2 || len(out.CountryCode) > 3 {
		return out, errors.New("country code must be 2 or 3 letters")
	}
	if out.BoundaryKind != "equity_share" && out.BoundaryKind != "operational_control" {
		return out, errors.New("boundary must be equity_share or operational_control")
	}
	return out, nil
}

func insertOrganization(ctx context.Context, q queryer, in OrganizationInput) (*Organization, error) {
	id := newID()
	ts := now()
	_, err := q.ExecContext(ctx, `INSERT INTO organization
		(id, singleton_key, name_zh, name_en, industry, country_code, boundary_kind, created_at, updated_at)
		VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?)`, id, nullIfEmpty(in.NameZH), nullIfEmpty(in.NameEN),
		nullIfEmpty(in.Industry), in.CountryCode, in.BoundaryKind, ts, ts)
	if err != nil {
		return nil, err
	}
	return &Organization{ID: id, NameZH: in.NameZH, NameEN: in.NameEN, Industry: in.Industry,
		CountryCode: in.CountryCode, BoundaryKind: in.BoundaryKind, CreatedAt: ts, UpdatedAt: ts}, nil
}

func normalizeSite(in SiteInput) (SiteInput, error) {
	out := SiteInput{
		OrganizationID: strings.TrimSpace(in.OrganizationID),
		NameZH:         strings.TrimSpace(in.NameZH),
		NameEN:         strings.TrimSpace(in.NameEN),
		Address:        strings.TrimSpace(in.Address),
		CountryCode:    strings.ToUpper(strings.TrimSpace(in.CountryCode)),
	}
	if out.NameZH == "" && out.NameEN == "" {
		return out, errors.New("site name is required")
	}
	if len([]rune(out.NameZH)) > 255 || len([]rune(out.NameEN)) > 255 {
		return out, errors.New("site name is too long")
	}
	if len([]rune(out.Address)) > 500 {
		return out, errors.New("site address is too long")
	}
	if len(out.CountryCode) < 2 || len(out.CountryCode) > 3 {
		return out, errors.New("country code must be 2 or 3 letters")
	}
	return out, nil
}

func normalizeSource(in SourceInput) (SourceInput, error) {
	out := SourceInput{
		SiteID:          strings.TrimSpace(in.SiteID),
		Name:            strings.TrimSpace(in.Name),
		Scope:           in.Scope,
		Category:        strings.TrimSpace(in.Category),
		GHGProtocolPath: strings.TrimSpace(in.GHGProtocolPath),
		DefaultEFQuery:  strings.TrimSpace(in.DefaultEFQuery),
		TemplateOrigin:  strings.TrimSpace(in.TemplateOrigin),
	}
	if out.SiteID == "" {
		return out, errors.New("site_id is required")
	}
	if out.Name == "" {
		return out, errors.New("source name is required")
	}
	if len([]rune(out.Name)) > 200 {
		return out, errors.New("source name is too long")
	}
	if out.Scope < 1 || out.Scope > 3 {
		return out, errors.New("scope must be 1, 2, or 3")
	}
	if len([]rune(out.Category)) > 255 || len([]rune(out.GHGProtocolPath)) > 500 {
		return out, errors.New("source classification is too long")
	}
	if len(out.DefaultEFQuery) > 2000 {
		return out, errors.New("default EF query is too long")
	}
	return out, nil
}

func validateYear(year int) error {
	if year < 2020 || year > 2030 {
		return errors.New("year must be between 2020 and 2030")
	}
	return nil
}

func validFinite(v float64) bool { return !math.IsNaN(v) && !math.IsInf(v, 0) }

func nullIfEmpty(s string) any {
	if strings.TrimSpace(s) == "" {
		return nil
	}
	return s
}

func boolInt(v bool) int {
	if v {
		return 1
	}
	return 0
}

func newID() string {
	var raw [16]byte
	ms := uint64(time.Now().UTC().UnixMilli())
	for i := 5; i >= 0; i-- {
		raw[i] = byte(ms)
		ms >>= 8
	}
	_, _ = randRead(raw[6:])
	return crockford.EncodeToString(raw[:])
}

type queryer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
	QueryRowContext(context.Context, string, ...any) *sql.Row
}
