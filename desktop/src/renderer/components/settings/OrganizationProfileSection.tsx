import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { orgApi } from '@renderer/lib/api/organization';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

type BoundaryKind = 'equity_share' | 'financial_control' | 'operational_control';

/**
 * Organization Profile section — ISO 14064-1 metadata (Phase 3).
 * Edits `boundary_kind`, the responsible-person name+role, and the
 * `base_year_period_id`. These feed the ISO 14064-1 inventory report
 * template; the report won't generate until at least responsible name
 * is set.
 */
export function OrganizationProfileSection() {
  const queryClient = useQueryClient();

  const orgQuery = useQuery({
    queryKey: ['org:get-current'],
    queryFn: () => orgApi.getCurrent(),
  });

  const periodsQuery = useQuery({
    queryKey: ['org:list-reporting-periods', orgQuery.data?.id],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: orgQuery.data!.id }),
    enabled: !!orgQuery.data?.id,
  });

  const [boundary, setBoundary] = useState<BoundaryKind>('operational_control');
  const [respName, setRespName] = useState('');
  const [respRole, setRespRole] = useState('');
  const [baseYearId, setBaseYearId] = useState<string | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: only react to fresh org data, not every render.
  useEffect(() => {
    if (orgQuery.data) {
      setBoundary(orgQuery.data.boundary_kind);
      setRespName(orgQuery.data.responsible_person_name ?? '');
      setRespRole(orgQuery.data.responsible_person_role ?? '');
      setBaseYearId(orgQuery.data.base_year_period_id ?? null);
    }
  }, [orgQuery.data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      orgApi.updateReportingProfile({
        id: orgQuery.data!.id,
        boundary_kind: boundary,
        responsible_person_name: respName || null,
        responsible_person_role: respRole || null,
        base_year_period_id: baseYearId,
      }),
    onSuccess: () => {
      toast.success(m.settings_reporting_profile_saved());
      queryClient.invalidateQueries({ queryKey: ['org:get-current'] });
    },
    onError: (err) => {
      const msg = err instanceof Error ? err.message : 'Unknown error';
      toast.error(m.settings_save_failed(), { description: msg });
    },
  });

  if (!orgQuery.data) return null;

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label htmlFor="settings-boundary">{m.settings_boundary_label()}</Label>
        <select
          id="settings-boundary"
          value={boundary}
          onChange={(e) => setBoundary(e.target.value as BoundaryKind)}
          className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
        >
          <option value="equity_share">{m.settings_boundary_equity_share()}</option>
          <option value="financial_control">{m.settings_boundary_financial_control()}</option>
          <option value="operational_control">{m.settings_boundary_operational_control()}</option>
        </select>
      </div>

      <div className="space-y-1">
        <Label htmlFor="settings-resp-name">{m.settings_responsible_name_label()}</Label>
        <Input
          id="settings-resp-name"
          value={respName}
          onChange={(e) => setRespName(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="settings-resp-role">{m.settings_responsible_role_label()}</Label>
        <Input
          id="settings-resp-role"
          value={respRole}
          onChange={(e) => setRespRole(e.target.value)}
        />
      </div>

      <div className="space-y-1">
        <Label htmlFor="settings-base-year">{m.settings_base_year_label()}</Label>
        <select
          id="settings-base-year"
          value={baseYearId ?? ''}
          onChange={(e) => setBaseYearId(e.target.value === '' ? null : e.target.value)}
          className="flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2"
        >
          <option value="">{m.settings_base_year_none()}</option>
          {periodsQuery.data?.map((period) => (
            <option key={period.id} value={period.id}>
              {period.year}
            </option>
          ))}
        </select>
      </div>

      <div className="flex justify-end pt-2">
        <Button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending}
        >
          {saveMutation.isPending ? m.settings_saving() : m.settings_reporting_profile_save()}
        </Button>
      </div>
    </div>
  );
}
