import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { workspaceApi } from '@renderer/lib/api/workspace';
import * as m from '@renderer/paraglide/messages';
import type { Workspace } from '@shared/types';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRightLeft, FolderPlus, Pencil } from 'lucide-react';
import { useState } from 'react';

/**
 * Settings → 账套 (spec 2026-07-22-client-workspaces). Each workspace is a
 * standalone SQLite file; switching reloads the whole app over the new
 * file. The section is registry CRUD only — all data isolation comes from
 * the files themselves.
 */
export function WorkspaceSection() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');

  const listQuery = useQuery({ queryKey: ['workspace:list'], queryFn: workspaceApi.list });
  const activeQuery = useQuery({
    queryKey: ['workspace:get-active'],
    queryFn: workspaceApi.getActive,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['workspace:list'] });
    void queryClient.invalidateQueries({ queryKey: ['workspace:get-active'] });
  };

  const create = async () => {
    const result = await workspaceApi.create({ name: newName });
    if (!result.ok) {
      toast.error(m.workspace_invalid_name());
      return;
    }
    setNewName('');
    toast.success(m.workspace_created_toast());
    refresh();
  };

  const saveRename = async (id: string) => {
    const result = await workspaceApi.rename({ id, name: renameValue });
    if (!result.ok) {
      toast.error(m.workspace_invalid_name());
      return;
    }
    setRenamingId(null);
    refresh();
  };

  const switchTo = async (workspace: Workspace) => {
    // window.confirm keeps determinism with the rest of the app's
    // destructive-ish confirmations (see EfLibrarySection delete).
    if (!window.confirm(m.workspace_switch_confirm({ name: workspace.name }))) return;
    const result = await workspaceApi.switch({ id: workspace.id });
    if (!result.ok) toast.error(m.workspace_switch_failed());
    // On ok the main process reloads this window — nothing further to do.
  };

  const workspaces = listQuery.data ?? [];
  const activeId = activeQuery.data?.id;

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-base font-semibold">{m.workspace_heading()}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{m.workspace_body()}</p>
      </div>

      <div className="divide-y divide-border rounded-md border border-border">
        {workspaces.map((workspace) => (
          <div key={workspace.id} className="flex items-center gap-3 px-3 py-2.5">
            <div className="min-w-0 flex-1">
              {renamingId === workspace.id ? (
                <div className="flex items-center gap-2">
                  <Input
                    value={renameValue}
                    maxLength={60}
                    autoFocus
                    onChange={(e) => setRenameValue(e.target.value)}
                    className="h-8 text-sm"
                  />
                  <Button type="button" size="sm" onClick={() => void saveRename(workspace.id)}>
                    {m.workspace_rename_save()}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRenamingId(null)}
                  >
                    {m.workspace_rename_cancel()}
                  </Button>
                </div>
              ) : (
                <>
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <span className="truncate">{workspace.name}</span>
                    {workspace.id === activeId && (
                      <span className="shrink-0 rounded-sm border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[11px] text-primary">
                        {m.workspace_active_badge()}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {m.workspace_created_at({ date: workspace.created_at.slice(0, 10) })}
                  </p>
                </>
              )}
            </div>
            {renamingId !== workspace.id && (
              <div className="flex shrink-0 items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="gap-1"
                  onClick={() => {
                    setRenamingId(workspace.id);
                    setRenameValue(workspace.name);
                  }}
                >
                  <Pencil className="size-3.5" aria-hidden="true" />
                  {m.workspace_rename_button()}
                </Button>
                {workspace.id !== activeId && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="gap-1"
                    onClick={() => void switchTo(workspace)}
                  >
                    <ArrowRightLeft className="size-3.5" aria-hidden="true" />
                    {m.workspace_switch_button()}
                  </Button>
                )}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center gap-2">
        <Input
          value={newName}
          maxLength={60}
          placeholder={m.workspace_create_placeholder()}
          onChange={(e) => setNewName(e.target.value)}
          className="h-9 max-w-72 text-sm"
        />
        <Button
          type="button"
          variant="outline"
          className="gap-1.5"
          disabled={newName.trim() === ''}
          onClick={() => void create()}
        >
          <FolderPlus className="size-4" aria-hidden="true" />
          {m.workspace_create_button()}
        </Button>
      </div>
    </section>
  );
}
