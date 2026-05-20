import type Database from 'better-sqlite3';

export interface ReportDataDeps {
  db: Database.Database;
}

export interface InventoryReportData {
  org: {
    id: string;
    name_zh: string | null;
    name_en: string | null;
    industry: string | null;
    country_code: string;
    boundary_kind: 'equity_share' | 'financial_control' | 'operational_control';
    responsible: { name: string | null; role: string | null };
  };
  period: {
    id: string;
    year: number;
    granularity: 'annual' | 'quarterly' | 'monthly';
    start: string;
    end: string;
    is_base_year: boolean;
    significant_changes_text: string | null;
  };
  sites: Array<{
    id: string;
    name_zh: string | null;
    name_en: string | null;
    address: string | null;
  }>;
  scope_totals: {
    scope1_kg: number;
    scope2_kg: number;
    scope3_kg: number;
    total_kg: number;
    /** Biogenic CO2 reported separately per 14064-1 §6.4.7. */
    biogenic_kg: number;
  };
  all_sources: Array<{
    id: string;
    name: string;
    scope: 1 | 2 | 3;
    co2e_kg: number;
    share_pct: number;
  }>;
  /** Every activity row — used by the Excel appendix's "Activities" sheet
   *  and shown to the LLM (which is instructed to use aggregates only). */
  activities: Array<{
    id: string;
    site_name: string | null;
    source_name: string;
    scope: 1 | 2 | 3;
    amount: number;
    unit: string;
    pinned_ef_source: string;
    co2e_kg: number;
  }>;
  ef_sources_used: Array<{ source: string; count: number; gwp_basis: 'AR5' | 'AR6' }>;
  language: 'zh-CN' | 'en';
  prior_period_summary: { year: number; total_kg: number } | null;
  base_year_summary: { year: number; total_kg: number } | null;
}

export class ReportDataService {
  constructor(private deps: ReportDataDeps) {}

