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

// Re-export AiClientTag so downstream callers (handlers, tests) can compose
// the answer-generation environment without reaching into `@main/llm/ai-client`
// directly.
export { AiClientTag };

export type AnswerR = DbTag | AiClientTag | OrgServiceTag | ActivityDataServiceTag | NowTag;

export interface AnswerDeps {
  db: Database;
  /**
   * Pre-built layer that provides {@link AiClientTag}. The caller (IPC
   * context) constructs this via `buildAiClientLayer(...)` so the answer
   * service stays oblivious to the credential/provider plumbing — it just
   * yields the Tag and lets the layer supply the implementation.
   */
  aiLayer: Layer.Layer<AiClientTag>;
  orgService: OrganizationService;
  activityDataService: ActivityDataService;
  now?: () => string;
}

export function buildAnswerLayer(deps: AnswerDeps): Layer.Layer<AnswerR> {
  return Layer.mergeAll(
    Layer.succeed(DbTag, deps.db),
    deps.aiLayer,
    Layer.succeed(OrgServiceTag, deps.orgService),
    Layer.succeed(ActivityDataServiceTag, deps.activityDataService),
    Layer.succeed(NowTag, deps.now ?? (() => new Date().toISOString())),
  );
}
