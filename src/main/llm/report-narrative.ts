import type { InventoryReportData } from '@main/services/report-data-service';
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

/**
 * The "provider" abstraction is intentionally narrow — it is whatever wraps
 * `streamObject` from AI SDK 6. In production it's bound by
 * `LlmClient.streamObjectFor('report-narrative')`; in tests we hand-roll a
 * shim that yields partial deltas.
 */
export interface ReportNarrativeProvider {
  streamObject: (args: {
    schema: typeof ReportNarrativeSchema;
    system: string;
    user: string;
    abortSignal: AbortSignal;
  }) => Promise<{
    object: Promise<ReportNarrative>;
    partialObjectStream: AsyncIterable<Partial<ReportNarrative>>;
  }>;
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

const FIELD_TO_SUBPHASE: Record<keyof ReportNarrative, ReportNarrativeSubPhase> = {
  boundary_description: 'boundary',
  reporting_boundary_description: 'reporting-boundary',
  methodology_description: 'methodology',
  emissions_summary: 'emissions',
  significant_changes: 'changes',
  notable_observations: 'observations',
};

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

export async function generateReportNarrative(args: {
  data: InventoryReportData;
  provider: ReportNarrativeProvider;
  onProgress: (ev: ReportNarrativeProgressEvent) => void;
  abortSignal: AbortSignal;
}): Promise<ReportNarrative> {
  const { data, provider, onProgress, abortSignal } = args;
  try {
    const { object, partialObjectStream } = await provider.streamObject({
      schema: ReportNarrativeSchema,
      system: buildSystemPrompt(data.language),
      user: buildUserMessage(data),
      abortSignal,
    });

    // Watch which key is currently filling.
    const seen = new Set<keyof ReportNarrative>();
    let lastEmitted: ReportNarrativeSubPhase | null = null;
    for await (const partial of partialObjectStream) {
      for (const k of Object.keys(partial) as Array<keyof ReportNarrative>) {
        if (!seen.has(k)) {
          seen.add(k);
          const phase = FIELD_TO_SUBPHASE[k];
          if (phase && phase !== lastEmitted) {
            lastEmitted = phase;
            onProgress({ sub_phase: phase });
          }
        }
      }
    }
    const final = await object;
    const parsed = ReportNarrativeSchema.safeParse(final);
    if (!parsed.success) {
      throw new LlmNarrativeRefused(`LLM returned schema-invalid narrative: ${parsed.error.message}`);
    }
    return parsed.data;
  } catch (err) {
    if (abortSignal.aborted) throw new LlmNarrativeCanceled();
    if ((err as Error)?.name === 'AbortError') throw new LlmNarrativeCanceled();
    throw err;
  }
}
