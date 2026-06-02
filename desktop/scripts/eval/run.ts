/**
 * Extraction eval — china_utility stage, DeepSeek flash vs pro × prompt variants.
 *
 * Runs the REAL stage schema + production prompt against a frozen golden set,
 * scores each field with typed comparators, and reports accuracy AND cost:
 * tokens, $/1k-docs, p50 latency, and the reasoner's structured-output
 * "wrap rate". Zero app-DB / Electron — just the stage (pure data) + pi-ai.
 *
 * Run (from desktop/):
 *   DEEPSEEK_API_KEY=sk-... pnpm eval:extract
 *   ... pnpm eval:extract --models deepseek-v4-flash --prompts current,terse --runs 3
 *
 * Flags:
 *   --provider  pi-ai provider id              (default: deepseek)
 *   --models    comma list of model ids        (default: deepseek-v4-flash,deepseek-v4-pro)
 *   --prompts   comma list of prompt variants   (default: current,terse) — see prompts.ts
 *   --runs      repeats per item                (default: 1) — raise to measure flaky models
 *
 * Cost: tokens + latency are measured directly and always shown. $/1k-docs
 * needs per-token prices — fill in PRICES below (they vary by model/region).
 *
 * Offline / not CI: real model calls cost money + aren't deterministic. Only
 * the comparators (compare.ts) are CI-safe.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { complete, getModel } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { chinaUtilityExtraction } from '../../src/main/llm/stages/china-utility.ts';
import { CRITICAL_FIELDS, FIELD_SPECS, scoreItem } from './compare.ts';
import { PROMPTS } from './prompts.ts';

const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Per-1M-token prices (USD). These VARY by model / region / cache hits and
 * change over time, so they're CONFIG, not measured — fill in your real
 * DeepSeek rates. Leave both at 0 to report tokens only (the $/1k column shows
 * "–"). Tokens + latency are always measured directly.
 */
const PRICES: Record<string, { in: number; out: number }> = {
  'deepseek-v4-flash': { in: 0, out: 0 },
  'deepseek-v4-pro': { in: 0, out: 0 },
};

interface GoldenItem {
  id: string;
  note?: string;
  billText: string;
  expected: Record<string, unknown>;
}

const { values } = parseArgs({
  options: {
    provider: { type: 'string', default: 'deepseek' },
    models: { type: 'string', default: 'deepseek-v4-flash,deepseek-v4-pro' },
    prompts: { type: 'string', default: 'current,terse' },
    runs: { type: 'string', default: '1' },
  },
});

const provider = String(values.provider);
const models = String(values.models).split(',').map((s) => s.trim()).filter(Boolean);
const promptNames = String(values.prompts).split(',').map((s) => s.trim()).filter(Boolean);
const runs = Math.max(1, Number(values.runs) || 1);

const apiKey = process.env.DEEPSEEK_API_KEY ?? process.env.EVAL_API_KEY;
if (!apiKey) {
  console.error('✗ Set DEEPSEEK_API_KEY (or EVAL_API_KEY) in the environment.');
  process.exit(1);
}
for (const p of promptNames) {
  if (!PROMPTS[p]) {
    console.error(`✗ Unknown prompt variant "${p}". Known: ${Object.keys(PROMPTS).join(', ')}`);
    process.exit(1);
  }
}

const golden: GoldenItem[] = JSON.parse(
  readFileSync(join(HERE, 'golden', 'china-utility.json'), 'utf-8'),
);

const jsonSchema = z.toJSONSchema(chinaUtilityExtraction);
const tool = {
  name: 'submit_response',
  description: 'Submit the extracted bill fields as a single structured object.',
  parameters: jsonSchema as Record<string, unknown>,
};

function extractJsonFromText(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const body = fenced ? fenced[1] : text;
  const s = body.indexOf('{');
  const e = body.lastIndexOf('}');
  if (s === -1 || e === -1 || e < s) return null;
  try {
    return JSON.parse(body.slice(s, e + 1));
  } catch {
    return null;
  }
}

/**
 * Some models (esp. reasoners) wrap the answer in an envelope —
 * `{ response: {...} }` or `{ response: "<json string>" }` — instead of the
 * flat schema fields. Unwrap it so the call is scoreable, and report `wrapped`
 * so we can measure how often it happens (format reliability, separate from
 * extraction accuracy).
 */
