import {
  LlmNarrativeCanceled,
  LlmNarrativeRefused,
  type ReportNarrativeProgressEvent,
} from '@main/llm/report-narrative.js';
import { runAiObject } from '@main/llm/run-ai.js';
import type { CredentialService } from '@main/services/credential-service.js';
import type { InventoryReportData } from '@main/services/report-data-service';
import type { ProviderConfigV2 } from '@shared/types.js';
import { z } from 'zod';

/**
 * TCFD four-pillar narrative (spec 2026-07-22-tcfd-report, ROADMAP
 * §8.1-⑥ v1): Governance / Strategy / Risk Management / Metrics & Targets.
 * The pillar structure is stable year over year (unlike CDP's questionnaire)
 * and doubles as the climate chapter of China A-share ESG disclosures.
 */
export const TcfdNarrativeSchema = z.object({
  governance: z.string().min(80).max(1200),
  strategy: z.string().min(80).max(1500),
  risk_management: z.string().min(80).max(1200),
  metrics_targets: z.string().min(100).max(1500),
});

export type TcfdNarrative = z.infer<typeof TcfdNarrativeSchema>;

export type TcfdNarrativeSubPhase =
  | 'governance'
  | 'strategy'
  | 'risk-management'
  | 'metrics-targets';

function buildSystemPrompt(lang: 'zh-CN' | 'en'): string {
  if (lang === 'zh-CN') {
    return `你是气候相关财务信息披露 (TCFD) 报告撰稿人, 为一家企业撰写四支柱披露: 治理 (governance)、战略 (strategy)、风险管理 (risk_management)、指标与目标 (metrics_targets)。严格遵循以下规则:

1. 你只能使用 <inventory> 块中提供的数字与名称。任何 <inventory> 中不存在的事实, 一律写 "本期未评估"。严禁推测、补充或虚构。
2. 不要在文本中改动 <inventory> 给出的数字。
3. <inventory> 只包含温室气体盘查数据。气候风险、机遇、情景分析、内部碳价若无数据, 相应段落写 "本期未开展定量评估", 并克制地说明四支柱框架下该披露项的含义与后续完善方向——不要编造任何情景或风险量化结果。
4. metrics_targets 必须引用 <inventory> 的范围一/二/三合计与主要排放源, 并披露排放因子的 GWP 基准 (AR5 / AR6); 若有基准年或上期数据, 须给出对比。
5. 语气专业、克制、不夸张。每段 250-500 字。
6. 输出必须是 JSON, 完全符合给定 schema, 不要添加 schema 外的字段。`;
  }
  return `You are a TCFD (Task Force on Climate-related Financial Disclosures) report writer producing the four pillars: governance, strategy, risk_management, metrics_targets. Strict rules:

1. You may only use numbers and names from the <inventory> block. For any fact not present in <inventory>, write "Not assessed in this period". No speculation, no extrapolation, no fabrication.
2. Do not alter numbers from <inventory>.
3. <inventory> contains GHG inventory data only. Where climate risks, opportunities, scenario analysis, or internal carbon pricing have no data, the section must state "No quantitative assessment was performed this period" and soberly explain what that TCFD disclosure covers and how it could be developed — never invent scenarios or risk quantifications.
4. metrics_targets must cite the Scope 1/2/3 totals and main emission sources from <inventory>, disclose the GWP basis (AR5 / AR6), and compare against the base year or prior period when present.
5. Tone: professional, restrained, never promotional. Each section 250-500 words.
6. Output must be JSON matching the schema exactly, no extra fields.`;
}

function buildUserMessage(data: InventoryReportData): string {
  return `<inventory>\n${JSON.stringify(data, null, 2)}\n</inventory>`;
}

/**
 * Generate the four-pillar TCFD narrative. Mirrors
 * {@link generateReportNarrative}'s contract exactly — single runAiObject
 * round-trip, pre/post abort checks raising LlmNarrativeCanceled,
 * AiSchemaMismatch translated to LlmNarrativeRefused — so the IPC handler
 * branches identically for both report kinds.
 */
export async function generateTcfdNarrative(args: {
  data: InventoryReportData;
  config: ProviderConfigV2;
  credentials: CredentialService;
  onProgress: (ev: ReportNarrativeProgressEvent) => void;
  abortSignal: AbortSignal;
}): Promise<TcfdNarrative> {
  const { data, config, credentials, onProgress, abortSignal } = args;

  if (abortSignal.aborted) {
    throw new LlmNarrativeCanceled();
  }
  onProgress({ sub_phase: null });

  try {
    const result = await runAiObject(config, credentials, {
      schema: TcfdNarrativeSchema,
      system: buildSystemPrompt(data.language),
      prompt: buildUserMessage(data),
    });
    if (abortSignal.aborted) {
      throw new LlmNarrativeCanceled();
    }
    return result;
  } catch (err) {
    if (err instanceof LlmNarrativeCanceled) throw err;
    if (abortSignal.aborted) throw new LlmNarrativeCanceled();
    if ((err as Error)?.name === 'AbortError') throw new LlmNarrativeCanceled();
    const tag = (err as { _tag?: string })?._tag;
    if (tag === 'AiSchemaMismatch') {
      throw new LlmNarrativeRefused(
        `LLM returned schema-invalid TCFD narrative: ${(err as Error).message}`,
      );
    }
    throw err;
  }
}
