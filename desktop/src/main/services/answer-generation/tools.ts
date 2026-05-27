/**
 * Read-only inventory tools exposed to the answer-generation agent loop.
 *
 * Each tool is a thin {@link AgentTool} wrapper around an existing service
 * method. The agent calls `submit_response` (injected by `AiAgent.run()` —
 * not defined here) to finalize; everything in this file is *retrieval*.
 *
 * Multi-tenant defense in depth: `organization_id` is injected at deps-build
 * time and stamped into every service call below — the LLM never sees or
 * supplies it, so it can't "wander" to another org's data even though Phase
 * 1a enforces a single-org singleton at the schema level (see
 * `OrganizationService.createOrganization`). The questionnaire-context tool
 * is the one exception: `questionnaire` doesn't have an `organization_id`
 * column (it links to `customer`, not to org), so the safety story for that
 * tool relies on the singleton invariant. Revisit if a multi-org model lands.
 */
import type { AgentTool } from '@main/llm/ai-agent.js';
import type { ActivityDataService } from '@main/services/activity-data-service.js';
import type { EmissionSourceService } from '@main/services/emission-source-service.js';
import type { QuestionnaireService } from '@main/services/questionnaire-service.js';
import { z } from 'zod';

/**
 * Service surface the tools consume. `Pick`s keep tests honest — a mock only
 * has to implement the one method it's asked about, not the whole service.
 *
 * `ActivityDataService.getByIdWithEf` doubles as the source of truth for
 * `get_emission_factor` (no separate `EfService.getPinnedFor` needed — the
 * pinned EF is already joined onto the activity row).
 */
export interface ToolDeps {
  activityDataService: Pick<ActivityDataService, 'list' | 'sumCo2e' | 'getByIdWithEf'>;
  emissionSourceService: Pick<EmissionSourceService, 'list'>;
  questionnaireService: Pick<QuestionnaireService, 'getContext'>;
  organizationId: string;
}

/**
 * Hard ceiling on `list_activities.limit` to keep a confused agent from
 * dumping the entire inventory into its own context. The default cap (50)
 * lives at the parameter-schema level; this is the absolute max the agent
 * can ask for via the `limit` argument.
 */
const LIST_ACTIVITIES_MAX = 200;

/** Default `limit` when the agent doesn't specify one. */
const LIST_ACTIVITIES_DEFAULT = 50;

/**
 * Zod → JSON Schema for tool parameters. Zod 4's `z.toJSONSchema` produces
 * Draft 2020-12 schemas that pi-agent-core's parameter validator accepts.
 */
const listActivitiesParams = z.object({
  year: z.number().int().optional(),
  scope: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  emission_source_id: z.string().optional(),
  limit: z.number().int().min(1).max(LIST_ACTIVITIES_MAX).optional(),
});

const sumCo2eParams = z.object({
  year: z.number().int().optional(),
  scope: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
  emission_source_id: z.string().optional(),
});

const listEmissionSourcesParams = z.object({
  scope: z.union([z.literal(1), z.literal(2), z.literal(3)]).optional(),
});

const getEmissionFactorParams = z.object({
  activity_id: z.string().min(1),
});

const readQuestionnaireContextParams = z.object({
  questionnaire_id: z.string().min(1),
});

/**
 * Build the 5 read-only inventory tools the answer-generation agent has
 * access to. `submit_response` is NOT included here — `AiAgent.run()`
 * injects it internally (it's the schema-validated terminal step).
 */
