#!/usr/bin/env node
/**
 * Generate an industry-common GHG disclosure questionnaire .xlsx for testing the
 * outbound "披露填报" import flow (upload → AI extracts questions → generate answers
 * from inventory → export).
 *
 * Models the kind of form a customer / rating agency (CDP, EcoVadis, a downstream
 * buyer) sends a supplier: GHG-Protocol-aligned, Scope 1/2/3 + targets/verification.
 * The questions are deliberately answerable from the seeded mock inventory
 * (electricity → Scope 2, diesel/natural-gas → Scope 1, travel → Scope 3), so the
 * full extract→answer→export round-trip has data to work with.
 *
 * Layout for reliable extraction: a flat Question | Response | Unit table. The
 * Response column (C) is left BLANK — that's the answer cell the app maps each
 * question to and writes back into on export.
 *
 * Usage:  node scripts/make-sample-questionnaire.mjs
 */
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const __dirname = dirname(fileURLToPath(import.meta.url));
// Lives under the e2e fixtures dir so Playwright specs can `setInputFiles(...)`
// it and a vitest integration test (questionnaire-import-fixture.test.ts) can
// parse it through the real ExcelParser.
const outDir = join(__dirname, '..', 'tests', 'e2e', 'fixtures');
mkdirSync(outDir, { recursive: true });
const outPath = join(outDir, 'sample-customer-questionnaire-2025.xlsx');

const wb = new ExcelJS.Workbook();
wb.creator = 'CarbonInk — sample test fixture';
const ws = wb.addWorksheet('碳排放披露问卷');
ws.columns = [{ width: 6 }, { width: 66 }, { width: 26 }, { width: 36 }];

ws.getCell('A1').value = '2025 年度供应商碳排放披露问卷 / 2025 Supplier GHG Emissions Disclosure';
ws.getCell('A1').font = { bold: true, size: 14 };
ws.getCell('A2').value =
  '说明：请在「回答」列填写。数据口径遵循 GHG Protocol（温室气体核算体系）。/ Please complete the "Response" column. Figures follow the GHG Protocol.';
ws.getCell('A2').font = { italic: true, color: { argb: 'FF666666' } };

const header = ws.getRow(3);
['序号 No.', '问题 Question', '回答 Response', '单位 / 选项  Unit / Options'].forEach((v, i) => {
  const c = header.getCell(i + 1);
  c.value = v;
  c.font = { bold: true };
  c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEFECE3' } };
});

const items = [
  { section: '一、企业基本信息  Company information' },
  { no: 1, q: '报告主体名称（法定全称）/ Reporting entity (legal name)', unit: '文本 Text' },
  { no: 2, q: '报告年度 / Reporting year', unit: '年份，如 2025 / Year' },
  {
    no: 3,
    q: '组织边界方法 / Organizational boundary approach',
    unit: '运营控制权 / 股权比例 / 财务控制权\nOperational / Equity share / Financial control',
  },
  { section: '二、范围一与范围二排放  Scope 1 & Scope 2' },
  {
    no: 4,
    q: '范围一（直接）温室气体排放总量 / Total Scope 1 (direct) GHG emissions',
    unit: 'tCO₂e',
  },
  {
    no: 5,
    q: '范围二（外购电力）排放总量——基于位置法 / Total Scope 2 (purchased electricity), location-based',
    unit: 'tCO₂e',
  },
  { no: 6, q: '范围二排放总量——基于市场法 / Total Scope 2 emissions, market-based', unit: 'tCO₂e' },
  { no: 7, q: '外购电力消耗总量 / Total purchased electricity consumption', unit: 'MWh' },
  { no: 8, q: '可再生能源电力占比 / Share of renewable electricity', unit: '%' },
  { section: '三、范围三排放  Scope 3' },
  {
    no: 9,
    q: '是否核算范围三排放？/ Do you account for Scope 3 emissions?',
    unit: '是 / 否 / 部分  Yes / No / Partial',
  },
  { no: 10, q: '范围三排放总量（如适用）/ Total Scope 3 emissions (if applicable)', unit: 'tCO₂e' },
  { section: '四、减排目标与核查  Targets & verification' },
  {
    no: 11,
    q: '是否已设定温室气体减排目标？/ Do you have a GHG reduction target?',
    unit: '是 / 否  Yes / No',
  },
  {
    no: 12,
    q: '减排目标描述（基准年、目标年、减排比例）/ Reduction target (base year, target year, % cut)',
    unit: '文本 Text',
  },
  {
    no: 13,
    q: '温室气体清单核查状态 / GHG inventory verification status',
    unit: '未核查 / 自我声明 / 第三方核查 / ISO 14064\nNone / Self-reported / Third-party / ISO 14064',
  },
  {
    no: 14,
    q: '核算方法与采用标准 / Calculation methodology & standard',
    unit: '如 GHG Protocol、ISO 14064-1',
  },
];

let r = 4;
const thin = { style: 'thin', color: { argb: 'FFDDDDDD' } };
for (const it of items) {
  const row = ws.getRow(r);
  if (it.section) {
    const c = row.getCell(1);
    c.value = it.section;
    c.font = { bold: true };
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F1E8' } };
  } else {
    row.getCell(1).value = it.no;
    row.getCell(2).value = it.q;
    // C (回答 / Response) intentionally BLANK — the answer cell.
    row.getCell(4).value = it.unit;
    row.getCell(2).alignment = { wrapText: true, vertical: 'top' };
    row.getCell(4).alignment = { wrapText: true, vertical: 'top' };
    for (const col of [1, 2, 3, 4]) {
      row.getCell(col).border = { top: thin, bottom: thin, left: thin, right: thin };
    }
  }
  r++;
}
ws.views = [{ state: 'frozen', ySplit: 3 }];

await wb.xlsx.writeFile(outPath);
console.log(`✓ wrote ${outPath}`);
console.log(
  `  ${items.filter((i) => !i.section).length} questions across ${items.filter((i) => i.section).length} sections`,
);
