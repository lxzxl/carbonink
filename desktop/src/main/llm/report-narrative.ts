import { runAiObject } from '@main/llm/run-ai.js';
import type { CredentialService } from '@main/services/credential-service.js';
import type { InventoryReportData } from '@main/services/report-data-service';
import type { ProviderConfigV2 } from '@shared/types.js';
import { z } from 'zod';

export const ReportNarrativeSchema = z.object({
  boundary_description: z.string().min(50).max(800),
  reporting_boundary_description: z.string().min(50).max(800),
  methodology_description: z.string().min(100).max(1200),
  emissions_summary: z.string().min(100).max(1500),
  significant_changes: z.string().min(20).max(800),
  notable_observations: z.string().min(50).max(800),
});

export type ReportNarrative = z.infer<typeof ReportNarrativeSchema>;

export type ReportNarrativeSubPhase =
  | 'boundary'
  | 'reporting-boundary'
  | 'methodology'
  | 'emissions'
  | 'changes'
  | 'observations';

export interface ReportNarrativeProgressEvent {
  sub_phase: ReportNarrativeSubPhase | null;
}

export class LlmNarrativeCanceled extends Error {
  readonly _tag = 'LlmNarrativeCanceled' as const;
  constructor() {
    super('Report narrative generation canceled');
  }
}

export class LlmNarrativeRefused extends Error {
  readonly _tag = 'LlmNarrativeRefused' as const;
}

function buildSystemPrompt(lang: 'zh-CN' | 'en'): string {
  if (lang === 'zh-CN') {
    return `你是 ISO 14064-1:2018 GHG 盘查报告撰稿人。严格遵循以下规则:

1. 你只能使用 <inventory> 块中提供的数字与名称。任何 <inventory> 中不存在的事实, 一律写 "本期未评估"。严禁推测、补充或虚构。
2. 不要在文本中改动 <inventory> 给出的数字 (允许换算单位时另当别论)。
3. 语气专业、克制、不夸张。每个 section 250-450 字之间。
4. 边界方法措辞: equity_share → "股权法"; financial_control → "财务控制法"; operational_control → "运营控制法"。
5. 排放因子来源信息若 <inventory> 提供, 在 methodology_description 中必须披露 GWP 基准 (AR5 / AR6)。
6. 输出必须是 JSON, 完全符合给定 schema, 不要添加 schema 外的字段。`;
  }
  return `You are an ISO 14064-1:2018 GHG inventory report writer. Strict rules:

1. You may only use numbers and names from the <inventory> block. For any fact not present in <inventory>, write "Not assessed in this inventory". No speculation, no extrapolation, no fabrication.
2. Do not alter numbers from <inventory> (unit conversion is allowed when explicit).
3. Tone: professional, restrained, never promotional. Each section 250-450 words.
4. Boundary phrasing: equity_share → "equity share"; financial_control → "financial control"; operational_control → "operational control".
5. If <inventory> includes EF source provenance, the methodology_description must disclose the GWP basis (AR5 / AR6).
6. Output must be JSON matching the schema exactly, no extra fields.`;
}

function buildUserMessage(data: InventoryReportData): string {
  return `<inventory>\n${JSON.stringify(data, null, 2)}\n</inventory>`;
}

/**
 * Generate the 6-section ISO 14064-1 narrative for a report.
 *
 * Phase 1 of the pi-ai migration (Task 8): swapped from the old
 * `streamObject`-based provider shim onto `runAiObject` — the same
 * Promise-boundary helper used by extraction / ef-matcher /
 * questionnaire services.
 *
 * Trade-offs vs the old streaming path:
 *
 * - **No mid-call partial events.** AiClient's `generateObject` is a
 *   single round-trip — there's no `partialObjectStream` to walk for
 *   per-section progress. The renderer's progress label stays on
 *   "assembling" / "narrative" until the full payload returns and
 *   then jumps to "finalizing". The renderer already tolerates
 *   `sub_phase: null` (see `reports.$id.tsx` switch fallthrough);
 *   we still call `onProgress` to honour the public shape but only
 *   emit a single `{ sub_phase: null }` "we're working" tick.
 *   Streaming UX is future work — see AiClient JSDoc.
 *
 * - **AbortSignal is only honoured pre-call.** `runAiObject` doesn't
 *   thread an external abort into pi-ai's HTTP layer, so once the
 *   model round-trip starts, clicking Cancel marks the controller as
 *   aborted but the in-flight request runs to completion. The handler
 *   still discards the result via the `controller.signal.aborted`
 *   check after `generateReportNarrative` returns. We check
 *   `abortSignal.aborted` at the top so a cancel that lands *before*
 *   the LLM call still raises `LlmNarrativeCanceled` synchronously
 *   (the test that pre-aborts the controller depends on this).
 *
 * - **Schema validation moves to AiClient.** Old code re-ran
 *   `ReportNarrativeSchema.safeParse` after the stream completed
 *   because `streamObject`'s `object` Promise was permissive. The new
 *   path's `runAiObject({ schema })` enforces the schema via pi-ai's
 *   tool-call envelope (see `ai-client.ts`); a mismatch surfaces as
 *   `AiSchemaMismatch`, which we translate to `LlmNarrativeRefused`
 *   to preserve the handler's existing branching.
 */
export async function generateReportNarrative(args: {
  data: InventoryReportData;
  config: ProviderConfigV2;
  credentials: CredentialService;
  onProgress: (ev: ReportNarrativeProgressEvent) => void;
  abortSignal: AbortSignal;
}): Promise<ReportNarrative> {
  const { data, config, credentials, onProgress, abortSignal } = args;

  // Pre-call abort short-circuit. Once the LLM round-trip begins,
  // cancellation no longer interrupts it (see JSDoc); checking here
  // preserves the "abort before generate" path the existing tests
  // exercise and matches the old streamObject behaviour for the
  // already-aborted case.
  if (abortSignal.aborted) {
    throw new LlmNarrativeCanceled();
  }

  // The old streaming path emitted six sub-phase markers as the model
  // filled each field. Without `partialObjectStream` we can't observe
  // intermediate state — emit a single null-phase tick so callers that
  // count progress events still see the "we have started" signal.
  // The renderer treats null as "keep current label", which is fine
  // because the handler emits `phase: 'narrative'` immediately before
  // calling us.
  onProgress({ sub_phase: null });

  try {
    const result = await runAiObject(config, credentials, {
      schema: ReportNarrativeSchema,
      system: buildSystemPrompt(data.language),
      prompt: buildUserMessage(data),
    });
    // Post-call abort check. If the user clicked Cancel while the
    // LLM round-trip was in flight, the abort didn't interrupt the
    // request (see JSDoc) but we still honour the user's intent by
    // discarding the result and surfacing the canonical cancel error.
    if (abortSignal.aborted) {
      throw new LlmNarrativeCanceled();
    }
    return result;
  } catch (err) {
    if (err instanceof LlmNarrativeCanceled) throw err;
    if (abortSignal.aborted) throw new LlmNarrativeCanceled();
    if ((err as Error)?.name === 'AbortError') throw new LlmNarrativeCanceled();
    // pi-ai's tool-call envelope failed schema validation. Re-throw as
    // `LlmNarrativeRefused` so the IPC handler's existing `_tag` switch
    // ("Refused" branch) keeps working unchanged.
    const tag = (err as { _tag?: string })?._tag;
    if (tag === 'AiSchemaMismatch') {
      throw new LlmNarrativeRefused(
        `LLM returned schema-invalid narrative: ${(err as Error).message}`,
      );
    }
    throw err;
  }
}
