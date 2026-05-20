import '@renderer/styles/report-preview.css';
import type { ReportNarrative } from '@main/llm/report-narrative';
import type { InventoryReportData } from '@main/services/report-data-service';

export interface ReportPreviewProps {
  data: InventoryReportData;
  narrative: ReportNarrative;
  printMode: boolean;
  editable?: boolean;
  onChange?: (narrative: ReportNarrative) => void;
}

const SECTION_ORDER: Array<keyof ReportNarrative> = [
  'boundary_description',
  'reporting_boundary_description',
  'methodology_description',
  'emissions_summary',
  'significant_changes',
  'notable_observations',
];

const SECTION_HEADINGS = {
  'zh-CN': {
    boundary_description: '5.1 组织边界',
    reporting_boundary_description: '5.2 报告范围',
    methodology_description: '7.1 方法学',
    emissions_summary: '8 排放概要',
    significant_changes: '9.3.11 重大变动',
    notable_observations: '附录 A 观察发现',
  },
  en: {
    boundary_description: '5.1 Organizational boundary',
    reporting_boundary_description: '5.2 Reporting boundary',
    methodology_description: '7.1 Methodology',
    emissions_summary: '8 Emissions summary',
    significant_changes: '9.3.11 Significant changes',
    notable_observations: 'Appendix A Notable observations',
  },
} as const;

export function ReportPreview({
  data,
  narrative,
  printMode,
  editable,
  onChange,
}: ReportPreviewProps) {
  const lang = data.language;
  const headings = SECTION_HEADINGS[lang];

  const handleNarrativeEdit = (key: keyof ReportNarrative, value: string) => {
    if (onChange) {
      onChange({ ...narrative, [key]: value });
    }
  };

  return (
    <div className={`report-preview ${printMode ? 'report-preview--print' : ''}`}>
      <CoverPage data={data} />
      <OrgProfile data={data} />
      <ScopeTable data={data} />
      {SECTION_ORDER.map((key) => (
        <section key={key} className="report-preview__section">
          <h2>{headings[key]}</h2>
          {editable && !printMode ? (
            <textarea
              defaultValue={narrative[key]}
              rows={6}
              onChange={(e) => handleNarrativeEdit(key, e.target.value)}
              style={{ width: '100%' }}
            />
          ) : (
            <p>{narrative[key]}</p>
          )}
        </section>
      ))}
    </div>
  );
}

function CoverPage({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  const orgName =
    lang === 'zh-CN'
      ? data.org.name_zh ?? data.org.name_en ?? ''
      : data.org.name_en ?? data.org.name_zh ?? '';
  const title =
    lang === 'zh-CN' ? 'ISO 14064-1 温室气体盘查报告' : 'ISO 14064-1 GHG Inventory Report';
  return (
    <section className="report-preview__cover">
      <h1>{title}</h1>
      <h2>{orgName}</h2>
      <p>
        {lang === 'zh-CN' ? '报告期' : 'Reporting period'}: {data.period.year} ({data.period.granularity})
      </p>
    </section>
  );
}

function OrgProfile({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  return (
    <section className="report-preview__org-profile">
      <h2>{lang === 'zh-CN' ? '1 组织信息' : '1 Organization profile'}</h2>
      <dl>
        <dt>{lang === 'zh-CN' ? '行业' : 'Industry'}</dt>
        <dd>{data.org.industry ?? (lang === 'zh-CN' ? '未填写' : 'Not provided')}</dd>
        <dt>{lang === 'zh-CN' ? '边界方法' : 'Consolidation approach'}</dt>
        <dd>{data.org.boundary_kind}</dd>
        <dt>{lang === 'zh-CN' ? '责任人' : 'Responsible person'}</dt>
        <dd>
          {data.org.responsible.name ?? '—'}
          {data.org.responsible.role ? ` (${data.org.responsible.role})` : ''}
        </dd>
      </dl>
    </section>
  );
}

function ScopeTable({ data }: { data: InventoryReportData }) {
  const lang = data.language;
  const labels =
    lang === 'zh-CN'
      ? {
          scope: '范围',
          kg: 'kg CO2e',
          scope1: '范围一',
          scope2: '范围二',
          scope3: '范围三',
          total: '合计',
          biogenic: '生物质 (单独披露)',
        }
      : {
          scope: 'Scope',
          kg: 'kg CO2e',
          scope1: 'Scope 1',
          scope2: 'Scope 2',
          scope3: 'Scope 3',
          total: 'Total',
          biogenic: 'Biogenic (separately disclosed)',
        };
  return (
    <section className="report-preview__scope-table">
      <h2>{lang === 'zh-CN' ? '2 排放汇总' : '2 Emissions summary'}</h2>
      <table>
        <thead>
          <tr>
            <th>{labels.scope}</th>
            <th>{labels.kg}</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>{labels.scope1}</td>
            <td>{data.scope_totals.scope1_kg}</td>
          </tr>
          <tr>
            <td>{labels.scope2}</td>
            <td>{data.scope_totals.scope2_kg}</td>
          </tr>
          <tr>
            <td>{labels.scope3}</td>
            <td>{data.scope_totals.scope3_kg}</td>
          </tr>
          <tr>
            <td>
              <strong>{labels.total}</strong>
            </td>
            <td>
              <strong>{data.scope_totals.total_kg}</strong>
            </td>
          </tr>
          <tr>
            <td>{labels.biogenic}</td>
            <td>{data.scope_totals.biogenic_kg}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}
