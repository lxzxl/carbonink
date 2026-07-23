import '@renderer/styles/report-preview.css';
import type { TcfdNarrative } from '@main/llm/tcfd-narrative';
import type { InventoryReportData } from '@main/services/report-data-service';
import { formatCo2e } from '@renderer/lib/format';
import { ScopeTable } from './ReportPreview';

export interface TcfdReportPreviewProps {
  data: InventoryReportData;
  narrative: TcfdNarrative;
  printMode: boolean;
  /** Pillar textareas become editable (screen only — print stays read-only). */
  editable?: boolean;
  onChange?: (narrative: TcfdNarrative) => void;
}

const PILLAR_ORDER: Array<keyof TcfdNarrative> = [
  'governance',
  'strategy',
  'risk_management',
  'metrics_targets',
];

const PILLAR_HEADINGS = {
  'zh-CN': {
    governance: '1 治理',
    strategy: '2 战略',
    risk_management: '3 风险管理',
    metrics_targets: '4 指标与目标',
  },
  en: {
    governance: '1 Governance',
    strategy: '2 Strategy',
    risk_management: '3 Risk management',
    metrics_targets: '4 Metrics and targets',
  },
} as const;

/**
 * TCFD four-pillar report (spec 2026-07-22-tcfd-report). Shares the ISO
 * report's print stylesheet + ScopeTable; the metrics pillar is followed
 * by the quantitative appendix (scope totals, top sources, YoY / base-year
 * comparison) — every number straight from InventoryReportData, the LLM
 * narrative never carries a figure the tables don't.
 */
export function TcfdReportPreview({
  data,
  narrative,
  printMode,
  editable,
  onChange,
}: TcfdReportPreviewProps) {
  const lang = data.language;
  const headings = PILLAR_HEADINGS[lang];

  const handleEdit = (key: keyof TcfdNarrative, value: string) => {
    if (onChange) onChange({ ...narrative, [key]: value });
  };

  return (
    <div className={`report-preview ${printMode ? 'report-preview--print' : ''}`}>
      <TcfdCover data={data} />
      {PILLAR_ORDER.map((key) => (
        <section key={key} className="report-preview__section">
          <h2>{headings[key]}</h2>
          {editable && !printMode ? (
            <textarea
              defaultValue={narrative[key]}
              rows={6}
              onChange={(e) => handleEdit(key, e.target.value)}
              style={{ width: '100%' }}
            />
          ) : (
            <p>{narrative[key]}</p>
          )}
        </section>
      ))}
      <ScopeTable data={data} />
      <TopSourcesTable data={data} />
      <ComparisonTable data={data} />
    </div>
  );
}

function TcfdCover({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  const orgName =
    lang === 'zh-CN'
      ? (data.org.name_zh ?? data.org.name_en ?? '')
      : (data.org.name_en ?? data.org.name_zh ?? '');
  const title =
    lang === 'zh-CN'
      ? '气候相关财务信息披露报告（TCFD）'
      : 'Climate-related Financial Disclosures (TCFD) Report';
  return (
    <section className="report-preview__cover">
      <h1>{title}</h1>
      <h2>{orgName}</h2>
      <p>
        {lang === 'zh-CN' ? '报告期' : 'Reporting period'}: {data.period.year} (
        {data.period.granularity})
      </p>
    </section>
  );
}

function TopSourcesTable({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  const top = data.all_sources.slice(0, 8);
  if (top.length === 0) return null;
  return (
    <section className="report-preview__scope-table">
      <h2>{lang === 'zh-CN' ? '附表 1 主要排放源' : 'Table 1 Main emission sources'}</h2>
      <table>
        <thead>
          <tr>
            <th>{lang === 'zh-CN' ? '排放源' : 'Source'}</th>
            <th>{lang === 'zh-CN' ? '范围' : 'Scope'}</th>
            <th>kg CO2e</th>
            <th>{lang === 'zh-CN' ? '占比' : 'Share'}</th>
          </tr>
        </thead>
        <tbody>
          {top.map((source) => (
            <tr key={source.id}>
              <td>{source.name}</td>
              <td>{source.scope}</td>
              <td>{formatCo2e(source.co2e_kg)}</td>
              <td>{source.share_pct}%</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function ComparisonTable({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  const rows: Array<{ label: string; year: number; total_kg: number }> = [];
  if (data.base_year_summary) {
    rows.push({
      label: lang === 'zh-CN' ? '基准年' : 'Base year',
      ...data.base_year_summary,
    });
  }
  if (data.prior_period_summary) {
    rows.push({
      label: lang === 'zh-CN' ? '上一期' : 'Prior period',
      ...data.prior_period_summary,
    });
  }
  if (rows.length === 0) return null;
  return (
    <section className="report-preview__scope-table">
      <h2>{lang === 'zh-CN' ? '附表 2 期间对比' : 'Table 2 Period comparison'}</h2>
      <table>
        <thead>
          <tr>
            <th>{lang === 'zh-CN' ? '期间' : 'Period'}</th>
            <th>{lang === 'zh-CN' ? '年度' : 'Year'}</th>
            <th>{lang === 'zh-CN' ? '合计 kg CO2e' : 'Total kg CO2e'}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{lang === 'zh-CN' ? '本期' : 'This period'}</td>
            <td>{data.period.year}</td>
            <td>{formatCo2e(data.scope_totals.total_kg)}</td>
          </tr>
          {rows.map((row) => (
            <tr key={row.label}>
              <td>{row.label}</td>
              <td>{row.year}</td>
              <td>{formatCo2e(row.total_kg)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
