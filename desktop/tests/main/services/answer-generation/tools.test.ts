import { buildAnswerTools, type ToolDeps } from '@main/services/answer-generation/tools';
import type { EmissionSource } from '@shared/types';
import { describe, expect, it, vi } from 'vitest';

/**
 * Minimal mock factory: every service method is a `vi.fn()`; individual tests
 * call `.mockReturnValue(...)` to set the shape they care about. Cheap to
 * build a fresh `ToolDeps` per test, so no `beforeEach` lifecycle needed.
 */
function makeDeps(overrides?: Partial<ToolDeps>): {
  deps: ToolDeps;
  activityDataService: {
    list: ReturnType<typeof vi.fn>;
    sumCo2e: ReturnType<typeof vi.fn>;
    getByIdWithEf: ReturnType<typeof vi.fn>;
  };
  emissionSourceService: { list: ReturnType<typeof vi.fn> };
  questionnaireService: { getContext: ReturnType<typeof vi.fn> };
} {
  const activityDataService = {
    list: vi.fn().mockReturnValue([]),
    sumCo2e: vi.fn().mockReturnValue({ total_kg: 0, count: 0 }),
    getByIdWithEf: vi.fn().mockReturnValue(null),
  };
  const emissionSourceService = {
    list: vi.fn().mockReturnValue([]),
  };
  const questionnaireService = {
    getContext: vi.fn().mockReturnValue(null),
  };
  const deps: ToolDeps = {
    activityDataService: activityDataService as unknown as ToolDeps['activityDataService'],
    emissionSourceService: emissionSourceService as unknown as ToolDeps['emissionSourceService'],
    questionnaireService: questionnaireService as unknown as ToolDeps['questionnaireService'],
    organizationId: 'org-1',
    ...overrides,
  };
  return { deps, activityDataService, emissionSourceService, questionnaireService };
}

function findTool(deps: ToolDeps, name: string) {
  const tool = buildAnswerTools(deps).find((t) => t.name === name);
  if (!tool) throw new Error(`tool not found: ${name}`);
  return tool;
}

describe('buildAnswerTools — surface', () => {
  it('exposes exactly the 5 read-only inventory tools, no submit_response', () => {
    const { deps } = makeDeps();
    const tools = buildAnswerTools(deps);
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'get_emission_factor',
      'list_activities',
      'list_emission_sources',
      'read_questionnaire_context',
      'sum_co2e',
    ]);
    // submit_response is injected by AiAgent.run() — tools.ts MUST NOT add it
    // (it lives in the agent loop's terminal-step machinery, not the inventory
    // surface). If this assertion fires, the file has been over-extended.
    expect(names).not.toContain('submit_response');
  });

  it('every tool has a non-empty description + parameters JSON Schema', () => {
    const { deps } = makeDeps();
    const tools = buildAnswerTools(deps);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect(tool.parameters).toBeTypeOf('object');
      // z.toJSONSchema returns {$schema, type: 'object', properties, ...}.
      const schema = tool.parameters as { type?: string; properties?: unknown };
      expect(schema.type).toBe('object');
      expect(schema.properties).toBeTypeOf('object');
    }
  });
});

