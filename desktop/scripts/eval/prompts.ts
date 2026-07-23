/**
 * Prompt variants — the variable we hold against a frozen golden set.
 *
 * This is the point of prompt eval: change ONE thing (the prompt), keep the
 * model + golden + comparators fixed, and read the accuracy delta off the
 * table instead of guessing whether the new prompt "feels" better.
 *
 * `current` is the REAL production prompt (imported from the app, so the eval
 * measures what actually ships). Add your own variants below and pass them with
 * `--prompts current,terse,myidea`.
 */

import { chinaUtilityStage } from '../../src/main/llm/stages/china-utility.ts';

/** Variant A — the shipping prompt. The thing to beat. */
const current = (billText: string): string => chinaUtilityStage.buildPrompt(billText);

/**
 * Variant B — a deliberately leaner prompt. It OMITS the verbose rules in the
 * production prompt (万度 → ×10000, year-month → first/last day, null-handling,
 * the few-shot example). Hypothesis: those rules cost tokens but earn accuracy.
 * The golden set has items that exercise exactly those rules (util-02, util-05),
 * so a leaner prompt should measurably lose points there — demonstrating the
 * eval catching a prompt regression.
 */
const terse = (
  billText: string,
): string => `Extract these fields from the Chinese electricity bill and return ONE JSON object (no prose, no code fences):
- doc_type: always "china_utility"
- supplier_name: utility company name (string; "" if illegible)
- account_no: 户号 / 用户编号 (string, or null if absent)
- amount_kwh: 用电量 in kWh, as a number
- amount_yuan: 应收合计 in CNY, as a number (or null)
- period_start, period_end: billing period, "YYYY-MM-DD"
- confidence: "high" | "medium" | "low"

<bill>
${billText}
</bill>`;

export const PROMPTS: Record<string, (billText: string) => string> = { current, terse };
