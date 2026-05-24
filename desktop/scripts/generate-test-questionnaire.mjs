#!/usr/bin/env node
/**
 * Generate a realistic CDP-style supplier questionnaire .xlsx for manual
 * testing of the questionnaire flow.
 *
 * Usage:
 *   node scripts/generate-test-questionnaire.mjs
 *
 * Output:
 *   samples/test-questionnaire-2025.xlsx
 *
 * The file contains ~10 representative GHG/ESG questions across multiple
 * sheets — company info + scope-1/2/3 emissions + energy + water. Cells
 * are intentionally left blank for the AI to fill in. The LLM extractor
 * sees the question text and the empty-cell positions; running the upload
 * flow will yield ~10 question rows the AnswerReviewCards then render.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import ExcelJS from 'exceljs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const OUT_PATH = join(__dirname, '..', 'samples', 'test-questionnaire-2025.xlsx');

const wb = new ExcelJS.Workbook();
wb.creator = 'carbonink test fixture generator';
wb.created = new Date('2026-01-01');

// ---------------------------------------------------------------------------
// Sheet 1: 公司信息 (Company info)
// ---------------------------------------------------------------------------
const sheet1 = wb.addWorksheet('公司信息');
sheet1.columns = [
  { header: '问题', key: 'q', width: 50 },
  { header: '填报值', key: 'v', width: 25 },
  { header: '单位', key: 'u', width: 12 },
];
sheet1.getRow(1).font = { bold: true };
sheet1.addRows([
  { q: '公司中文名称', v: '', u: '' },
  { q: '报告期开始日期 (YYYY-MM-DD)', v: '', u: '' },
  { q: '报告期结束日期 (YYYY-MM-DD)', v: '', u: '' },
  { q: '主要行业分类', v: '', u: '' },
  { q: '员工总人数', v: '', u: '人' },
]);

// ---------------------------------------------------------------------------
// Sheet 2: 温室气体排放 (GHG emissions — scope 1/2/3)
// ---------------------------------------------------------------------------
const sheet2 = wb.addWorksheet('温室气体排放');
sheet2.columns = [
  { header: '问题', key: 'q', width: 60 },
  { header: '填报值', key: 'v', width: 20 },
  { header: '单位', key: 'u', width: 12 },
];
sheet2.getRow(1).font = { bold: true };
sheet2.addRows([
  { q: '报告期内范围 1 温室气体排放总量', v: '', u: 'tCO2e' },
  { q: '报告期内范围 2 温室气体排放总量（基于市场法）', v: '', u: 'tCO2e' },
  { q: '报告期内范围 2 温室气体排放总量（基于位置法）', v: '', u: 'tCO2e' },
  { q: '报告期内范围 3 温室气体排放总量', v: '', u: 'tCO2e' },
]);

// ---------------------------------------------------------------------------
// Sheet 3: 能源与水耗 (Energy & water)
// ---------------------------------------------------------------------------
const sheet3 = wb.addWorksheet('能源与水耗');
sheet3.columns = [
  { header: '问题', key: 'q', width: 60 },
  { header: '填报值', key: 'v', width: 20 },
  { header: '单位', key: 'u', width: 12 },
];
sheet3.getRow(1).font = { bold: true };
sheet3.addRows([
  { q: '报告期内总电力消耗量（含可再生与非可再生）', v: '', u: 'kWh' },
  { q: '报告期内可再生电力消耗量', v: '', u: 'kWh' },
  { q: '报告期内化石燃料消耗量（折标煤）', v: '', u: '吨标煤' },
  { q: '报告期内取水总量', v: '', u: '吨' },
]);

// Make all data rows a bit nicer to look at.
for (const sheet of [sheet1, sheet2, sheet3]) {
  for (let r = 2; r <= sheet.rowCount; r++) {
    sheet.getRow(r).getCell('v').border = {
      top: { style: 'thin' },
      bottom: { style: 'thin' },
      left: { style: 'thin' },
      right: { style: 'thin' },
    };
    sheet.getRow(r).getCell('v').fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFFFFAF0' },
    };
  }
}

mkdirSync(dirname(OUT_PATH), { recursive: true });
const buf = await wb.xlsx.writeBuffer();
writeFileSync(OUT_PATH, Buffer.from(buf));
console.log(`Wrote ${OUT_PATH} (${buf.byteLength} bytes)`);