describe('list_activities', () => {
  it('passes organization_id + default limit 50 + filters through to service.list', async () => {
    const { deps, activityDataService } = makeDeps();
    activityDataService.list.mockReturnValue([
      {
        id: 'a-1',
        source_name: 'Boiler',
        scope: 1,
        period_id: 'p-1',
        occurred_at_start: '2024-01-01',
        occurred_at_end: '2024-01-31',
        amount: 100,
        unit: 'kWh',
        co2e_kg: 50,
      },
    ]);

    const tool = findTool(deps, 'list_activities');
    const result = await tool.execute({ year: 2024, scope: 1 });

    expect(activityDataService.list).toHaveBeenCalledWith({
      organization_id: 'org-1',
      limit: 50,
      year: 2024,
      scope: 1,
    });
    expect(result).toEqual({
      count: 1,
      activities: [
        {
          id: 'a-1',
          source_name: 'Boiler',
          scope: 1,
          period_id: 'p-1',
          occurred_at_start: '2024-01-01',
          occurred_at_end: '2024-01-31',
          amount: 100,
          unit: 'kWh',
          co2e_kg: 50,
        },
      ],
    });
  });

  it('respects caller-supplied limit (up to schema cap)', async () => {
    const { deps, activityDataService } = makeDeps();
    activityDataService.list.mockReturnValue([]);
    const tool = findTool(deps, 'list_activities');
    await tool.execute({ limit: 200 });
    expect(activityDataService.list).toHaveBeenCalledWith({
      organization_id: 'org-1',
      limit: 200,
    });
  });

  it('treats missing args as empty filter set + default limit', async () => {
    const { deps, activityDataService } = makeDeps();
    activityDataService.list.mockReturnValue([]);
    const tool = findTool(deps, 'list_activities');
    await tool.execute(undefined);
    expect(activityDataService.list).toHaveBeenCalledWith({
      organization_id: 'org-1',
      limit: 50,
    });
  });
});

describe('sum_co2e', () => {
  it('passes organization_id + filters; returns service result verbatim', async () => {
    const { deps, activityDataService } = makeDeps();
    activityDataService.sumCo2e.mockReturnValue({ total_kg: 1234.5, count: 7 });
    const tool = findTool(deps, 'sum_co2e');

    const result = await tool.execute({ scope: 2 });

    expect(activityDataService.sumCo2e).toHaveBeenCalledWith({
      organization_id: 'org-1',
      scope: 2,
    });
    expect(result).toEqual({ total_kg: 1234.5, count: 7 });
  });
});

describe('list_emission_sources', () => {
  it('passes organization_id + scope; trims service rows to tool shape', async () => {
    const { deps, emissionSourceService } = makeDeps();
    const fullRow: EmissionSource = {
      id: 'es-1',
      site_id: 'site-1',
      name: 'HQ boiler',
      scope: 1,
      category: 'fuel.stationary',
      ghg_protocol_path: null,
      default_ef_query: null,
      template_origin: null,
      is_active: true,
    };
    emissionSourceService.list.mockReturnValue([fullRow]);
    const tool = findTool(deps, 'list_emission_sources');

    const result = await tool.execute({ scope: 1 });

    expect(emissionSourceService.list).toHaveBeenCalledWith({
      organization_id: 'org-1',
      scope: 1,
    });
    expect(result).toEqual({
      count: 1,
      emission_sources: [
        {
          id: 'es-1',
          name: 'HQ boiler',
          scope: 1,
          category: 'fuel.stationary',
          site_id: 'site-1',
          is_active: true,
        },
      ],
    });
  });

  it('omits scope from service call when not supplied', async () => {
    const { deps, emissionSourceService } = makeDeps();
    emissionSourceService.list.mockReturnValue([]);
    const tool = findTool(deps, 'list_emission_sources');
    await tool.execute({});
    expect(emissionSourceService.list).toHaveBeenCalledWith({ organization_id: 'org-1' });
  });
});

