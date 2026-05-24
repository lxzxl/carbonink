#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { openAppDb } from './db.js';
import * as q from './queries.js';

const server = new Server(
  { name: 'carbonink', version: '0.1.0' },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'list_questionnaires',
      description: '列出所有问卷（customer / reporting_year / status / question_count）',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false,
      },
    },
    {
      name: 'get_questionnaire',
      description: '查询单份问卷的完整详情（含 customer / document / questions[]）',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'questionnaire id' },
        },
        required: ['id'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_questions',
      description: '列出某问卷下的所有问题',
      inputSchema: {
        type: 'object',
        properties: {
          questionnaire_id: { type: 'string', description: 'questionnaire id' },
        },
        required: ['questionnaire_id'],
        additionalProperties: false,
      },
    },
    {
      name: 'get_answer',
      description: '获取某道问题的答案（若未填写则返回 null）',
      inputSchema: {
        type: 'object',
        properties: {
          question_id: { type: 'string', description: 'question id' },
        },
        required: ['question_id'],
        additionalProperties: false,
      },
    },
    {
      name: 'list_activities',
      description: '列出活动数据（可按 reporting_period_id 或 year 过滤）',
      inputSchema: {
        type: 'object',
        properties: {
          reporting_period_id: { type: 'string', description: 'reporting period id (optional)' },
          year: { type: 'number', description: 'reporting year, e.g. 2024 (optional)' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'list_emission_sources',
      description: '列出排放源（可按 organization_id 过滤）',
      inputSchema: {
        type: 'object',
        properties: {
          organization_id: { type: 'string', description: 'organization id (optional)' },
        },
        additionalProperties: false,
      },
    },
    {
      name: 'set_answer',
      description: '新增或更新某道问题的答案（source_kind 固定为 manual）',
      inputSchema: {
        type: 'object',
        properties: {
          question_id: { type: 'string', description: 'question id' },
          value: { type: 'string', description: '答案文本' },
          unit: { type: 'string', description: '单位（可选）', nullable: true },
          finalize: { type: 'boolean', description: '是否标记为已完成（设置 finalized_at）' },
        },
        required: ['question_id', 'value'],
        additionalProperties: false,
      },
    },
    {
      name: 'create_activity',
      description:
        '新增一条活动数据，通过已钉选的排放因子自动计算 co2e。若 EF 未钉选请先在 GUI 中使用一次。',
      inputSchema: {
        type: 'object',
        properties: {
          site_id: { type: 'string' },
          emission_source_id: { type: 'string' },
          reporting_period_id: { type: 'string' },
          occurred_at_start: { type: 'string', description: 'ISO date string, e.g. 2024-01-01' },
          occurred_at_end: { type: 'string', description: 'ISO date string, e.g. 2024-12-31' },
          amount: { type: 'number' },
          unit: { type: 'string' },
          ef_factor_code: { type: 'string' },
          ef_year: { type: 'number' },
          ef_source: { type: 'string' },
          ef_geography: { type: 'string' },
          ef_dataset_version: { type: 'string' },
          notes: { type: 'string', nullable: true },
        },
        required: [
          'site_id',
          'emission_source_id',
          'reporting_period_id',
          'occurred_at_start',
          'occurred_at_end',
          'amount',
          'unit',
          'ef_factor_code',
          'ef_year',
          'ef_source',
          'ef_geography',
          'ef_dataset_version',
        ],
        additionalProperties: false,
      },
    },
    {
      name: 'create_emission_source',
      description: '新增一个排放源',
      inputSchema: {
        type: 'object',
        properties: {
          site_id: { type: 'string' },
          name: { type: 'string' },
          scope: { type: 'number', enum: [1, 2, 3] },
          category: { type: 'string', nullable: true },
          ghg_protocol_path: { type: 'string', nullable: true },
        },
        required: ['site_id', 'name', 'scope'],
        additionalProperties: false,
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const rawDb = openAppDb();
  const db = rawDb as unknown as q.DbLike;
  try {
    const args = (request.params.arguments ?? {}) as Record<string, unknown>;
    switch (request.params.name) {
      case 'list_questionnaires':
        return ok(q.listQuestionnaires(db));

      case 'get_questionnaire':
        return ok(q.getQuestionnaire(db, String(args['id'])));

      case 'list_questions':
        return ok(q.listQuestions(db, String(args['questionnaire_id'])));

      case 'get_answer':
        return ok(q.getAnswer(db, String(args['question_id'])));

      case 'list_activities': {
        const opts: q.ListActivitiesOpts = {};
        if (args['reporting_period_id'] !== undefined)
          opts.reporting_period_id = String(args['reporting_period_id']);
        if (args['year'] !== undefined) opts.year = Number(args['year']);
        return ok(q.listActivities(db, opts));
      }

      case 'list_emission_sources': {
        const opts: q.ListEmissionSourcesOpts = {};
        if (args['organization_id'] !== undefined)
          opts.organization_id = String(args['organization_id']);
        return ok(q.listEmissionSources(db, opts));
      }

      case 'set_answer':
        return ok(q.setAnswer(db, args as never));

      case 'create_activity':
        return ok(q.createActivity(db, args as never));

      case 'create_emission_source':
        return ok(q.createEmissionSource(db, args as never));

      default:
        throw new Error(`Unknown tool: ${request.params.name}`);
    }
  } finally {
    rawDb.close();
  }
});

function ok(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] };
}

// ---------------------------------------------------------------------------
// Resources: inventory://{year} and questionnaire://{id}
// ---------------------------------------------------------------------------

server.setRequestHandler(ListResourcesRequestSchema, async () => {
  const rawDb = openAppDb();
  try {
    const db = rawDb as unknown as q.DbLike;
    const periods = db
      .prepare('SELECT DISTINCT year FROM reporting_period ORDER BY year DESC')
      .all() as Array<{ year: number }>;
    const questionnaires = q.listQuestionnaires(db);

    return {
      resources: [
        ...periods.map((p) => ({
          uri: `inventory://${p.year}`,
          name: `Inventory ${p.year}`,
          description: `Aggregated emissions totals for reporting year ${p.year}`,
          mimeType: 'application/json',
        })),
        ...questionnaires.map((qn) => ({
          uri: `questionnaire://${qn.id}`,
          name: `Questionnaire ${qn.customer_name} ${qn.reporting_year}`,
          description: `Full questionnaire detail for ${qn.customer_name} ${qn.reporting_year}`,
          mimeType: 'application/json',
        })),
      ],
    };
  } finally {
    rawDb.close();
  }
});

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  const uri = request.params.uri ?? '';
  const rawDb = openAppDb();
  try {
    const db = rawDb as unknown as q.DbLike;

    const inventoryMatch = /^inventory:\/\/(\d{4})$/.exec(uri);
    if (inventoryMatch) {
      const year = Number(inventoryMatch[1]);
      const totals = q.inventoryTotals(db, year);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(totals, null, 2),
          },
        ],
      };
    }

    const questionnaireMatch = /^questionnaire:\/\/(.+)$/.exec(uri);
    if (questionnaireMatch) {
      const id = questionnaireMatch[1] ?? '';
      const detail = q.getQuestionnaire(db, id);
      if (!detail) throw new Error(`Questionnaire not found: ${id}`);
      return {
        contents: [
          {
            uri,
            mimeType: 'application/json',
            text: JSON.stringify(detail, null, 2),
          },
        ],
      };
    }

    throw new Error(`Unsupported resource URI: ${uri}`);
  } finally {
    rawDb.close();
  }
});

const transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
})();
