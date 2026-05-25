import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { COMMON_COUNTRIES, INDUSTRIES } from '@renderer/features/onboarding/lookups';
import { orgApi } from '@renderer/lib/api/organization';
import { friendlyErrorDescription } from '@renderer/lib/error-message';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';

type BoundaryKind = 'equity_share' | 'financial_control' | 'operational_control';

/**
 * Organization Profile section — Settings → 组织资料.
 *
 * Split into two groups, each with its own Save button:
 *
 *   1. **Basic info** (names, industry, country) — the descriptive
 *      identity the user set during onboarding step 1. Editable here
 *      because users mis-pick the industry on first run, or want to
 *      fix a typo in the company name. Backed by `org:update-basic-info`.
 *
 *   2. **Reporting profile** (boundary, responsible person, base year)
 *      — ISO 14064-1 metadata that drives the inventory report. Backed
 *      by the existing `org:update-reporting-profile`.
 *
 * Two save buttons (not one) so users can edit basic info without
 * being prompted to also save reporting fields they haven't touched.
 * Each group's local state mirrors the org row independently, and the
 * `org:get-current` query is invalidated after either save so the
 * sidebar's app-title and trial chip pick up any name changes
 * immediately.
 */
export function OrganizationProfileSection() {
  const queryClient = useQueryClient();

  const orgQuery = useQuery({
    queryKey: ['org:get-current'],
    queryFn: () => orgApi.getCurrent(),
  });

  if (!orgQuery.data) return null;

  return (
    <div className="space-y-8">
      <BasicInfoGroup
        orgId={orgQuery.data.id}
        initial={orgQuery.data}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['org:get-current'] });
        }}
      />
      <hr className="border-border" />
      <ReportingProfileGroup
        orgId={orgQuery.data.id}
        initial={orgQuery.data}
        onSaved={() => {
          queryClient.invalidateQueries({ queryKey: ['org:get-current'] });
        }}
      />
    </div>
  );
}

interface BasicInfoProps {
  orgId: string;
  initial: {
    name_zh: string | null;
    name_en: string | null;
    industry: string | null;
    country_code: string;
  };
  onSaved: () => void;
}

/**
 * Basic-identity editor — mirrors onboarding step 1's field set. Reuses
 * the shared `INDUSTRIES` + `COMMON_COUNTRIES` lookups so the picker
 * options are guaranteed to match the wizard.
 */
