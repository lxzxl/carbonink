import type { LLMClient } from '@main/llm/llm-client';
import type { ActivityDataService } from '@main/services/activity-data-service';
import type { OrganizationService } from '@main/services/organization-service';
import type { Database } from 'better-sqlite3';
import { Context, Layer } from 'effect';

export class DbTag extends Context.Tag('answer/Db')<DbTag, Database>() {}
export class LLMClientTag extends Context.Tag('answer/LLMClient')<LLMClientTag, LLMClient>() {}
export class OrgServiceTag extends Context.Tag('answer/OrgService')<
  OrgServiceTag,
  OrganizationService
>() {}
export class ActivityDataServiceTag extends Context.Tag('answer/ActivityDataService')<
  ActivityDataServiceTag,
  ActivityDataService
>() {}
export class NowTag extends Context.Tag('answer/Now')<NowTag, () => string>() {}

export type AnswerR = DbTag | LLMClientTag | OrgServiceTag | ActivityDataServiceTag | NowTag;

export interface AnswerDeps {
  db: Database;
  llmClient: LLMClient;
  orgService: OrganizationService;
  activityDataService: ActivityDataService;
  now?: () => string;
}

export function buildAnswerLayer(deps: AnswerDeps): Layer.Layer<AnswerR> {
  return Layer.mergeAll(
    Layer.succeed(DbTag, deps.db),
    Layer.succeed(LLMClientTag, deps.llmClient),
    Layer.succeed(OrgServiceTag, deps.orgService),
    Layer.succeed(ActivityDataServiceTag, deps.activityDataService),
    Layer.succeed(NowTag, deps.now ?? (() => new Date().toISOString())),
  );
}
