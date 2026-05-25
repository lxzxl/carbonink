import { toast } from '@renderer/components/toast';
import { undoApi } from '@renderer/lib/api/undo';
import { friendlyErrorDescription } from '@renderer/lib/error-message';
import { subscribe } from '@renderer/lib/ipc';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect } from 'react';

/**
 * Undo/Redo hook (spec `docs/specs/2026-05-25-undo-redo-design.md`).
 *
 * Subscribes to `menu:undo` / `menu:redo` push events fired by the
 * Electron Edit menu's ⌘Z / ⇧⌘Z accelerators, and exposes
 * imperative `undo()` / `redo()` actions plus reactive `canUndo` /
 * `canRedo` derived from `undo:peek`.
 *
 * Query-cache invalidation: per spec, a successful undo coarse-
 * invalidates everything. The undo stack reaches into Activity /
 * Source / Extraction rows that are cached under various keys; doing
 * a per-key map would be precise but ~5x the code for a feature
 * that's rare by design. The local re-fetch is sub-100ms.
 *
 * Mount once at the app root — the menu subscription is a side effect
 * that should fire across the whole window, not per-route.
 */
export function useUndo() {
  const queryClient = useQueryClient();
  const peekQuery = useQuery({
    queryKey: ['undo:peek'],
    queryFn: undoApi.peek,
    // Re-poll often enough that menu enabled-state stays accurate
    // without burning RPC. 1s matches the LicenseBanner cadence.
    refetchInterval: 1000,
  });

  const doMutation = useMutation({
    mutationFn: undoApi.do,
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
    onError: (err) => {
      toast.error(m.undo_failed(), { description: friendlyErrorDescription(err) });
    },
  });

  // TanStack `mutate` is stable across renders (the function is
  // memoized internally), so depending on it doesn't cause a re-
  // subscribe storm — but biome's exhaustive-deps lint still wants
  // the dep listed explicitly. Listing it satisfies the rule without
  // changing observable behaviour.
  useEffect(() => {
    const offUndo = subscribe('menu:undo', () => doMutation.mutate({ direction: 'undo' }));
    const offRedo = subscribe('menu:redo', () => doMutation.mutate({ direction: 'redo' }));
    return () => {
      offUndo();
      offRedo();
    };
  }, [doMutation.mutate]);

  return {
    canUndo: !!peekQuery.data?.undo_kind,
    canRedo: !!peekQuery.data?.redo_kind,
    undo: () => doMutation.mutate({ direction: 'undo' }),
    redo: () => doMutation.mutate({ direction: 'redo' }),
  };
}