function unwrapEnvelope(raw: unknown): { raw: unknown; wrapped: boolean } {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    if (!('doc_type' in obj) && 'response' in obj) {
      const inner = obj.response;
      if (typeof inner === 'string') {
        const parsed = extractJsonFromText(inner);
        if (parsed && typeof parsed === 'object') return { raw: parsed, wrapped: true };
      }
      if (inner && typeof inner === 'object') return { raw: inner, wrapped: true };
    }
  }
  return { raw, wrapped: false };
}

type Usage = { input: number; output: number };
type CallResult =
  | { ok: true; value: Record<string, unknown>; usage: Usage; latencyMs: number; wrapped: boolean }
  | { ok: false; error: string; raw?: unknown; usage?: Usage; latencyMs?: number };

function costUsd(model: string, u: Usage): number {
  const p = PRICES[model];
  if (!p) return 0;
  return (u.input / 1e6) * p.in + (u.output / 1e6) * p.out;
}

async function callModel(modelId: string, prompt: string): Promise<CallResult> {
  const model = (getModel as (p: string, m: string) => unknown)(provider, modelId);
  if (!model) return { ok: false, error: `pi-ai has no model ${provider}/${modelId}` };

  let msg: {
    stopReason?: string;
    errorMessage?: string;
    usage?: { input?: number; output?: number };
    content?: Array<{ type?: string; name?: string; arguments?: unknown; text?: string }>;
  };
  const t0 = Date.now();
  try {
    msg = await (complete as (m: unknown, req: unknown, opts: unknown) => Promise<typeof msg>)(
      model,
      { messages: [{ role: 'user', content: prompt, timestamp: Date.now() }], tools: [tool] },
      { apiKey, maxRetries: 1 },
    );
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e), latencyMs: Date.now() - t0 };
  }
  const latencyMs = Date.now() - t0;
  const usage: Usage = { input: msg?.usage?.input ?? 0, output: msg?.usage?.output ?? 0 };
  if (msg?.stopReason === 'error') {
    return { ok: false, error: msg.errorMessage ?? 'provider error', usage, latencyMs };
  }

  const content = msg?.content ?? [];
  const toolCall = content.find((c) => c?.type === 'toolCall' && c?.name === 'submit_response');
  const rawText = content.filter((c) => c?.type === 'text').map((c) => c.text ?? '').join('');
  const { raw, wrapped } = unwrapEnvelope(toolCall?.arguments ?? extractJsonFromText(rawText));
  if (raw == null || typeof raw !== 'object') {
    return { ok: false, error: 'no structured output', raw: rawText.slice(0, 800), usage, latencyMs };
  }
  const parsed = chinaUtilityExtraction.safeParse(raw);
  if (!parsed.success) {
    const where = parsed.error.issues.map((i) => i.path.join('.')).join(',');
    return { ok: false, error: `schema mismatch (${where})`, raw, usage, latencyMs };
  }
  return { ok: true, value: parsed.data as Record<string, unknown>, usage, latencyMs, wrapped };
}

interface Cell {
  model: string;
  prompt: string;
  n: number;
  errors: number;
  fieldHits: Record<string, number>;
  allHits: number;
  criticalHits: number;
  inTok: number;
  outTok: number;
  cost: number;
  latencies: number[];
  wrapped: number;
}

const FIELDS = Object.keys(FIELD_SPECS);
const SHORT: Record<string, string> = {
  supplier_name: 'suppl',
  account_no: 'acct',
  amount_kwh: 'kWh*',
  amount_yuan: 'yuan',
  period_start: 'pStart',
  period_end: 'pEnd',
};

function pct(hit: number, n: number): string {
  return n === 0 ? '  –  ' : `${((100 * hit) / n).toFixed(0).padStart(3)}%`;
}
function p50(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
}
function renderTable(header: string[], rows: string[][]): string {
  const widths = header.map((h, i) => Math.max(h.length, ...rows.map((r) => r[i].length)));
  const line = (cols: string[]) => `| ${cols.map((c, i) => c.padEnd(widths[i])).join(' | ')} |`;
  const sep = `| ${widths.map((w) => '-'.repeat(w)).join(' | ')} |`;
  return [line(header), sep, ...rows.map(line)].join('\n');
}

