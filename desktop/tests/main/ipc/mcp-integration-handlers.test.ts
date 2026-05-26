import { runMigrations } from '@main/db/migrate';
import type { IpcContext } from '@main/ipc/context';
import { mcpHandlers } from '@main/ipc/handlers/mcp';
import { McpIntegrationService } from '@main/services/mcp-integration-service';
import Database from 'better-sqlite3';
import { describe, expect, it, vi } from 'vitest';

function makeCtx() {
  const db = new Database(':memory:');
  runMigrations(db);
  const mcpIntegrationService = new McpIntegrationService({
    db,
    paths: {
      electronBinaryPath: () => '/fake/bin',
      mcpScriptPath: () => '/fake/script.js',
      mcpScriptExists: () => true,
    },
    now: () => new Date('2026-05-26T12:00:00Z'),
  });
  const ctx = { db, mcpIntegrationService } as unknown as IpcContext;
  return { ctx, mcpIntegrationService };
}

describe('mcpHandlers', () => {
  it('mcp:detect delegates to service.detectClients', async () => {
    const { ctx, mcpIntegrationService } = makeCtx();
    const spy = vi.spyOn(mcpIntegrationService, 'detectClients').mockResolvedValue({
      claudeDesktop: { installed: false },
      claudeCode: { installed: false },
      cursor: { installed: false },
      pi: { installed: false },
    });
    const handlers = mcpHandlers(ctx);
    const result = await handlers['mcp:detect']!();
    expect(spy).toHaveBeenCalledOnce();
    expect(result.claudeDesktop).toEqual({ installed: false });
  });

  it('mcp:configure rejects invalid clientId via zod', async () => {
    const { ctx } = makeCtx();
    const handlers = mcpHandlers(ctx);
    await expect(
      handlers['mcp:configure']!({ clientId: 'not-a-client' } as never),
    ).rejects.toThrow();
  });

  it('mcp:configure with pi returns a friendly error (not raw exception)', async () => {
    const { ctx } = makeCtx();
    const handlers = mcpHandlers(ctx);
    const r = await handlers['mcp:configure']!({ clientId: 'pi' });
    expect(r).toEqual({ ok: false, error: 'pi_not_supported' });
  });

  it('mcp:get-server-entry returns the current entry', async () => {
    const { ctx } = makeCtx();
    const handlers = mcpHandlers(ctx);
    const r = await handlers['mcp:get-server-entry']!();
    expect(r).toEqual({
      command: '/fake/bin',
      args: ['/fake/script.js'],
      env: { ELECTRON_RUN_AS_NODE: '1' },
    });
  });
});
