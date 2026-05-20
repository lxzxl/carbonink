import { ReportPreview } from '@renderer/components/report/ReportPreview';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { InventoryReportData } from '@main/services/report-data-service';
import type { ReportNarrative } from '@main/llm/report-narrative';

const data: InventoryReportData = {
  org: {
    id: 'org-1',
    name_zh: '测试公司',
    name_en: 'Test Co',
    industry: '制造业',
    country_code: 'CN',
    boundary_kind: 'operational_control',
    responsible: { name: '张三', role: '可持续发展负责人' },
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
  sites: [{ id: 's', name_zh: '北京', name_en: 'Beijing', address: null }],
  scope_totals: { scope1_kg: 100, scope2_kg: 200, scope3_kg: 50, total_kg: 350, biogenic_kg: 0 },
  all_sources: [{ id: 'a', name: 'A', scope: 1, co2e_kg: 100, share_pct: 28.6 }],
  activities: [],
  ef_sources_used: [{ source: 'IPCC', count: 1, gwp_basis: 'AR5' }],
  language: 'zh-CN',
  prior_period_summary: null,
  base_year_summary: null,
};

const narrative: ReportNarrative = {
  boundary_description: 'BOUNDARY TEXT',
  reporting_boundary_description: 'REPORTING BOUNDARY TEXT',
  methodology_description: 'METHODOLOGY TEXT',
  emissions_summary: 'EMISSIONS SUMMARY TEXT',
  significant_changes: 'SIGNIFICANT CHANGES TEXT',
  notable_observations: 'NOTABLE OBSERVATIONS TEXT',
};

describe('ReportPreview', () => {
  it('renders all 6 narrative sections', () => {
    render(<ReportPreview data={data} narrative={narrative} printMode={false} />);
    expect(screen.getByText('BOUNDARY TEXT')).toBeTruthy();
    expect(screen.getByText('REPORTING BOUNDARY TEXT')).toBeTruthy();
    expect(screen.getByText('METHODOLOGY TEXT')).toBeTruthy();
    expect(screen.getByText('EMISSIONS SUMMARY TEXT')).toBeTruthy();
    expect(screen.getByText('SIGNIFICANT CHANGES TEXT')).toBeTruthy();
    expect(screen.getByText('NOTABLE OBSERVATIONS TEXT')).toBeTruthy();
  });

  it('renders the scope totals table', () => {
    const { container } = render(<ReportPreview data={data} narrative={narrative} printMode={false} />);
    const table = container.querySelector('.report-preview__scope-table table');
    expect(table).toBeTruthy();
    expect(table?.textContent).toContain('100'); // scope1
    expect(table?.textContent).toContain('200'); // scope2
    expect(table?.textContent).toContain('350'); // total
  });

  it('applies print mode class when printMode=true', () => {
    const { container } = render(
      <ReportPreview data={data} narrative={narrative} printMode={true} />,
    );
    expect(container.querySelector('.report-preview--print')).toBeTruthy();
  });

  it('shows editable inputs when editable=true and calls onChange', async () => {
    const onChange = vi.fn();
    render(
      <ReportPreview
        data={data}
        narrative={narrative}
        printMode={false}
        editable
        onChange={onChange}
      />,
    );
    const boundary = screen.getByDisplayValue('BOUNDARY TEXT');
    expect(boundary.tagName.toLowerCase()).toBe('textarea');
  });
});