export function buildAnswerTools(deps: ToolDeps): AgentTool[] {
  return [
    {
      name: 'list_activities',
      description:
        'List activity rows filtered by reporting year, scope (1|2|3), or emission_source_id. ' +
        'Returns id, source_name, scope, period_id, occurred_at_*, amount, unit, co2e_kg. ' +
        `Defaults to ${LIST_ACTIVITIES_DEFAULT} rows; use \`limit\` to widen up to ${LIST_ACTIVITIES_MAX}. ` +
        'Prefer filters over dumping all activities.',
      parameters: z.toJSONSchema(listActivitiesParams),
      execute: async (rawArgs) => {
        const args = (rawArgs ?? {}) as {
          year?: number;
          scope?: 1 | 2 | 3;
          emission_source_id?: string;
          limit?: number;
        };
        const limit = args.limit ?? LIST_ACTIVITIES_DEFAULT;
        const rows = deps.activityDataService.list({
          organization_id: deps.organizationId,
          limit,
          ...(args.year !== undefined ? { year: args.year } : {}),
          ...(args.scope !== undefined ? { scope: args.scope } : {}),
          ...(args.emission_source_id !== undefined
            ? { emission_source_id: args.emission_source_id }
            : {}),
        });
        return { count: rows.length, activities: rows };
      },
    },
    {
      name: 'sum_co2e',
      description:
        'Aggregate co2e_kg across activities. Filter by year, scope, or emission_source_id. ' +
        'Returns {total_kg, count} where count is the number of activity rows summed.',
      parameters: z.toJSONSchema(sumCo2eParams),
      execute: async (rawArgs) => {
        const args = (rawArgs ?? {}) as {
          year?: number;
          scope?: 1 | 2 | 3;
          emission_source_id?: string;
        };
        return deps.activityDataService.sumCo2e({
          organization_id: deps.organizationId,
          ...(args.year !== undefined ? { year: args.year } : {}),
          ...(args.scope !== undefined ? { scope: args.scope } : {}),
          ...(args.emission_source_id !== undefined
            ? { emission_source_id: args.emission_source_id }
            : {}),
        });
      },
    },
    {
      name: 'list_emission_sources',
      description:
        'List emission sources for the organization, optionally filtered by scope. ' +
        'Returns id, name, scope, category, site_id, is_active.',
      parameters: z.toJSONSchema(listEmissionSourcesParams),
      execute: async (rawArgs) => {
        const args = (rawArgs ?? {}) as { scope?: 1 | 2 | 3 };
        const rows = deps.emissionSourceService.list({
          organization_id: deps.organizationId,
          ...(args.scope !== undefined ? { scope: args.scope } : {}),
        });
        return {
          count: rows.length,
          emission_sources: rows.map((s) => ({
            id: s.id,
            name: s.name,
            scope: s.scope,
            category: s.category,
            site_id: s.site_id,
            is_active: s.is_active,
          })),
        };
      },
    },
    {
      name: 'get_emission_factor',
      description:
        'Look up the emission factor pinned to a specific activity. Returns the EF composite key ' +
        '(factor_code, year, source, geography, dataset_version), Chinese + English names, and ' +
        'the per-unit CO2e. Use this to cite which EF you relied on in source_summary.',
      parameters: z.toJSONSchema(getEmissionFactorParams),
      execute: async (rawArgs) => {
        const args = rawArgs as { activity_id: string };
        const row = deps.activityDataService.getByIdWithEf(args.activity_id);
        if (!row) {
          return { error: 'activity_not_found', activity_id: args.activity_id };
        }
        const ef = row.pinned_ef;
        return {
          activity_id: row.id,
          factor_code: ef.factor_code,
          year: ef.year,
          source: ef.source,
          geography: ef.geography,
          dataset_version: ef.dataset_version,
          name_zh: ef.name_zh,
          name_en: ef.name_en,
          co2e_kg_per_unit: ef.co2e_kg_per_unit,
          input_unit: ef.input_unit,
        };
      },
    },
    {
      name: 'read_questionnaire_context',
      description:
        "Read the questionnaire's customer name, reporting year, and total question count. " +
        'Use to ground the answer in the right organizational scope when the question text ' +
        "doesn't say.",
      parameters: z.toJSONSchema(readQuestionnaireContextParams),
      execute: async (rawArgs) => {
        const args = rawArgs as { questionnaire_id: string };
        const ctx = deps.questionnaireService.getContext(args.questionnaire_id);
        if (!ctx) {
          return { error: 'questionnaire_not_found', questionnaire_id: args.questionnaire_id };
        }
        return ctx;
      },
    },
  ];
}