function BasicInfoGroup({ orgId, initial, onSaved }: BasicInfoProps) {
  const [nameZh, setNameZh] = useState(initial.name_zh ?? '');
  const [nameEn, setNameEn] = useState(initial.name_en ?? '');
  const [industry, setIndustry] = useState(initial.industry ?? '');
  const [country, setCountry] = useState(initial.country_code);

  // Reset local state when the org row changes underneath us (e.g.
  // after another window saved). Without this, the form would show
  // stale values from the first mount.
  // biome-ignore lint/correctness/useExhaustiveDependencies: react to fresh server data, not local state.
  useEffect(() => {
    setNameZh(initial.name_zh ?? '');
    setNameEn(initial.name_en ?? '');
    setIndustry(initial.industry ?? '');
    setCountry(initial.country_code);
  }, [initial.name_zh, initial.name_en, initial.industry, initial.country_code]);

  const saveMutation = useMutation({
    mutationFn: () =>
      orgApi.updateBasicInfo({
        id: orgId,
        name_zh: nameZh.trim() || null,
        name_en: nameEn.trim() || null,
        industry: industry || null,
        country_code: country,
      }),
    onSuccess: () => {
      toast.success(m.settings_reporting_profile_saved());
      onSaved();
    },
    onError: (err) => {
      toast.error(m.settings_save_failed(), { description: friendlyErrorDescription(err) });
    },
  });

  const isArmed = !!(nameZh.trim() || nameEn.trim());

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">{m.settings_org_basic_heading()}</h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="org-basic-name-zh">{m.onboarding_step_company_name_zh()}</Label>
          <Input
            id="org-basic-name-zh"
            value={nameZh}
            onChange={(e) => setNameZh(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-basic-name-en">{m.onboarding_step_company_name_en()}</Label>
          <Input
            id="org-basic-name-en"
            value={nameEn}
            onChange={(e) => setNameEn(e.target.value)}
          />
        </div>
      </div>
      <p className={!isArmed ? 'text-xs text-destructive' : 'text-xs text-muted-foreground'}>
        {m.onboarding_step_company_name_hint()}
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="org-basic-industry">{m.onboarding_step_company_industry()}</Label>
          <select
            id="org-basic-industry"
            value={industry}
            onChange={(e) => setIndustry(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <option value="" disabled>
              {m.onboarding_step_company_industry_placeholder()}
            </option>
            {INDUSTRIES.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label_zh} · {opt.label_en}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="org-basic-country">{m.onboarding_step_company_country()}</Label>
          <select
            id="org-basic-country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {COMMON_COUNTRIES.map((c) => (
              <option key={c.code} value={c.code}>
                {c.label_zh} · {c.label_en}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <Button
          type="button"
          onClick={() => saveMutation.mutate()}
          disabled={saveMutation.isPending || !isArmed}
        >
          {saveMutation.isPending ? m.settings_saving() : m.settings_reporting_profile_save()}
        </Button>
      </div>
    </div>
  );
}

interface ReportingProfileProps {
  orgId: string;
  initial: {
    boundary_kind: BoundaryKind;
    responsible_person_name: string | null;
    responsible_person_role: string | null;
    base_year_period_id: string | null;
  };
  onSaved: () => void;
}

function ReportingProfileGroup({ orgId, initial, onSaved }: ReportingProfileProps) {
  const periodsQuery = useQuery({
    queryKey: ['org:list-reporting-periods', orgId],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: orgId }),
  });

  const [boundary, setBoundary] = useState<BoundaryKind>(initial.boundary_kind);
  const [respName, setRespName] = useState(initial.responsible_person_name ?? '');
  const [respRole, setRespRole] = useState(initial.responsible_person_role ?? '');
  const [baseYearId, setBaseYearId] = useState<string | null>(initial.base_year_period_id);

  // biome-ignore lint/correctness/useExhaustiveDependencies: react to fresh server data, not local state.
  useEffect(() => {
    setBoundary(initial.boundary_kind);
    setRespName(initial.responsible_person_name ?? '');
    setRespRole(initial.responsible_person_role ?? '');
    setBaseYearId(initial.base_year_period_id);
  }, [
    initial.boundary_kind,
    initial.responsible_person_name,
    initial.responsible_person_role,
    initial.base_year_period_id,
  ]);

  const saveMutation = useMutation({
    mutationFn: () =>
      orgApi.updateReportingProfile({
        id: orgId,
        boundary_kind: boundary,
        responsible_person_name: respName || null,
        responsible_person_role: respRole || null,
        base_year_period_id: baseYearId,
      }),
    onSuccess: () => {
      toast.success(m.settings_reporting_profile_saved());
      onSaved();
    },
    onError: (err) => {
      toast.error(m.settings_save_failed(), { description: friendlyErrorDescription(err) });
    },
  });

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold">{m.settings_org_reporting_heading()}</h3>

      <div className="space-y-1.5">
        <Label htmlFor="settings-boundary">{m.settings_boundary_label()}</Label>
        <select
          id="settings-boundary"
          value={boundary}
          onChange={(e) => setBoundary(e.target.value as BoundaryKind)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="equity_share">{m.settings_boundary_equity_share()}</option>
          <option value="financial_control">{m.settings_boundary_financial_control()}</option>
          <option value="operational_control">{m.settings_boundary_operational_control()}</option>
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-1.5">
          <Label htmlFor="settings-resp-name">{m.settings_responsible_name_label()}</Label>
          <Input
            id="settings-resp-name"
            value={respName}
            onChange={(e) => setRespName(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="settings-resp-role">{m.settings_responsible_role_label()}</Label>
          <Input
            id="settings-resp-role"
            value={respRole}
            onChange={(e) => setRespRole(e.target.value)}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="settings-base-year">{m.settings_base_year_label()}</Label>
        <select
          id="settings-base-year"
          value={baseYearId ?? ''}
          onChange={(e) => setBaseYearId(e.target.value === '' ? null : e.target.value)}
          className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
        >
          <option value="">{m.settings_base_year_none()}</option>
          {periodsQuery.data?.map((period) => (
            <option key={period.id} value={period.id}>
              {period.year}
            </option>
          ))}
        </select>
      </div>

      <div className="flex justify-end pt-1">
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