async function main(): Promise<void> {
  console.error(
    `\n▶ eval: ${golden.length} bills × ${models.length} model(s) × ${promptNames.length} prompt(s) × ${runs} run(s) ` +
      `= ${golden.length * models.length * promptNames.length * runs} calls\n`,
  );

  const cells: Cell[] = [];
  const perItem: Array<Record<string, unknown>> = [];

  for (const model of models) {
    for (const promptName of promptNames) {
      const buildPrompt = PROMPTS[promptName];
      const cell: Cell = {
        model,
        prompt: promptName,
        n: 0,
        errors: 0,
        fieldHits: Object.fromEntries(FIELDS.map((f) => [f, 0])),
        allHits: 0,
        criticalHits: 0,
        inTok: 0,
        outTok: 0,
        cost: 0,
        latencies: [],
        wrapped: 0,
      };

      for (const item of golden) {
        for (let r = 0; r < runs; r++) {
          process.stderr.write(`  ${model} · ${promptName} · ${item.id} #${r + 1} … `);
          const res = await callModel(model, buildPrompt(item.billText));
          cell.n++;

          // Cost/latency are charged on EVERY call (an unparseable response
          // still burned tokens), so accumulate them regardless of ok/error.
          if (res.usage) {
            cell.inTok += res.usage.input;
            cell.outTok += res.usage.output;
            cell.cost += costUsd(model, res.usage);
          }
          if (res.latencyMs != null) cell.latencies.push(res.latencyMs);

          if (!res.ok) {
            cell.errors++;
            const docType =
              res.raw && typeof res.raw === 'object'
                ? ` doc_type=${JSON.stringify((res.raw as Record<string, unknown>).doc_type)}`
                : '';
            process.stderr.write(`ERR (${res.error})${docType}\n`);
            perItem.push({
              model,
              prompt: promptName,
              item: item.id,
              run: r + 1,
              error: res.error,
              raw: res.raw,
              usage: res.usage,
              latencyMs: res.latencyMs,
            });
            continue;
          }

          if (res.wrapped) cell.wrapped++;
          const score = scoreItem(item.expected, res.value);
          for (const f of FIELDS) if (score.fields[f]) cell.fieldHits[f]++;
          if (score.allHit) cell.allHits++;
          if (score.criticalHit) cell.criticalHits++;
          const missed = FIELDS.filter((f) => !score.fields[f]);
          process.stderr.write(
            `${score.allHit ? '✓' : `✗ [${missed.join(',')}]`}${res.wrapped ? ' (unwrapped)' : ''}\n`,
          );
          perItem.push({
            model,
            prompt: promptName,
            item: item.id,
            run: r + 1,
            fields: score.fields,
            allHit: score.allHit,
            wrapped: res.wrapped,
            usage: res.usage,
            latencyMs: res.latencyMs,
            actual: res.value,
          });
        }
      }
      cells.push(cell);
    }
  }

  const ok = (c: Cell) => c.n - c.errors;

  // ---- Table 1: accuracy ----
  const accHeader = ['model', 'prompt', ...FIELDS.map((f) => SHORT[f]), 'ALL', 'CRIT', 'err', 'n'];
  const accRows = cells.map((c) => [
    c.model,
    c.prompt,
    ...FIELDS.map((f) => pct(c.fieldHits[f], ok(c))),
    pct(c.allHits, ok(c)),
    pct(c.criticalHits, ok(c)),
    String(c.errors),
    String(c.n),
  ]);
  console.log(`\n## Accuracy — china_utility  (kWh* = critical; % over non-errored calls)\n`);
  console.log(renderTable(accHeader, accRows));

  // ---- Table 2: cost & performance ----
  const anyPrice = Object.values(PRICES).some((p) => p.in > 0 || p.out > 0);
  const perfHeader = ['model', 'prompt', 'inTok', 'outTok', '$/1k', 'p50 ms', 'wrap', 'err', 'n'];
  const perfRows = cells.map((c) => [
    c.model,
    c.prompt,
    String(c.n ? Math.round(c.inTok / c.n) : 0),
    String(c.n ? Math.round(c.outTok / c.n) : 0),
    anyPrice ? `$${(c.n ? (c.cost / c.n) * 1000 : 0).toFixed(2)}` : '–',
    String(p50(c.latencies)),
    String(c.wrapped),
    String(c.errors),
    String(c.n),
  ]);
  console.log(
    `\n## Cost & performance  (inTok/outTok = avg/call; $/1k = per 1000 docs; wrap = envelope-unwrapped count)\n`,
  );
  console.log(renderTable(perfHeader, perfRows));
  if (!anyPrice) console.log('\n  ↳ set PRICES in run.ts (per-1M-token rates) to populate $/1k.');
  console.log('');

  // ---- Archive raw results for regression diffing ----
  const outDir = join(HERE, 'results');
  mkdirSync(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outFile = join(outDir, `extract-china_utility-${stamp}.json`);
  writeFileSync(
    outFile,
    JSON.stringify({ provider, models, promptNames, runs, prices: PRICES, cells, perItem }, null, 2),
  );
  console.error(`↳ raw results: ${outFile}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
