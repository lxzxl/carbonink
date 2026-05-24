#!/usr/bin/env node
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Generates the 5 manual-smoke fixture PDFs by rendering filled-in Chinese
 * invoice HTML through Playwright's headless Chromium.
 *
 * Why we don't ship real specimen PDFs:
 *   Public tax-bureau "样式" PDFs are blank templates — the LLM extractor
 *   has no values to pull. Real filled invoices contain personally
 *   identifying account numbers / company names / amounts.
 *
 * Why synthetic works:
 *   carbonink's per-stage schema is permissive — the LLM only needs the
 *   document to LOOK like the target invoice type (right header, right
 *   field labels, plausible values). The fake company names + invoice
 *   numbers + amounts below satisfy every required field on each stage
 *   schema while staying obviously synthetic.
 *
 * Run:
 *   pnpm exec node scripts/generate-smoke-fixtures.mjs
 *
 * Outputs to tests/fixtures/smoke/.
 */
import { chromium } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'tests', 'fixtures', 'smoke');
mkdirSync(OUT_DIR, { recursive: true });

// ---------------------------------------------------------------------------
// HTML templates
//
// Each template is a string of HTML+CSS that renders as a one-page A4 invoice
// when printed. We use system fonts that are available on macOS (PingFang SC)
// and Linux (Noto Sans CJK) — Playwright's Chromium picks them up natively.
// ---------------------------------------------------------------------------

/** Shared CSS prefix for all invoices. A4 portrait, Chinese-friendly typography. */
const CSS_BASE = `
<style>
  @page { size: A4; margin: 12mm; }
  body {
    font-family: 'PingFang SC', 'Noto Sans CJK SC', 'Microsoft YaHei', sans-serif;
    color: #111;
    font-size: 12pt;
    line-height: 1.4;
    margin: 0;
  }
  h1 { font-size: 22pt; text-align: center; margin: 4mm 0; }
  h2 { font-size: 14pt; margin: 6mm 0 2mm 0; }
  .meta {
    display: flex; justify-content: space-between;
    font-size: 10pt; color: #333; margin-bottom: 4mm;
  }
  table { width: 100%; border-collapse: collapse; }
  th, td {
    border: 1px solid #c00; padding: 3mm 2mm;
    text-align: left; vertical-align: middle; font-size: 11pt;
  }
  th { background: #fafafa; font-weight: 600; }
  .label { color: #444; font-size: 10pt; }
  .value { font-weight: 600; }
  .stamp {
    border: 2px solid #c00; color: #c00; display: inline-block;
    padding: 2mm 4mm; transform: rotate(-8deg);
    font-size: 12pt; font-weight: 700;
    position: absolute; right: 20mm; bottom: 20mm;
  }
  .footer { margin-top: 6mm; font-size: 10pt; color: #555; }
  .big-amount { font-size: 14pt; font-weight: 700; color: #c00; }
</style>
`;

