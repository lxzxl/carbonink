import { runMigrations } from '@main/db/migrate';
import { EfMatcherService } from '@main/services/ef-matcher-service';
import type { EmissionFactor, Extraction } from '@shared/types';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

function makeDb() {
  const db = new Database(':memory:');
  runMigrations(db);
  return db;
}

const CANDIDATE_DIESEL: EmissionFactor = {
  factor_code: 'fuel.diesel.combustion',
  year: 2024,
  source: 'IPCC_AR6',
  geography: 'GLOBAL',
  dataset_version: '2024.q1',
  scope: 1,
  category: 'fuel.combustion',
  ghg_protocol_path: 'scope1.stationary',
  input_unit: 'L',
  co2e_kg_per_unit: 2.68,
  ch4_kg_per_unit: null,
  n2o_kg_per_unit: null,
  hfc_kg_per_unit: null,
  pfc_kg_per_unit: null,
  sf6_kg_per_unit: null,
  nf3_kg_per_unit: null,
  gwp_basis: 'AR6',
  name_zh: '柴油',
  name_en: 'Diesel',
  description_zh: null,
  description_en: null,
  notes: null,
  biogenic_co2_factor: null,
  citation_url: 'https://example.com',
};

const CANDIDATE_GASOLINE: EmissionFactor = {
  ...CANDIDATE_DIESEL,
  factor_code: 'fuel.gasoline.combustion',
  co2e_kg_per_unit: 2.31,
  name_zh: '汽油',
  name_en: 'Gasoline',
};

const FAKE_CONFIG = {
  provider: 'openai',
  model: 'gpt-4o-mini',
  apiKeyKeyref: 'fake-keyref',
} as never;

type LlmResult = {
  recommendations: Array<{
    factor_code: string;
    year: number;
    source: string;
    geography: string;
    dataset_version: string;
    reasoning_zh: string;
  }>;
};

function makeService(opts: {
  extraction: Extraction | null;
  source: { scope: number; category: string | null } | null;
  candidates: EmissionFactor[];
  llmResult?: LlmResult;
  llmError?: Error;
}) {
  const recommendMock = opts.llmError
    ? vi.fn().mockRejectedValue(opts.llmError)
    : vi.fn().mockResolvedValue(opts.llmResult ?? { recommendations: [] });

  const svc = new EfMatcherService({
    db: makeDb(),
    efService: { list: vi.fn().mockReturnValue(opts.candidates) } as never,
    extractionService: { get: vi.fn().mockReturnValue(opts.extraction) } as never,
    emissionSourceService: { get: vi.fn().mockReturnValue(opts.source) } as never,
    llmClient: { recommendEfs: recommendMock } as never,
    config: FAKE_CONFIG,
  });
  return { svc, recommend: recommendMock };
}

describe('EfMatcherService.recommend', () => {
  it('returns empty result when candidate list is empty', async () => {
    const { svc, recommend } = makeService({
      extraction: {
        id: 'e1',
        document_id: 'doc1',
        llm_provider: 'openai',
        llm_model: 'gpt-4o-mini',
        prompt_version: 'china_utility.v1',
        raw_response: null,
        parsed_json: '{}',
        error_json: null,
        status: 'parsed',
        reviewed_by_user_at: null,
        cost_usd: null,
        created_at: '2024-01-01T00:00:00Z',
      },
      source: { scope: 2, category: 'electricity.grid' },
      candidates: [],
    });
    const r = await svc.recommend({ extraction_id: 'e1', emission_source_id: 's1' });
    expect(r).toEqual({ recommended: [], ranked_full: [] });
    expect(recommend).not.toHaveBeenCalled();
  });

  it('returns ranked_full sorted by FTS5 even when LLM fails', async () => {
    const { svc } = makeService({
      extraction: {
        id: 'e2',
        document_id: 'doc2',
        llm_provider: 'openai',
        llm_model: 'gpt-4o-mini',
        prompt_version: 'fuel_receipt.v1',
        raw_response: null,
        parsed_json: '{"fuel_type":"柴油"}',
        error_json: null,
        status: 'parsed',
        reviewed_by_user_at: null,
        cost_usd: null,
        created_at: '2024-01-01T00:00:00Z',
      },
      source: { scope: 1, category: 'fuel.combustion' },
      candidates: [CANDIDATE_GASOLINE, CANDIDATE_DIESEL],
      llmError: new Error('LLM down'),
    });
    const r = await svc.recommend({ extraction_id: 'e2', emission_source_id: 's2' });
    expect(r.recommended).toEqual([]);
    expect(r.ranked_full.length).toBeGreaterThan(0);
  });

  it('drops LLM-hallucinated PKs that do not match any candidate', async () => {
    const { svc } = makeService({
      extraction: {
        id: 'e3',
        document_id: 'doc3',
        llm_provider: 'openai',
        llm_model: 'gpt-4o-mini',
        prompt_version: 'china_utility.v1',
        raw_response: null,
        parsed_json: '{}',
        error_json: null,
        status: 'parsed',
        reviewed_by_user_at: null,
        cost_usd: null,
        created_at: '2024-01-01T00:00:00Z',
      },
      source: { scope: 1, category: 'fuel.combustion' },
      candidates: [CANDIDATE_DIESEL],
      llmResult: {
        recommendations: [
          {
            factor_code: 'HALLUCINATED',
            year: 2024,
            source: 'X',
            geography: 'X',
            dataset_version: 'x',
            reasoning_zh: '幻觉',
          },
          {
            factor_code: CANDIDATE_DIESEL.factor_code,
            year: CANDIDATE_DIESEL.year,
            source: CANDIDATE_DIESEL.source,
            geography: CANDIDATE_DIESEL.geography,
            dataset_version: CANDIDATE_DIESEL.dataset_version,
            reasoning_zh: '匹配',
          },
          {
            factor_code: 'ALSO_HALLUCINATED',
            year: 2024,
            source: 'X',
            geography: 'X',
            dataset_version: 'x',
            reasoning_zh: '幻觉2',
          },
        ],
      },
    });
    const r = await svc.recommend({ extraction_id: 'e3', emission_source_id: 's3' });
    expect(r.recommended).toHaveLength(1);
    const first = r.recommended[0];
    expect(first?.ef.factor_code).toBe('fuel.diesel.combustion');
  });

  it('caches by (extraction_id, source_id)', async () => {
    const { svc, recommend } = makeService({
      extraction: {
        id: 'e4',
        document_id: 'doc4',
        llm_provider: 'openai',
        llm_model: 'gpt-4o-mini',
        prompt_version: 'china_utility.v1',
        raw_response: null,
        parsed_json: '{}',
        error_json: null,
        status: 'parsed',
        reviewed_by_user_at: null,
        cost_usd: null,
        created_at: '2024-01-01T00:00:00Z',
      },
      source: { scope: 1, category: 'fuel.combustion' },
      candidates: [CANDIDATE_DIESEL],
    });
    await svc.recommend({ extraction_id: 'e4', emission_source_id: 's4' });
    await svc.recommend({ extraction_id: 'e4', emission_source_id: 's4' });
    expect(recommend).toHaveBeenCalledTimes(1);
  });
});
