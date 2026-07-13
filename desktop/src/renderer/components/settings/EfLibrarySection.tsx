import { EfLibraryImportDrawer } from '@renderer/components/EfLibraryImportDrawer';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { userEfLibraryApi } from '@renderer/lib/api/user-ef-library';
import { friendlyErrorDescription } from '@renderer/lib/error-message';
import * as m from '@renderer/paraglide/messages';
import type { UserEfLibrary } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileUp, Library, Trash2 } from 'lucide-react';
import { useState } from 'react';

/**
 * Settings → EF libraries (ROADMAP §8.1-④). Import entry point + the
 * registry of imported libraries. Factors themselves surface everywhere
 * the built-in catalog does (EF picker, matcher, lineage) — this section
 * only manages the libraries.
 */
export function EfLibrarySection() {
  const queryClient = useQueryClient();
  const [importOpen, setImportOpen] = useState(false);

  const libraries = useQuery({
    queryKey: ['ef-library:list'],
    queryFn: userEfLibraryApi.list,
  });

  const templateMutation = useMutation({
    mutationFn: userEfLibraryApi.saveTemplate,
    onSuccess: (result) => {
      if ('canceled' in result) return;
      if (result.ok) {
        toast.success(m.ef_library_template_saved(), { description: result.path });
      } else {
        toast.error(m.ef_library_template_failed(), { description: result.error });
      }
    },
    onError: (err) => {
      toast.error(m.ef_library_template_failed(), {
        description: friendlyErrorDescription(err),
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: userEfLibraryApi.delete,
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(m.ef_library_delete_success({ count: String(result.deleted_factor_count) }));
        void queryClient.invalidateQueries({ queryKey: ['ef-library:list'] });
        void queryClient.invalidateQueries({ queryKey: ['ef:list'] });
      }
    },
    onError: (err) => {
      toast.error(m.ef_library_delete_failed(), { description: friendlyErrorDescription(err) });
    },
  });

  const requestDelete = (library: UserEfLibrary) => {
    if (window.confirm(m.ef_library_delete_confirm({ name: library.name }))) {
      deleteMutation.mutate({ id: library.id });
    }
  };

  return (
    <div className="space-y-6">
      <section className="space-y-3 rounded-lg border border-border bg-card/30 p-4">
        <div className="space-y-1.5">
          <h3 className="flex items-center gap-2 text-sm font-semibold">
            <Library className="h-4 w-4" />
            {m.ef_library_group_heading()}
          </h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {m.ef_library_group_body()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            className="gap-2"
            onClick={() => setImportOpen(true)}
          >
            <FileUp className="h-4 w-4" />
            {m.ef_library_import_button()}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="gap-2"
            disabled={templateMutation.isPending}
            onClick={() => templateMutation.mutate()}
          >
            <Download className="h-4 w-4" />
            {m.ef_library_template_button()}
          </Button>
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-sm font-semibold">{m.ef_library_list_heading()}</h3>
        {libraries.data && libraries.data.length > 0 ? (
          <ul className="divide-y divide-border rounded-md border border-border bg-card">
            {libraries.data.map((library) => (
              <li key={library.id} className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium" title={library.name}>
                      {library.name}
                    </span>
                    <span className="shrink-0 font-mono text-xs text-muted-foreground">
                      {library.source}
                    </span>
                  </div>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {m.ef_library_row_meta({
                      version: library.version,
                      count: String(library.factor_count),
                      date: library.imported_at.slice(0, 10),
                    })}
                    {library.source_filename !== null && ` · ${library.source_filename}`}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive"
                  title={m.ef_library_delete_button()}
                  aria-label={m.ef_library_delete_button()}
                  disabled={deleteMutation.isPending}
                  onClick={() => requestDelete(library)}
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="rounded-md border border-border bg-card/30 px-4 py-6 text-center text-xs text-muted-foreground">
            {m.ef_library_empty()}
          </p>
        )}
      </section>

      <EfLibraryImportDrawer open={importOpen} onClose={() => setImportOpen(false)} />
    </div>
  );
}
