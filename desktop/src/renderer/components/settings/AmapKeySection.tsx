import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { settingsApi } from '@renderer/lib/api/settings';
import { friendlyErrorDescription } from '@renderer/lib/error-message';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

/**
 * AMap routing API key section. Drives the "look up distance" feature
 * on freight + travel activity rows. Free dev key (100k requests/day);
 * stored in sqlite (not OS keychain) because it's a low-risk public
 * dev credential — same threat model as a Google Maps API key
 * embedded in a JS bundle.
 */
export function AmapKeySection() {
  const queryClient = useQueryClient();
  const [amapKey, setAmapKey] = useState('');

  const amapKeyQuery = useQuery({
    queryKey: ['settings:get-amap-key'],
    queryFn: settingsApi.getAmapKey,
  });

  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to fresh query data, not every render.
  useEffect(() => {
    if (amapKeyQuery.data != null) {
      setAmapKey(amapKeyQuery.data);
    }
  }, [amapKeyQuery.data]);

  const saveMutation = useMutation({
    mutationFn: (value: string) => settingsApi.setAmapKey({ value }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['settings:get-amap-key'] });
      toast.success(m.settings_save_success());
    },
    onError: (err) => {
      toast.error(m.settings_save_failed(), { description: friendlyErrorDescription(err) });
    },
  });

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="settings-amap-key">AMap routing key</Label>
        <div className="flex gap-2">
          <Input
            id="settings-amap-key"
            value={amapKey}
            onChange={(e) => setAmapKey(e.target.value)}
            placeholder="amap key (optional)"
          />
          <Button
            type="button"
            variant="outline"
            aria-label="Save AMap key"
            onClick={() => saveMutation.mutate(amapKey)}
            disabled={saveMutation.isPending}
          >
            {saveMutation.isPending ? m.settings_saving() : m.settings_save()}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Get a free key at https://lbs.amap.com/dev/ (100,000 requests/day) · Used for "Look up
          distance" on freight + travel rows.
        </p>
      </div>
    </div>
  );
}
