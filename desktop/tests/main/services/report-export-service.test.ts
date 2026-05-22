import type { ReportNarrative } from '@main/llm/report-narrative';
import type { InventoryReportData } from '@main/services/report-data-service';
import { writeAppendixXlsx } from '@main/services/report-export-service';
import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';

function fakeData(): InventoryReportData {
  return {
    org: {
      id: 'org-1',
      name_zh: '测试',
      name_en: 'Test',
      industry: null,
      country_code: 'CN',
      boundary_kind: 'operational_control',
      responsible: { name: '张三', role: null },
    },
    period: {
      id: 'per-2025',
      year: 2025,
      granularity: 'annual',
      start: '2025-01-01',
      end: '2025-12-31',
      is_base_year: false,
      significant_changes_text: null,
    },
    sites: [{ id: 'site-1', name_zh: '北京', name_en: 'Beijing', address: null }],
    scope_totals: { scope1_kg: 100, scope2_kg: 200, scope3_kg: 50, total_kg: 350, biogenic_kg: 0 },
    all_sources: [
      { id: 's1', name: 'A', scope: 1, co2e_kg: 100, share_pct: 28.6 },
      { id: 's2', name: 'B', scope: 2, co2e_kg: 200, share_pct: 57.1 },
    ],
    activities: [
      {
        id: 'a1',
        site_name: '北京',
        source_name: 'A',
        scope: 1,
        amount: 32,
        unit: 'kg',
        pinned_ef_source: 'IPCC',
        co2e_kg: 100,
      },
      {
        id: 'a2',
        site_name: '北京',
        source_name: 'B',
        scope: 2,
        amount: 1000,
        unit: 'kWh',
        pinned_ef_source: 'IPCC',
        co2e_kg: 200,
      },
    ],
    ef_sources_used: [{ source: 'IPCC', count: 2, gwp_basis: 'AR5' }],
    language: 'zh-CN',
    prior_period_summary: null,
    base_year_summary: null,
  };
}
const fakeNarrative: ReportNarrative = {
  boundary_description: 'a'.repeat(60),
  reporting_boundary_description: 'b'.repeat(60),
  methodology_description: 'c'.repeat(120),
  emissions_summary: 'd'.repeat(120),
  significant_changes: 'e'.repeat(30),
  notable_observations: 'f'.repeat(60),
};

describe('writeAppendixXlsx', () => {
  it('produces a workbook with 5 sheets in zh-CN', async () => {
    const buf = await writeAppendixXlsx({
      data: fakeData(),
      narrative: fakeNarrative,
      language: 'zh-CN',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual(['概览', '活动明细', '排放因子', '排放源', '叙述']);
  });

  it('produces a workbook with 5 sheets in en', async () => {
    const buf = await writeAppendixXlsx({
      data: { ...fakeData(), language: 'en' },
      narrative: fakeNarrative,
      language: 'en',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const names = wb.worksheets.map((w) => w.name);
    expect(names).toEqual([
      'Overview',
      'Activities',
      'Emission Factors',
      'Emission Sources',
      'Narrative',
    ]);
  });

  it('writes one narrative row per section (6 total)', async () => {
    const buf = await writeAppendixXlsx({
      data: fakeData(),
      narrative: fakeNarrative,
      language: 'zh-CN',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const narrative = wb.getWorksheet('叙述')!;
    // Header row + 6 narrative rows = 7 rows.
    expect(narrative.rowCount).toBe(7);
  });

  it('lists each emission source on the Sources sheet', async () => {
    const buf = await writeAppendixXlsx({
      data: fakeData(),
      narrative: fakeNarrative,
      language: 'zh-CN',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const sources = wb.getWorksheet('排放源')!;
    // Header + 2 data rows.
    expect(sources.rowCount).toBe(3);
  });

  it('lists each activity on the Activities sheet', async () => {
    const buf = await writeAppendixXlsx({
      data: fakeData(),
      narrative: fakeNarrative,
      language: 'zh-CN',
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
    const activities = wb.getWorksheet('活动明细')!;
    // Header + 2 data rows.
    expect(activities.rowCount).toBe(3);
  });
});
