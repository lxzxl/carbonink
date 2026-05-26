import { PiNotSupportedError } from '@main/services/mcp-integration-service.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const clientIdSchema = z.enum(['claudeDesktop', 'claudeCode', 'cursor', 'pi']);
const configureInput = z.object({ clientId: clientIdSchema });
const removeInput = z.object({ clientId: clientIdSchema });

export function mcpHandlers(ctx: IpcContext): { [K in keyof IpcTypeMap]?: IpcTypeMap[K] } {
  return {
    'mcp:detect': () => ctx.mcpIntegrationService.detectClients(),

    'mcp:configure': async (input) => {
      const { clientId } = configureInput.parse(input);
      try {
        const result = await ctx.mcpIntegrationService.configureClient(clientId);
        return { ok: true, result };
      } catch (e) {
        if (e instanceof PiNotSupportedError) return { ok: false, error: 'pi_not_supported' };
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('invalid JSON')) return { ok: false, error: 'invalid_json', message: msg };
        return { ok: false, error: 'io_error', message: msg };
      }
    },

    'mcp:remove': async (input) => {
      const { clientId } = removeInput.parse(input);
      try {
        const result = await ctx.mcpIntegrationService.removeClient(clientId);
        return { ok: true, result };
      } catch (e) {
        if (e instanceof PiNotSupportedError) return { ok: false, error: 'pi_not_supported' };
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes('invalid JSON')) return { ok: false, error: 'invalid_json', message: msg };
        return { ok: false, error: 'io_error', message: msg };
      }
    },

    'mcp:get-server-entry': () => ctx.mcpIntegrationService.getServerEntry(),
  };
}
