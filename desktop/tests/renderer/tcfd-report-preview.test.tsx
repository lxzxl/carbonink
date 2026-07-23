import type { TcfdNarrative } from '@main/llm/tcfd-narrative';
import type { InventoryReportData } from '@main/services/report-data-service';
import { TcfdReportPreview } from '@renderer/components/report/TcfdReportPreview';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => cleanup());

function data(overrides: Partial<InventoryReportData> = {}): InventoryReportData {
  return {
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
    all_sources: [{ id: 'a', name: '电网电力', scope: 2, co2e_kg: 200, share_pct: 57.1 }],
    activities: [],
    ef_sources_used: [{ source: 'MEE', count: 1, gwp_basis: 'AR6' }],
    language: 'zh-CN',
    prior_period_summary: { year: 2024, total_kg: 300 },
    base_year_summary: { year: 2023, total_kg: 280 },
    ...overrides,
  };
}

const narrative: TcfdNarrative = {
  governance: 'GOVERNANCE TEXT',
  strategy: 'STRATEGY TEXT',
  risk_management: 'RISK MANAGEMENT TEXT',
  metrics_targets: 'METRICS TARGETS TEXT',
};

describe('TcfdReportPreview', () => {
  it('renders the four pillars with zh headings and the TCFD cover', () => {
    render(<TcfdReportPreview data={data()} narrative={narrative} printMode={false} />);
    expect(screen.getByText('气候相关财务信息披露报告（TCFD）')).toBeTruthy();
    expect(screen.getByText('1 治理')).toBeTruthy();
    expect(screen.getByText('2 战略')).toBeTruthy();
    expect(screen.getByText('3 风险管理')).toBeTruthy();
    expect(screen.getByText('4 指标与目标')).toBeTruthy();
    expect(screen.getByText('GOVERNANCE TEXT')).toBeTruthy();
    expect(screen.getByText('METRICS TARGETS TEXT')).toBeTruthy();
  });

  it('renders the quantitative appendix straight from the inventory data', () => {
    render(<TcfdReportPreview data={data()} narrative={narrative} printMode={false} />);
    // Scope table (shared with the ISO report).
    expect(screen.getByText('范围一')).toBeTruthy();
    // Top sources.
    expect(screen.getByText('附表 1 主要排放源')).toBeTruthy();
    expect(screen.getByText('电网电力')).toBeTruthy();
    expect(screen.getByText('57.1%')).toBeTruthy();
    // Period comparison incl. base year + prior period.
    expect(screen.getByText('附表 2 期间对比')).toBeTruthy();
    expect(screen.getByText('基准年')).toBeTruthy();
    expect(screen.getByText('上一期')).toBeTruthy();
  });

  it('editable mode renders textareas and propagates pillar edits', () => {
    const onChange = vi.fn();
    render(
      <TcfdReportPreview
        data={data()}
        narrative={narrative}
        printMode={false}
        editable
        onChange={onChange}
      />,
    );
    const boxes = screen.getAllByRole('textbox');
    expect(boxes).toHaveLength(4);
    fireEvent.change(boxes[0] as HTMLElement, { target: { value: 'EDITED GOVERNANCE' } });
    expect(onChange).toHaveBeenCalledWith({ ...narrative, governance: 'EDITED GOVERNANCE' });
  });

  it('renders the white-label logo on the cover when present', () => {
    const logo = 'data:image/png;base64,AAAA';
    const { container } = render(
      <TcfdReportPreview
        data={data({ org: { ...data().org, logo_data_url: logo } })}
        narrative={narrative}
        printMode={false}
      />,
    );
    expect(container.querySelector(`img[src="${logo}"]`)).toBeTruthy();
  });

  it('printMode ignores editable and stays read-only', () => {
    render(<TcfdReportPreview data={data()} narrative={narrative} printMode={true} editable />);
    expect(screen.queryAllByRole('textbox')).toHaveLength(0);
    expect(screen.getByText('GOVERNANCE TEXT')).toBeTruthy();
  });

  it('hides the comparison table when no base/prior period exists and uses en headings', () => {
    render(
      <TcfdReportPreview
        data={data({ language: 'en', prior_period_summary: null, base_year_summary: null })}
        narrative={narrative}
        printMode={false}
      />,
    );
    expect(screen.getByText('1 Governance')).toBeTruthy();
    expect(screen.getByText('4 Metrics and targets')).toBeTruthy();
    expect(screen.queryByText('Table 2 Period comparison')).toBeNull();
  });
});
