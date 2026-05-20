import { BrowserWindow, type WebContents } from 'electron';
import ExcelJS from 'exceljs';
import * as fs from 'node:fs/promises';
import type { ReportNarrative } from '@main/llm/report-narrative';
import type { InventoryReportData } from './report-data-service.js';

const SHEET_NAMES = {
  'zh-CN': {
    overview: '概览',
    activities: '活动明细',
    factors: '排放因子',
    sources: '排放源',
    narrative: '叙述',
  },
  en: {
    overview: 'Overview',
    activities: 'Activities',
    factors: 'Emission Factors',
    sources: 'Emission Sources',
    narrative: 'Narrative',
  },
} as const;

const NARRATIVE_HEADERS = {
  'zh-CN': { section: '章节', text: '内容' },
  en: { section: 'Section', text: 'Text' },
} as const;

const SECTION_LABELS = {
  'zh-CN': {
    boundary_description: '组织边界',
    reporting_boundary_description: '报告范围',
    methodology_description: '方法学',
    emissions_summary: '排放概要',
    significant_changes: '重大变动',
    notable_observations: '观察发现',
  },
  en: {
    boundary_description: 'Organizational boundary',
    reporting_boundary_description: 'Reporting boundary',
    methodology_description: 'Methodology',
    emissions_summary: 'Emissions summary',
    significant_changes: 'Significant changes',
    notable_observations: 'Notable observations',
  },
} as const;

export async function writeAppendixXlsx(args: {
  data: InventoryReportData;
  narrative: ReportNarrative;
  language: 'zh-CN' | 'en';
}): Promise<Buffer> {
  const { data, narrative, language } = args;
  const labels = SHEET_NAMES[language];
  const narrativeHdr = NARRATIVE_HEADERS[language];
  const sectionLabels = SECTION_LABELS[language];

  const wb = new ExcelJS.Workbook();

  // 1. Overview
  const overview = wb.addWorksheet(labels.overview);
  overview.addRow([language === 'zh-CN' ? '组织' : 'Organization', data.org.name_zh ?? data.org.name_en ?? '']);
  overview.addRow([language === 'zh-CN' ? '报告期' : 'Reporting period', `${data.period.year} ${data.period.granularity}`]);
  overview.addRow([language === 'zh-CN' ? '范围一 (kg CO2e)' : 'Scope 1 (kg CO2e)', data.scope_totals.scope1_kg]);
  overview.addRow([language === 'zh-CN' ? '范围二 (kg CO2e)' : 'Scope 2 (kg CO2e)', data.scope_totals.scope2_kg]);
  overview.addRow([language === 'zh-CN' ? '范围三 (kg CO2e)' : 'Scope 3 (kg CO2e)', data.scope_totals.scope3_kg]);
  overview.addRow([language === 'zh-CN' ? '合计 (kg CO2e)' : 'Total (kg CO2e)', data.scope_totals.total_kg]);
  overview.addRow([language === 'zh-CN' ? '生物质 (单独)' : 'Biogenic (separate)', data.scope_totals.biogenic_kg]);

  // 2. Activities — every activity_data row from data.activities.
  const activities = wb.addWorksheet(labels.activities);
  activities.addRow(
    language === 'zh-CN'
      ? ['活动 ID', '场地', '排放源', '范围', '数量', '单位', 'EF 来源', 'CO2e (kg)']
      : ['Activity ID', 'Site', 'Source', 'Scope', 'Amount', 'Unit', 'EF Source', 'CO2e (kg)'],
  );
  for (const a of data.activities) {
    activities.addRow([
      a.id,
      a.site_name ?? '',
      a.source_name,
      a.scope,
      a.amount,
      a.unit,
      a.pinned_ef_source,
      a.co2e_kg,
    ]);
  }

  // 3. Factors — derived from ef_sources_used aggregate.
  const factors = wb.addWorksheet(labels.factors);
  factors.addRow(
    language === 'zh-CN'
      ? ['来源', '使用次数', 'GWP 基准']
      : ['Source', 'Count', 'GWP basis'],
  );
  for (const f of data.ef_sources_used) {
    factors.addRow([f.source, f.count, f.gwp_basis]);
  }

  // 4. Emission Sources
  const sourcesSheet = wb.addWorksheet(labels.sources);
  sourcesSheet.addRow(
    language === 'zh-CN'
      ? ['名称', '范围', 'CO2e (kg)', '占比 %']
      : ['Name', 'Scope', 'CO2e (kg)', 'Share %'],
  );
  for (const s of data.all_sources) {
    sourcesSheet.addRow([s.name, s.scope, s.co2e_kg, s.share_pct.toFixed(2)]);
  }

  // 5. Narrative
  const narrativeSheet = wb.addWorksheet(labels.narrative);
  narrativeSheet.addRow([narrativeHdr.section, narrativeHdr.text]);
  for (const key of Object.keys(sectionLabels) as Array<keyof typeof sectionLabels>) {
    narrativeSheet.addRow([sectionLabels[key], narrative[key]]);
  }

  const out = await wb.xlsx.writeBuffer();
  return Buffer.from(out as ArrayBuffer);
}