  assembleReportData(input: {
    reporting_period_id: string;
    language: 'zh-CN' | 'en';
  }): InventoryReportData {
    const period = this.deps.db
      .prepare(
        `SELECT id, organization_id, year, granularity, starts_at, ends_at,
                significant_changes_text
           FROM reporting_period WHERE id = ?`,
      )
      .get(input.reporting_period_id) as
      | undefined
      | {
          id: string;
          organization_id: string;
          year: number;
          granularity: 'annual' | 'quarterly' | 'monthly';
          starts_at: string;
          ends_at: string;
          significant_changes_text: string | null;
        };
    if (!period) {
      throw new Error(`reporting_period not found: ${input.reporting_period_id}`);
    }

    const org = this.deps.db
      .prepare(
        `SELECT id, name_zh, name_en, industry, country_code, boundary_kind,
                responsible_person_name, responsible_person_role, base_year_period_id
           FROM organization WHERE id = ?`,
      )
      .get(period.organization_id) as {
      id: string;
      name_zh: string | null;
      name_en: string | null;
      industry: string | null;
      country_code: string;
      boundary_kind: 'equity_share' | 'financial_control' | 'operational_control';
      responsible_person_name: string | null;
      responsible_person_role: string | null;
      base_year_period_id: string | null;
    };

    const sites = this.deps.db
      .prepare(
        `SELECT id, name_zh, name_en, address FROM site WHERE organization_id = ? AND is_active = 1`,
      )
      .all(period.organization_id) as Array<{
      id: string;
      name_zh: string | null;
      name_en: string | null;
      address: string | null;
    }>;

    const rawActivities = this.deps.db
      .prepare(
        `SELECT a.id AS activity_id, a.computed_co2e_kg, a.amount, a.unit,
                es.id AS source_id, es.name AS source_name, es.scope,
                s.name_zh AS site_name_zh, s.name_en AS site_name_en,
                a.ef_source, pef.gwp_basis
           FROM activity_data a
           JOIN emission_source es ON es.id = a.emission_source_id AND es.site_id = a.site_id
           LEFT JOIN site s ON s.id = a.site_id
           LEFT JOIN pinned_emission_factor pef
             ON pef.factor_code = a.ef_factor_code
            AND pef.year = a.ef_year
            AND pef.source = a.ef_source
            AND pef.geography = a.ef_geography
            AND pef.dataset_version = a.ef_dataset_version
          WHERE a.reporting_period_id = ?`,
      )
      .all(input.reporting_period_id) as Array<{
      activity_id: string;
      computed_co2e_kg: number;
      amount: number;
      unit: string;
      source_id: string;
      source_name: string;
      scope: 1 | 2 | 3;
      site_name_zh: string | null;
      site_name_en: string | null;
      ef_source: string;
      gwp_basis: 'AR5' | 'AR6' | null;
    }>;

    // Roll up by source.
    const sourceMap = new Map<
      string,
      { id: string; name: string; scope: 1 | 2 | 3; co2e_kg: number }
    >();
    for (const row of rawActivities) {
      const existing = sourceMap.get(row.source_id);
      if (existing) {
        existing.co2e_kg += row.computed_co2e_kg;
      } else {
        sourceMap.set(row.source_id, {
          id: row.source_id,
          name: row.source_name,
          scope: row.scope,
          co2e_kg: row.computed_co2e_kg,
        });
      }
    }
    const sourcesArr = [...sourceMap.values()].sort((a, b) => b.co2e_kg - a.co2e_kg);

    const scope1_kg = sourcesArr.filter((s) => s.scope === 1).reduce((acc, s) => acc + s.co2e_kg, 0);
    const scope2_kg = sourcesArr.filter((s) => s.scope === 2).reduce((acc, s) => acc + s.co2e_kg, 0);
    const scope3_kg = sourcesArr.filter((s) => s.scope === 3).reduce((acc, s) => acc + s.co2e_kg, 0);
    const total_kg = scope1_kg + scope2_kg + scope3_kg;

    const all_sources = sourcesArr.map((s) => ({
      ...s,
      share_pct: total_kg > 0 ? (s.co2e_kg / total_kg) * 100 : 0,
    }));

    // Group EF source provenance.
    const efSourceMap = new Map<string, { source: string; count: number; gwp_basis: 'AR5' | 'AR6' }>();
    for (const row of rawActivities) {
      const k = row.ef_source;
      const ex = efSourceMap.get(k);
      if (ex) {
        ex.count++;
      } else {
        efSourceMap.set(k, {
          source: k,
          count: 1,
          gwp_basis: row.gwp_basis ?? 'AR5',
        });
      }
    }

    // Biogenic separated total.
    // Note: biogenic_co2_factor is on emission_factor table, not pinned_emission_factor.
    // For now, default to 0; future versions may need to reference emission_factor.
    let biogenic_kg = 0;

    // Prior period (immediately previous year).
    const priorRow = this.deps.db
      .prepare(
        `SELECT id, year FROM reporting_period
          WHERE organization_id = ? AND year < ?
          ORDER BY year DESC LIMIT 1`,
      )
      .get(period.organization_id, period.year) as { id: string; year: number } | undefined;
    let prior_period_summary: { year: number; total_kg: number } | null = null;
    if (priorRow) {
      const sum = this.deps.db
        .prepare(`SELECT COALESCE(SUM(computed_co2e_kg), 0) AS total_kg FROM activity_data WHERE reporting_period_id = ?`)
        .get(priorRow.id) as { total_kg: number };
      prior_period_summary = { year: priorRow.year, total_kg: sum.total_kg };
    }

    // Base year summary.
    let base_year_summary: { year: number; total_kg: number } | null = null;
    if (org.base_year_period_id && org.base_year_period_id !== period.id) {
      const baseRow = this.deps.db
        .prepare(`SELECT id, year FROM reporting_period WHERE id = ?`)
        .get(org.base_year_period_id) as { id: string; year: number } | undefined;
      if (baseRow) {
        const sum = this.deps.db
          .prepare(`SELECT COALESCE(SUM(computed_co2e_kg), 0) AS total_kg FROM activity_data WHERE reporting_period_id = ?`)
          .get(baseRow.id) as { total_kg: number };
        base_year_summary = { year: baseRow.year, total_kg: sum.total_kg };
      }
    }

    return {
      org: {
        id: org.id,
        name_zh: org.name_zh,
        name_en: org.name_en,
        industry: org.industry,
        country_code: org.country_code,
        boundary_kind: org.boundary_kind,
        responsible: {
          name: org.responsible_person_name,
          role: org.responsible_person_role,
        },
      },
      period: {
        id: period.id,
        year: period.year,
        granularity: period.granularity,
        start: period.starts_at,
        end: period.ends_at,
        is_base_year: org.base_year_period_id === period.id,
        significant_changes_text: period.significant_changes_text,
      },
      sites,
      scope_totals: {
        scope1_kg,
        scope2_kg,
        scope3_kg,
        total_kg,
        biogenic_kg,
      },
      all_sources,
      activities: rawActivities.map((r) => ({
        id: r.activity_id,
        site_name: input.language === 'zh-CN' ? r.site_name_zh : r.site_name_en,
        source_name: r.source_name,
        scope: r.scope,
        amount: r.amount,
        unit: r.unit,
        pinned_ef_source: r.ef_source,
        co2e_kg: r.computed_co2e_kg,
      })),
      ef_sources_used: [...efSourceMap.values()],
      language: input.language,
      prior_period_summary,
      base_year_summary,
    };
  }
}
