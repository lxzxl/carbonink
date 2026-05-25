import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Label } from '@renderer/components/ui/label';
import { mcpApi } from '@renderer/lib/api/mcp';
import { friendlyErrorDescription } from '@renderer/lib/error-message';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQuery } from '@tanstack/react-query';

/**
 * MCP Server section (Phase 2 Block 4) — Claude Desktop integration.
 *
 * Status query polls every 10 s so the UI reflects an external
 * `pnpm build` without the user having to manually refresh. The
 * "write Claude config" action drops carbonink into the user's
 * Claude Desktop `mcp_servers` config.
 */
export function McpSection() {
  const mcpStatusQuery = useQuery({
    queryKey: ['mcp:status'],
    queryFn: mcpApi.getStatus,
    refetchInterval: 10_000,
  });

  const writeClaudeConfig = useMutation({
    mutationFn: mcpApi.writeClaudeConfig,
    onSuccess: (r) => {
      if (r.ok) {
        toast.success(m.settings_mcp_write_done());
        mcpStatusQuery.refetch();
      } else {
        toast.error(m.settings_mcp_write_failed(), { description: r.error });
      }
    },
    onError: (err) => {
      toast.error(m.settings_mcp_write_failed(), { description: friendlyErrorDescription(err) });
    },
  });

  const mcpStatus = mcpStatusQuery.data;
  const mcpStatusLabel = !mcpStatus?.binary_built
    ? m.settings_mcp_status_not_built()
    : mcpStatus.claude_config_references_us
      ? m.settings_mcp_status_available()
      : m.settings_mcp_status_pending();

  return (
    <div className="space-y-4">
      <p className="text-sm">{mcpStatusLabel}</p>
      {mcpStatus?.binary_path && (
        <>
          <div className="space-y-1">
            <Label>{m.settings_mcp_binary_label()}</Label>
            <div className="flex items-center gap-2">
              <code className="text-xs truncate flex-1 font-mono">{mcpStatus.binary_path}</code>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => {
                  navigator.clipboard.writeText(mcpStatus.binary_path!);
                  toast.success(m.settings_mcp_copy_done());
                }}
              >
                复制
              </Button>
            </div>
          </div>
          <div className="space-y-1">
            <Label>{m.settings_mcp_config_label()}</Label>
            <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
              {JSON.stringify(
                {
                  mcpServers: {
                    carbonink: { command: 'node', args: [mcpStatus.binary_path] },
                  },
                },
                null,
                2,
              )}
            </pre>
          </div>
          <Button
            type="button"
            onClick={() => writeClaudeConfig.mutate()}
            disabled={writeClaudeConfig.isPending || mcpStatus.claude_config_references_us}
          >
            {m.settings_mcp_write_button()}
          </Button>
        </>
      )}
    </div>
  );
}