export interface ExportPdfDeps {
  /**
   * Path the print-render window should load. In production this is a
   * file:// URL to the built renderer's print-render route; in dev it's
   * the Vite dev server URL.
   */
  printRenderUrl: string;
}

export async function renderReportPdf(
  args: {
    data: InventoryReportData;
    narrative: ReportNarrative;
    language: 'zh-CN' | 'en';
  },
  deps: ExportPdfDeps,
): Promise<Buffer> {
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      offscreen: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  try {
    await win.loadURL(deps.printRenderUrl);
    // Hand the data to the renderer via executeJavaScript — the renderer
    // route reads window.__REPORT_PAYLOAD__ on mount.
    await win.webContents.executeJavaScript(
      `window.__REPORT_PAYLOAD__ = ${JSON.stringify({
        data: args.data,
        narrative: args.narrative,
        language: args.language,
      })};`,
    );
    // Give layout + fonts a beat to settle. Renderer signals readiness by
    // setting document.title to "READY"; main waits for it.
    await waitForTitle(win.webContents, 'READY', 30_000);
    const buf = await win.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      margins: { top: 0.78, bottom: 0.78, left: 0.71, right: 0.71 }, // inches ~ 20/18mm
    });
    return buf;
  } finally {
    win.close();
  }
}

function waitForTitle(wc: WebContents, expected: string, timeoutMs: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      wc.removeAllListeners('page-title-updated');
      reject(new Error(`PDF render did not signal ready within ${timeoutMs}ms`));
    }, timeoutMs);
    const handler = (_e: unknown, title: string) => {
      if (title === expected) {
        clearTimeout(timer);
        wc.removeListener('page-title-updated', handler);
        resolve();
      }
    };
    wc.on('page-title-updated', handler);
    // Already loaded with matching title?
    if (wc.getTitle() === expected) {
      clearTimeout(timer);
      wc.removeListener('page-title-updated', handler);
      resolve();
    }
  });
}

export function slugifyOrgName(data: InventoryReportData): string {
  const candidate = data.org.name_en ?? data.org.name_zh ?? data.org.id.slice(0, 8);
  return candidate
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || data.org.id.slice(0, 8);
}

export function defaultExportFilename(args: {
  data: InventoryReportData;
  language: 'zh-CN' | 'en';
  kind: 'pdf' | 'xlsx';
}): string {
  const slug = slugifyOrgName(args.data);
  const granSuffix = args.data.period.granularity === 'annual' ? '' : `-${args.data.period.granularity}`;
  const base = `${slug}-iso-14064-1-${args.data.period.year}${granSuffix}-${args.language}`;
  return args.kind === 'pdf' ? `${base}.pdf` : `${base}-appendix.xlsx`;
}
