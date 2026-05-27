import { type AgentTool, AiAgentTag } from '@main/llm/ai-agent.js';
import { AiClientTag } from '@main/llm/ai-client.js';
import type { ActivityDataService } from '@main/services/activity-data-service';
import type { OrganizationService } from '@main/services/organization-service';
import type { Database } from 'better-sqlite3';
import { Context, Layer } from 'effect';

export class DbTag extends Context.Tag('answer/Db')<DbTag, Database>() {}
export class OrgServiceTag extends Context.Tag('answer/OrgService')<
  OrgServiceTag,
  OrganizationService
>() {}
export class ActivityDataServiceTag extends Context.Tag('answer/ActivityDataService')<
  ActivityDataServiceTag,
  ActivityDataService
>() {}
export class NowTag extends Context.Tag('answer/Now')<NowTag, () => string>() {}

/**
 * Carries the pre-built read-only inventory tools the agent loop uses.
 *
 * Tools are constructed once per IPC request (in `context.ts`) with the
 * active organization id closed into each `execute`. By passing them
 * through a Tag (rather than reaching for the underlying services from
 * inside `generate()`), the answer-generation service stays oblivious to
 * the org-scoping plumbing — it just yields the toolbox and hands it to
 * `runAgent`. Tests inject a `[]` or hand-rolled `AgentTool[]` without
 * touching real services.
 */
export class AnswerToolsTag extends Context.Tag('answer/Tools')<AnswerToolsTag, AgentTool[]>() {}

// Re-export AiClientTag + AiAgentTag so downstream callers (handlers, tests)
// can compose the answer-generation environment without reaching into
// `@main/llm/ai-client` / `@main/llm/ai-agent` directly.
export { AiAgentTag, AiClientTag };

export type AnswerR =
  | DbTag
  | AiClientTag
  | AiAgentTag
  | AnswerToolsTag
  | OrgServiceTag
  | ActivityDataServiceTag
  | NowTag;

export interface AnswerDeps {
  db: Database;
  /**
   * Pre-built layer that provides {@link AiClientTag}. Used by the
   * single-shot fallback path (`./fallback.ts`) — the layer carries the
   * provider/credential binding so the answer service stays oblivious to
   * that plumbing.
   */
  aiLayer: Layer.Layer<AiClientTag>;
  /**
   * Pre-built layer that provides {@link AiAgentTag}. Used by the agent
   * path (`./agent-loop.ts`). Built alongside `aiLayer` from the same
   * provider config so both single-shot + agent paths see the same
   * model selection.
   */
  aiAgentLayer: Layer.Layer<AiAgentTag>;
  /**
   * Pre-built layer that provides {@link AnswerToolsTag}. The IPC context
   * constructs the tools once per request with the active organization's
   * services + org id closed in.
   */
  toolsLayer: Layer.Layer<AnswerToolsTag>;
  orgService: OrganizationService;
  activityDataService: ActivityDataService;
  now?: () => string;
}

export function buildAnswerLayer(deps: AnswerDeps): Layer.Layer<AnswerR> {
  return Layer.mergeAll(
    Layer.succeed(DbTag, deps.db),
    deps.aiLayer,
    deps.aiAgentLayer,
    deps.toolsLayer,
    Layer.succeed(OrgServiceTag, deps.orgService),
    Layer.succeed(ActivityDataServiceTag, deps.activityDataService),
    Layer.succeed(NowTag, deps.now ?? (() => new Date().toISOString())),
  );
}