const fixtures = [
  // -------------------------------------------------------------------------
  // 1) china_utility.v1 — 电费缴费通知单
  // -------------------------------------------------------------------------
  {
    file: '01-utility-sample.pdf',
    html: `<!doctype html><html><head><meta charset="utf-8">${CSS_BASE}</head><body>
      <h1>电费缴费通知单</h1>
      <div class="meta">
        <span>编号：DF-2026040100001</span>
        <span>出账日期：2026-05-02</span>
      </div>
      <table>
        <tr><th style="width:30%">供电公司</th><td class="value">国家电网北京电力公司海淀分公司</td></tr>
        <tr><th>户号</th><td class="value">1000-1234-5678</td></tr>
        <tr><th>用户名称</th><td>北京某科技有限公司</td></tr>
        <tr><th>用电地址</th><td>北京市海淀区中关村大街 1 号 A 座 12 层</td></tr>
        <tr><th>计费周期</th><td class="value">2026-04-01 至 2026-04-30</td></tr>
        <tr><th>用电量（kWh）</th><td class="value">1234.56</td></tr>
        <tr><th>电价（元/kWh）</th><td>0.5497</td></tr>
        <tr><th>应缴电费（元）</th><td class="big-amount">678.50</td></tr>
        <tr><th>缴费方式</th><td>自动扣款</td></tr>
        <tr><th>缴费状态</th><td class="value">已缴清</td></tr>
      </table>
      <p class="footer">本通知单为电费缴费凭证，请妥善保管。如对账单有疑义请于 30 日内联系供电公司。</p>
      <div class="stamp">国家电网 财务专用章</div>
    </body></html>`,
  },

  // -------------------------------------------------------------------------
  // 2) fuel_receipt.v1 — 加油增值税普通发票
  // -------------------------------------------------------------------------
  {
    file: '02-fuel-receipt-sample.pdf',
    html: `<!doctype html><html><head><meta charset="utf-8">${CSS_BASE}</head><body>
      <h1>电子发票（普通发票）</h1>
      <div class="meta">
        <span>发票号码：24112000000123456</span>
        <span>开票日期：2026-04-15</span>
      </div>
      <table>
        <tr>
          <th style="width:25%">销售方</th>
          <td>
            <div class="value">中国石化销售股份有限公司北京海淀加油站</div>
            <div class="label">统一社会信用代码：91110108600001234X</div>
          </td>
          <th style="width:25%">购买方</th>
          <td>
            <div class="value">北京某科技有限公司</div>
            <div class="label">统一社会信用代码：91110108MA01234567</div>
          </td>
        </tr>
      </table>
      <table style="margin-top:3mm">
        <tr><th style="width:30%">商品名称</th><th>规格</th><th>数量(升)</th><th>单价(元/升)</th><th>金额(元)</th></tr>
        <tr>
          <td class="value">*成品油*0号柴油</td>
          <td>0号</td>
          <td class="value">45.60</td>
          <td>7.85</td>
          <td class="value">357.96</td>
        </tr>
        <tr><td colspan="4" style="text-align:right">合计金额（含税）</td><td class="big-amount">357.96</td></tr>
      </table>
      <p class="footer">车牌号：京A·12345 ｜ 加油站地址：北京市海淀区西三环北路 36 号 ｜ 收银员：王芳</p>
      <div class="stamp">中国石化 发票专用章</div>
    </body></html>`,
  },

  // -------------------------------------------------------------------------
  // 3) freight.v1 — 货物运输服务电子发票
  // -------------------------------------------------------------------------
  {
    file: '03-freight-sample.pdf',
    html: `<!doctype html><html><head><meta charset="utf-8">${CSS_BASE}</head><body>
      <h1>电子发票（货物运输服务）</h1>
      <div class="meta">
        <span>发票号码：24112050000987654</span>
        <span>开票日期：2026-04-20</span>
      </div>
      <table>
        <tr>
          <th style="width:25%">承运方</th>
          <td>
            <div class="value">顺丰速运有限公司北京分公司</div>
            <div class="label">统一社会信用代码：91110105717823456X</div>
          </td>
          <th style="width:25%">托运方</th>
          <td>
            <div class="value">北京某科技有限公司</div>
            <div class="label">统一社会信用代码：91110108MA01234567</div>
          </td>
        </tr>
      </table>
      <table style="margin-top:3mm">
        <tr><th style="width:25%">运输方式</th><td class="value">公路运输（重型柴油货车）</td></tr>
        <tr><th>起运地</th><td>北京市顺义区天竺综合保税区</td></tr>
        <tr><th>到达地</th><td>上海市浦东新区外高桥保税区</td></tr>
        <tr><th>货物名称</th><td>电子设备及配件</td></tr>
        <tr><th>货物重量（kg）</th><td class="value">1500</td></tr>
        <tr><th>体积（m³）</th><td>6.5</td></tr>
        <tr><th>运单号</th><td class="value">SF1234567890CN</td></tr>
        <tr><th>运费（元）</th><td class="big-amount">2800.00</td></tr>
      </table>
      <p class="footer">本次运输于 2026-04-20 启运，2026-04-22 送达，签收人：李四。</p>
      <div class="stamp">顺丰速运 发票专用章</div>
    </body></html>`,
  },

  // -------------------------------------------------------------------------
  // 4) purchase.v1 — 增值税专用发票
  // -------------------------------------------------------------------------
  {
    file: '04-purchase-sample.pdf',
    html: `<!doctype html><html><head><meta charset="utf-8">${CSS_BASE}</head><body>
      <h1>电子发票（增值税专用发票）</h1>
      <div class="meta">
        <span>发票号码：24112099912345678</span>
        <span>开票日期：2026-04-22</span>
      </div>
      <table>
        <tr>
          <th style="width:25%">销售方</th>
          <td>
            <div class="value">宝山钢铁股份有限公司销售分公司</div>
            <div class="label">统一社会信用代码：9131000063125678XX</div>
          </td>
          <th style="width:25%">购买方</th>
          <td>
            <div class="value">北京某科技有限公司</div>
            <div class="label">统一社会信用代码：91110108MA01234567</div>
          </td>
        </tr>
      </table>
      <table style="margin-top:3mm">
        <tr><th style="width:30%">商品名称</th><th>规格</th><th>数量(kg)</th><th>单价(元/kg)</th><th>金额(元)</th></tr>
        <tr>
          <td class="value">冷轧钢板</td>
          <td>1.0×1250×2500mm</td>
          <td class="value">5000</td>
          <td>5.00</td>
          <td class="value">25000.00</td>
        </tr>
        <tr><td colspan="4" style="text-align:right">合计金额（含税）</td><td class="big-amount">25000.00</td></tr>
      </table>
      <p class="footer">品类：原材料（冷轧钢板）｜ 用途：生产用 ｜ 业务员：张三</p>
      <div class="stamp">宝山钢铁 发票专用章</div>
    </body></html>`,
  },

  // -------------------------------------------------------------------------
  // 5) travel.v1 — 航空运输电子客票行程单（经济舱短程）
  // -------------------------------------------------------------------------
  {
    file: '05-travel-sample.pdf',
    html: `<!doctype html><html><head><meta charset="utf-8">${CSS_BASE}</head><body>
      <h1>航空运输电子客票行程单</h1>
      <div class="meta">
        <span>行程单号：999-1234567890</span>
        <span>填开日期：2026-04-25</span>
      </div>
      <table>
        <tr>
          <th style="width:25%">承运方</th>
          <td>
            <div class="value">中国国际航空股份有限公司</div>
            <div class="label">统一社会信用代码：9111000010001234XX</div>
          </td>
          <th style="width:25%">购买方</th>
          <td>
            <div class="value">北京某科技有限公司</div>
            <div class="label">统一社会信用代码：91110108MA01234567</div>
          </td>
        </tr>
      </table>
      <table style="margin-top:3mm">
        <tr><th style="width:25%">旅客姓名</th><td class="value">张三</td></tr>
        <tr><th>身份证号</th><td>110108198001011234</td></tr>
        <tr><th>航班号</th><td class="value">CA1234</td></tr>
        <tr><th>舱位等级</th><td class="value">经济舱（Y）</td></tr>
        <tr><th>始发站 → 到达站</th><td class="value">北京首都国际机场（PEK） → 上海虹桥国际机场（SHA）</td></tr>
        <tr><th>起飞时间</th><td>2026-04-25 08:30</td></tr>
        <tr><th>到达时间</th><td>2026-04-25 10:50</td></tr>
        <tr><th>票价（元）</th><td>1080.00</td></tr>
        <tr><th>民航发展基金（元）</th><td>50.00</td></tr>
        <tr><th>燃油附加费（元）</th><td>70.00</td></tr>
        <tr><th>合计（元）</th><td class="big-amount">1200.00</td></tr>
      </table>
      <p class="footer">本行程单为旅客乘机及报销凭证，请妥善保管。Verified by 国家税务总局电子客票系统。</p>
      <div class="stamp">中国国际航空 发票专用章</div>
    </body></html>`,
  },
];

// ---------------------------------------------------------------------------
// Render each HTML to a one-page A4 PDF via Playwright's headless Chromium.
// ---------------------------------------------------------------------------

console.log(`[generate-smoke-fixtures] Launching Chromium…`);
const browser = await chromium.launch();
const context = await browser.newContext();
const page = await context.newPage();

for (const { file, html } of fixtures) {
  const outPath = join(OUT_DIR, file);
  await page.setContent(html, { waitUntil: 'load' });
  const pdf = await page.pdf({
    format: 'A4',
    printBackground: true,
    margin: { top: '0', bottom: '0', left: '0', right: '0' },
  });
  writeFileSync(outPath, pdf);
  console.log(`  wrote ${file} (${pdf.length} bytes)`);
}

await browser.close();
console.log(`[generate-smoke-fixtures] Done. ${fixtures.length} files in ${OUT_DIR}.`);