describe('get_emission_factor', () => {
  it('extracts a compact EF tuple from getByIdWithEf', async () => {
    const { deps, activityDataService } = makeDeps();
    activityDataService.getByIdWithEf.mockReturnValue({
      id: 'a-1',
      site_id: 'site-1',
      emission_source_id: 'es-1',
      reporting_period_id: 'p-1',
      occurred_at_start: '2024-01-01',
      occurred_at_end: '2024-01-31',
      amount: 100,
      unit: 'kWh',
      ef_factor_code: 'electricity.grid.cn',
      ef_year: 2024,
      ef_source: 'MEE_China',
      ef_geography: 'CN',
      ef_dataset_version: '2024.q4',
      computed_co2e_kg: 57.03,
      computed_at: '2026-05-01T00:00:00Z',
      extraction_id: null,
      notes: null,
      created_at: '2026-05-01T00:00:00Z',
      updated_at: '2026-05-01T00:00:00Z',
      pinned_ef: {
        factor_code: 'electricity.grid.cn',
        year: 2024,
        source: 'MEE_China',
        geography: 'CN',
        dataset_version: '2024.q4',
        scope: 2,
        category: 'electricity.grid',
        ghg_protocol_path: null,
        input_unit: 'kWh',
        co2e_kg_per_unit: 0.5703,
        ch4_kg_per_unit: null,
        n2o_kg_per_unit: null,
        hfc_kg_per_unit: null,
        pfc_kg_per_unit: null,
        sf6_kg_per_unit: null,
        nf3_kg_per_unit: null,
        gwp_basis: 'AR6',
        name_zh: '中国国家电网',
        name_en: 'China grid',
        description_zh: null,
        description_en: null,
        citation_url: null,
        pinned_at: '2026-05-01T00:00:00Z',
        pinned_from: 'app.sqlite',
      },
    });

    const tool = findTool(deps, 'get_emission_factor');
    const result = await tool.execute({ activity_id: 'a-1' });

    expect(activityDataService.getByIdWithEf).toHaveBeenCalledWith('a-1');
    expect(result).toEqual({
      activity_id: 'a-1',
      factor_code: 'electricity.grid.cn',
      year: 2024,
      source: 'MEE_China',
      geography: 'CN',
      dataset_version: '2024.q4',
      name_zh: '中国国家电网',
      name_en: 'China grid',
      co2e_kg_per_unit: 0.5703,
      input_unit: 'kWh',
    });
  });

  it('returns an error stanza (not throw) when the activity is missing', async () => {
    const { deps, activityDataService } = makeDeps();
    activityDataService.getByIdWithEf.mockReturnValue(null);
    const tool = findTool(deps, 'get_emission_factor');
    const result = await tool.execute({ activity_id: 'a-missing' });
    expect(result).toEqual({ error: 'activity_not_found', activity_id: 'a-missing' });
  });
});

describe('read_questionnaire_context', () => {
  it('returns the service context verbatim', async () => {
    const { deps, questionnaireService } = makeDeps();
    questionnaireService.getContext.mockReturnValue({
      customer_name: 'Acme Co',
      reporting_year: 2024,
      question_count: 42,
    });
    const tool = findTool(deps, 'read_questionnaire_context');
    const result = await tool.execute({ questionnaire_id: 'q-1' });

    expect(questionnaireService.getContext).toHaveBeenCalledWith('q-1');
    expect(result).toEqual({
      customer_name: 'Acme Co',
      reporting_year: 2024,
      question_count: 42,
    });
  });

  it('returns an error stanza (not throw) when the questionnaire is missing', async () => {
    const { deps, questionnaireService } = makeDeps();
    questionnaireService.getContext.mockReturnValue(null);
    const tool = findTool(deps, 'read_questionnaire_context');
    const result = await tool.execute({ questionnaire_id: 'q-missing' });
    expect(result).toEqual({ error: 'questionnaire_not_found', questionnaire_id: 'q-missing' });
  });
});

describe('multi-tenant safety — organization_id is always injected', () => {
  it('every tool that touches activity/source data calls the service with deps.organizationId', async () => {
    const { deps, activityDataService, emissionSourceService } = makeDeps({
      organizationId: 'org-distinct',
    });
    activityDataService.list.mockReturnValue([]);
    activityDataService.sumCo2e.mockReturnValue({ total_kg: 0, count: 0 });
    emissionSourceService.list.mockReturnValue([]);

    await findTool(deps, 'list_activities').execute({});
    await findTool(deps, 'sum_co2e').execute({});
    await findTool(deps, 'list_emission_sources').execute({});

    expect(activityDataService.list.mock.calls[0]?.[0]).toMatchObject({
      organization_id: 'org-distinct',
    });
    expect(activityDataService.sumCo2e.mock.calls[0]?.[0]).toMatchObject({
      organization_id: 'org-distinct',
    });
    expect(emissionSourceService.list.mock.calls[0]?.[0]).toMatchObject({
      organization_id: 'org-distinct',
    });
  });
});
