#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';

const server = new Server(
  { name: 'carbonbook', version: '0.1.0' },
  { capabilities: { tools: {}, resources: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  throw new Error(`Unknown tool: ${request.params.name}`);
});

const transport = new StdioServerTransport();
(async () => {
  await server.connect(transport);
})();
