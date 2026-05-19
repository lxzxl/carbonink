#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { openAppDb } from './db.js';
import * as q from './queries.js';

const server = new Server(
  { name: 'carbonbook', version: '0.1.0' },
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

const transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
})();
