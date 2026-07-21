import { EfPicker } from '@renderer/components/EfPicker';
import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { activityImportApi } from '@renderer/lib/api/activity-import';
import { sourceApi } from '@renderer/lib/api/emission-source';
import { orgApi } from '@renderer/lib/api/organization';
import { friendlyErrorDescription } from '@renderer/lib/error-message';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import type {
  ActivityImportField,
  ActivityImportGroup,
  ActivityImportMapping,
  ActivityImportPreview,
  ActivityImportResult,
  ActivityImportRowIssue,
  ActivityImportSourceStatus,
  ActivityImportValidation,
  EfCompositePk,
  EfImportFileErrorCode,
  EmissionSource,
} from '@shared/types';
import { ACTIVITY_IMPORT_FIELDS, ACTIVITY_IMPORT_REQUIRED_FIELDS } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  CheckCircle2,
  FileSpreadsheet,
  FileUp,
  SkipForward,
  XCircle,
} from 'lucide-react';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { Drawer } from 'vaul';

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

const FIELD_LABELS: Record<ActivityImportField, () => string> = {
  source_name: m.activity_import_field_source_name,
  description: m.activity_import_field_description,
  amount: m.activity_import_field_amount,
  unit: m.activity_import_field_unit,
  occurred_at_start: m.activity_import_field_occurred_at_start,
  occurred_at_end: m.activity_import_field_occurred_at_end,
  notes: m.activity_import_field_notes,
};

const ISSUE_LABELS: Record<ActivityImportRowIssue['code'], () => string> = {
  source_name_missing: m.activity_import_issue_source_name_missing,
  description_missing: m.activity_import_issue_description_missing,
  amount_missing: m.activity_import_issue_amount_missing,
  amount_invalid: m.activity_import_issue_amount_invalid,
  unit_missing: m.activity_import_issue_unit_missing,
  date_invalid: m.activity_import_issue_date_invalid,
  date_range_invalid: m.activity_import_issue_date_range_invalid,
  period_mismatch: m.activity_import_issue_period_mismatch,
  duplicate_in_file: m.activity_import_issue_duplicate_in_file,
  duplicate_in_db: m.activity_import_issue_duplicate_in_db,
  unit_dimension_mismatch: m.activity_import_issue_unit_dimension_mismatch,
  amount_outlier: m.activity_import_issue_amount_outlier,
};

// File-level parse failures reuse the shared parser, so the EF-import
// messages already cover every code — no duplicate key set.
const FILE_ERROR_LABELS: Record<EfImportFileErrorCode, () => string> = {
  file_empty: m.ef_import_file_error_file_empty,
  file_too_large: m.ef_import_file_error_file_too_large,
  too_many_rows: m.ef_import_file_error_too_many_rows,
  xlsx_invalid: m.ef_import_file_error_xlsx_invalid,
  unsupported_file_type: m.ef_import_file_error_unsupported_file_type,
  file_read_failed: m.ef_import_file_error_file_read_failed,
};

const FUEL_CODES = ['gasoline', 'diesel', 'natural_gas', 'lpg', 'coal_anthracite'] as const;
const FUEL_CODE_LABELS: Record<(typeof FUEL_CODES)[number], () => string> = {
  gasoline: m.fuel_gasoline,
  diesel: m.fuel_diesel,
  natural_gas: m.fuel_natural_gas,
  lpg: m.fuel_lpg,
  coal_anthracite: m.fuel_coal_anthracite,
};

type Step = 'file' | 'mapping' | 'sources' | 'groups' | 'result';

export interface ActivityImportDrawerProps {
  open: boolean;
  onClose: () => void;
  organizationId: string;
}

/**
 * Batch activity-data import wizard (ROADMAP §8.1-①): pick file → column
 * mapping + reporting period → resolve ledger source names → confirm one EF
 * per (description, unit, source) group → import + result report. Parse
 * state is staged in the main process behind a token; closing without
 * importing discards it. EF choices stay 100% human — the wizard only
 * changes the granularity of the confirmation, never removes it.
 */
export function ActivityImportDrawer({ open, onClose, organizationId }: ActivityImportDrawerProps) {
  const queryClient = useQueryClient();
  const [step, setStep] = useState<Step>('file');
  const [preview, setPreview] = useState<ActivityImportPreview | null>(null);
  const [mapping, setMapping] = useState<ActivityImportMapping>({});
  const [periodId, setPeriodId] = useState('');
  const [validation, setValidation] = useState<ActivityImportValidation | null>(null);
  const [sources, setSources] = useState<ActivityImportSourceStatus[]>([]);
  const [groups, setGroups] = useState<ActivityImportGroup[]>([]);
  const [result, setResult] = useState<(ActivityImportResult & { ok: true }) | null>(null);

  const periodsQuery = useQuery({
    queryKey: ['org:list-reporting-periods', organizationId],
    queryFn: () => orgApi.listReportingPeriods({ organization_id: organizationId }),
    enabled: open,
  });
  const orgSourcesQuery = useQuery<EmissionSource[]>({
    queryKey: ['source:list-by-org', organizationId],
    queryFn: () => sourceApi.listByOrg({ organization_id: organizationId }),
    enabled: open,
  });
  const sitesQuery = useQuery({
    queryKey: ['org:list-sites', organizationId],
    queryFn: () => orgApi.listSites({ organization_id: organizationId }),
    enabled: open,
  });

  const resetAll = () => {
    setStep('file');
    setPreview(null);
    setMapping({});
    setPeriodId('');
    setValidation(null);
    setSources([]);
    setGroups([]);
    setResult(null);
  };

  const closeDrawer = () => {
    // After a successful import the token is already consumed; otherwise
    // drop the staged parse in the main process.
    if (preview && result === null) void activityImportApi.discard({ token: preview.token });
    resetAll();
    onClose();
  };

  const onTokenExpired = () => {
    toast.error(m.activity_import_error_token_expired());
    resetAll();
  };

  const pickMutation = useMutation({
    mutationFn: activityImportApi.pickFile,
    onSuccess: (res) => {
      if (res.canceled) return;
      if ('error' in res) {
        toast.error(FILE_ERROR_LABELS[res.error.code](), {
          ...(res.error.detail !== undefined ? { description: res.error.detail } : {}),
        });
        return;
      }
      setPreview(res.preview);
      setMapping(res.preview.mapping);
      setValidation(res.preview.validation);
      setSources([]);
      setGroups([]);
      setStep('mapping');
      // A period may already be chosen (repick path) — keep it and revalidate
      // so period_mismatch warnings reflect the new file.
      if (periodId !== '') {
        revalidateMutation.mutate({ token: res.preview.token, mapping: res.preview.mapping });
      }
    },
    onError: (err) => {
      toast.error(m.activity_import_pick_failed(), { description: friendlyErrorDescription(err) });
    },
  });

  const revalidateMutation = useMutation({
    mutationFn: (input: { token: string; mapping: ActivityImportMapping }) => {
      if (periodId === '') return Promise.resolve(undefined);
      return activityImportApi.revalidate({ ...input, period_id: periodId });
    },
    onSuccess: (res) => {
      if (res === undefined) return; // no period yet — nothing recomputed
      if (res === null) {
        onTokenExpired();
        return;
      }
      setValidation(res);
      setSources([]);
      setGroups([]);
    },
  });

  const changeMapping = (field: ActivityImportField, column: number | undefined) => {
    if (!preview) return;
    const next: ActivityImportMapping = { ...mapping };
    if (column === undefined) delete next[field];
    else next[field] = column;
    setMapping(next);
    revalidateMutation.mutate({ token: preview.token, mapping: next });
  };

  const changePeriod = (nextPeriodId: string) => {
    setPeriodId(nextPeriodId);
    // periodId state isn't visible to the mutation closure yet — inline call.
    if (preview && nextPeriodId !== '') {
      void activityImportApi
        .revalidate({ token: preview.token, mapping, period_id: nextPeriodId })
        .then((res) => {
          if (res === null) {
            onTokenExpired();
            return;
          }
          setValidation(res);
          setSources([]);
          setGroups([]);
        });
    }
  };

  const goSources = async () => {
    if (!preview) return;
    const list = await activityImportApi.listSources({
      token: preview.token,
      organization_id: organizationId,
    });
    if (list === null) {
      onTokenExpired();
      return;
    }
    setSources(list);
    setStep('sources');
  };

  const refreshSources = async () => {
    if (!preview) return;
    const list = await activityImportApi.listSources({
      token: preview.token,
      organization_id: organizationId,
    });
    if (list !== null) setSources(list);
  };

  const goGroups = async () => {
    if (!preview) return;
    const list = await activityImportApi.listGroups({ token: preview.token });
    if (list === null) {
      onTokenExpired();
      return;
    }
    setGroups(list);
    setStep('groups');
  };

  const patchGroup = (key: string, patch: Partial<ActivityImportGroup>) => {
    setGroups((prev) => prev.map((g) => (g.key === key ? { ...g, ...patch } : g)));
  };

  const importMutation = useMutation({
    mutationFn: () => {
      if (!preview) throw new Error('no staged import');
      return Promise.resolve(activityImportApi.import({ token: preview.token }));
    },
    onSuccess: (res) => {
      if (res.ok) {
        setResult(res);
        setStep('result');
        void queryClient.invalidateQueries({ queryKey: ['activity:list-by-period'] });
        void queryClient.invalidateQueries({ queryKey: ['source:list-by-org'] });
        return;
      }
      switch (res.error._tag) {
        case 'TokenExpired':
          onTokenExpired();
          break;
        case 'PeriodMissing':
          toast.error(m.activity_import_error_period_missing());
          break;
        case 'UnconfirmedGroups':
          toast.error(m.activity_import_error_unconfirmed());
          break;
        case 'NothingToImport':
          toast.error(m.activity_import_error_nothing_to_import());
          break;
      }
    },
    onError: (err) => {
      toast.error(m.activity_import_failed(), { description: friendlyErrorDescription(err) });
    },
  });

  const requiredMapped = ACTIVITY_IMPORT_REQUIRED_FIELDS.every((f) => mapping[f] !== undefined);
  const canLeaveMapping =
    preview !== null &&
    requiredMapped &&
    periodId !== '' &&
    (validation?.valid_count ?? 0) > 0 &&
    !revalidateMutation.isPending;
  const resolvedCount = sources.filter((s) => s.resolved_source_id !== null).length;
  const allGroupsSettled = groups.length > 0 && groups.every((g) => g.status !== 'pending');
  const confirmedGroups = groups.filter((g) => g.status === 'confirmed').length;

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) closeDrawer();
      }}
      direction="right"
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30" style={NO_DRAG} />
        <Drawer.Content
          style={NO_DRAG}
          className="fixed right-0 top-0 bottom-0 z-50 flex w-[720px] flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="shrink-0 border-b border-border px-5 py-4">
            <Drawer.Title className="text-base font-semibold text-foreground">
              {m.activity_import_title()}
            </Drawer.Title>
            <p className="mt-1 text-xs text-muted-foreground">{m.activity_import_description()}</p>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {step === 'file' && (
              <div className="rounded-md border border-border bg-card/30 px-4 py-6 text-center">
                <FileSpreadsheet className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-xs text-muted-foreground">
                  {m.activity_import_pick_hint()}
                </p>
                <div className="mt-3 flex justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    disabled={pickMutation.isPending}
                    onClick={() => pickMutation.mutate()}
                  >
                    <FileUp className="h-4 w-4" />
                    {m.activity_import_pick_button()}
                  </Button>
                </div>
              </div>
            )}

            {step === 'mapping' && preview && (
              <>
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card/30 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm" title={preview.filename}>
                      {preview.filename}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {m.activity_import_row_count({ count: String(preview.total_rows) })}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pickMutation.isPending}
                    onClick={() => pickMutation.mutate()}
                  >
                    {m.activity_import_repick_button()}
                  </Button>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="activity-import-period">{m.activity_import_period_label()}</Label>
                  <select
                    id="activity-import-period"
                    value={periodId}
                    onChange={(e) => changePeriod(e.target.value)}
                    className="h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:border-ring"
                  >
                    <option value="">{m.activity_import_period_placeholder()}</option>
                    {(periodsQuery.data ?? []).map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.year} · {p.starts_at.slice(0, 10)} ~ {p.ends_at.slice(0, 10)}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">{m.activity_import_period_hint()}</p>
                </div>

                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">{m.activity_import_mapping_heading()}</h3>
                  <p className="text-xs text-muted-foreground">
                    {m.activity_import_mapping_body()}
                  </p>
                  <div className="divide-y divide-border rounded-md border border-border">
                    {ACTIVITY_IMPORT_FIELDS.map((field) => {
                      const required = ACTIVITY_IMPORT_REQUIRED_FIELDS.includes(field);
                      const value = mapping[field];
                      return (
                        <div
                          key={field}
                          className="grid grid-cols-[minmax(0,1fr)_200px] items-center gap-3 px-3 py-1.5"
                        >
                          <span className="truncate text-sm">
                            {FIELD_LABELS[field]()}
                            {required && (
                              <span
                                className="ml-0.5 text-destructive"
                                title={m.activity_import_required()}
                              >
                                *
                              </span>
                            )}
                          </span>
                          <select
                            aria-label={FIELD_LABELS[field]()}
                            value={value === undefined ? '' : String(value)}
                            onChange={(e) =>
                              changeMapping(
                                field,
                                e.target.value === '' ? undefined : Number(e.target.value),
                              )
                            }
                            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring"
                          >
                            <option value="">{m.activity_import_unmapped()}</option>
                            {preview.headers.map((header, idx) => (
                              // biome-ignore lint/suspicious/noArrayIndexKey: the column index IS the option's identity (its value); headers may repeat.
                              <option key={idx} value={String(idx)}>
                                {header === ''
                                  ? m.activity_import_column_n({ n: String(idx + 1) })
                                  : header}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {validation && (
                  <ValidationSummary
                    validation={validation}
                    showSample={validation.sample.length > 0}
                  />
                )}
              </>
            )}

            {step === 'sources' && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{m.activity_import_sources_heading()}</h3>
                <p className="text-xs text-muted-foreground">{m.activity_import_sources_body()}</p>
                <div className="divide-y divide-border rounded-md border border-border">
                  {sources.map((s) => (
                    <SourceRow
                      key={s.name}
                      status={s}
                      token={preview?.token ?? ''}
                      orgSources={orgSourcesQuery.data ?? []}
                      sites={sitesQuery.data ?? []}
                      onResolved={() => {
                        void refreshSources();
                        void orgSourcesQuery.refetch();
                      }}
                      onTokenExpired={onTokenExpired}
                    />
                  ))}
                </div>
              </section>
            )}

            {step === 'groups' && (
              <section className="space-y-2">
                <h3 className="text-sm font-semibold">{m.activity_import_groups_heading()}</h3>
                <p className="text-xs text-muted-foreground">{m.activity_import_groups_body()}</p>
                <div className="space-y-3">
                  {groups.map((g) => (
                    <GroupCard
                      key={g.key}
                      group={g}
                      token={preview?.token ?? ''}
                      onPatched={(patch) => patchGroup(g.key, patch)}
                      onTokenExpired={onTokenExpired}
                    />
                  ))}
                </div>
              </section>
            )}

            {step === 'result' && result && (
              <section className="space-y-3">
                <div className="rounded-md border border-border bg-card/30 px-4 py-4 text-center">
                  <CheckCircle2 className="mx-auto h-6 w-6 text-primary" />
                  <p className="mt-2 text-sm font-semibold">{m.activity_import_result_heading()}</p>
                  <p className="mt-1 text-sm tabular-nums">
                    {m.activity_import_result_imported({ count: String(result.imported_count) })}
                  </p>
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {result.skipped.validation_errors > 0 && (
                    <li>
                      {m.activity_import_result_skipped_validation({
                        count: String(result.skipped.validation_errors),
                      })}
                    </li>
                  )}
                  {result.skipped.unresolved_sources > 0 && (
                    <li>
                      {m.activity_import_result_skipped_sources({
                        count: String(result.skipped.unresolved_sources),
                      })}
                    </li>
                  )}
                  {result.skipped.skipped_groups > 0 && (
                    <li>
                      {m.activity_import_result_skipped_groups({
                        count: String(result.skipped.skipped_groups),
                      })}
                    </li>
                  )}
                </ul>
                {result.warnings.length > 0 && (
                  <IssueList
                    heading={m.activity_import_result_warnings_heading()}
                    issues={result.warnings}
                    totalCount={result.warning_count}
                    tone="warning"
                  />
                )}
              </section>
            )}
          </div>

          <div className="flex shrink-0 items-center justify-between gap-2 border-t border-border bg-background/95 px-5 py-3 backdrop-blur">
            <div className="text-xs text-muted-foreground tabular-nums">
              {step === 'sources' && `${resolvedCount}/${sources.length}`}
              {step === 'groups' && `${confirmedGroups}/${groups.length}`}
            </div>
            <div className="flex gap-2">
              {step === 'sources' && (
                <Button type="button" variant="ghost" onClick={() => setStep('mapping')}>
                  {m.activity_import_back_button()}
                </Button>
              )}
              {step === 'groups' && (
                <Button type="button" variant="ghost" onClick={() => setStep('sources')}>
                  {m.activity_import_back_button()}
                </Button>
              )}
              {step !== 'result' && (
                <Button type="button" variant="outline" onClick={closeDrawer}>
                  {m.activity_import_cancel_button()}
                </Button>
              )}
              {step === 'mapping' && (
                <Button type="button" disabled={!canLeaveMapping} onClick={() => void goSources()}>
                  {m.activity_import_next_button()}
                </Button>
              )}
              {step === 'sources' && (
                <Button
                  type="button"
                  disabled={resolvedCount === 0}
                  onClick={() => void goGroups()}
                >
                  {m.activity_import_next_button()}
                </Button>
              )}
              {step === 'groups' && (
                <Button
                  type="button"
                  disabled={!allGroupsSettled || confirmedGroups === 0 || importMutation.isPending}
                  onClick={() => importMutation.mutate()}
                >
                  {m.activity_import_import_button()}
                </Button>
              )}
              {step === 'result' && (
                <Button type="button" onClick={closeDrawer}>
                  {m.activity_import_close_button()}
                </Button>
              )}
            </div>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function ValidationSummary({
  validation,
  showSample,
}: {
  validation: ActivityImportValidation;
  showSample: boolean;
}) {
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center gap-4 text-sm">
        <span className="inline-flex items-center gap-1.5">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <span className="tabular-nums">
            {m.activity_import_summary_valid({ count: String(validation.valid_count) })}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <XCircle className="h-4 w-4 text-destructive" />
          <span className="tabular-nums">
            {m.activity_import_summary_errors({ count: String(validation.error_count) })}
          </span>
        </span>
        <span className="inline-flex items-center gap-1.5">
          <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          <span className="tabular-nums">
            {m.activity_import_summary_warnings({ count: String(validation.warning_count) })}
          </span>
        </span>
      </div>
      {validation.errors.length > 0 && (
        <IssueList
          heading={m.activity_import_errors_heading()}
          issues={validation.errors}
          totalCount={validation.error_count}
          tone="error"
        />
      )}
      {validation.warnings.length > 0 && (
        <IssueList
          heading={m.activity_import_warnings_heading()}
          issues={validation.warnings}
          totalCount={validation.warning_count}
          tone="warning"
        />
      )}
      {showSample && (
        <div className="space-y-1">
          <ul className="divide-y divide-border rounded-md border border-border">
            {validation.sample.map((row) => (
              <li key={row.row} className="px-3 py-1.5">
                <span className="text-sm">{row.description}</span>
                <span className="ml-2 text-xs text-muted-foreground tabular-nums">
                  {row.source_name} · {row.amount} {row.unit}
                  {row.occurred_at_start ? ` · ${row.occurred_at_start}` : ''}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

function SourceRow({
  status,
  token,
  orgSources,
  sites,
  onResolved,
  onTokenExpired,
}: {
  status: ActivityImportSourceStatus;
  token: string;
  orgSources: EmissionSource[];
  sites: Array<{ id: string; name_en: string | null; name_zh?: string | null }>;
  onResolved: () => void;
  onTokenExpired: () => void;
}) {
  const [creating, setCreating] = useState(false);
  const [scope, setScope] = useState<'1' | '2' | '3'>('1');
  const [siteId, setSiteId] = useState('');
  const [category, setCategory] = useState('');
  const resolved = status.resolved_source_id !== null;
  const effectiveSiteId = siteId !== '' ? siteId : (sites[0]?.id ?? '');

  const resolveTo = async (sourceId: string | null) => {
    const res = await activityImportApi.resolveSource({
      token,
      name: status.name,
      source_id: sourceId,
    });
    if (!res.ok) {
      onTokenExpired();
      return;
    }
    onResolved();
  };

  const createAndResolve = async () => {
    try {
      const created = await sourceApi.create({
        site_id: effectiveSiteId,
        name: status.name,
        scope: Number(scope) as 1 | 2 | 3,
        ...(category.trim() !== '' ? { category: category.trim() } : {}),
      });
      toast.success(m.activity_import_source_created());
      setCreating(false);
      await resolveTo(created.id);
    } catch (err) {
      toast.error(m.activity_import_source_create_failed(), {
        description: friendlyErrorDescription(err),
      });
    }
  };

  return (
    <div className="space-y-2 px-3 py-2">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <span className="text-sm font-medium">{status.name}</span>
          <span className="ml-2 text-xs text-muted-foreground tabular-nums">
            {m.activity_import_source_rows({ count: String(status.row_count) })}
          </span>
        </div>
        <span
          className={cn(
            'shrink-0 rounded-sm border px-1.5 py-0.5 text-[11px]',
            resolved
              ? 'border-border bg-secondary text-muted-foreground'
              : 'border-destructive/40 bg-destructive/10 text-destructive',
          )}
        >
          {resolved ? m.activity_import_source_matched() : m.activity_import_source_unresolved()}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={m.activity_import_source_select_placeholder()}
          value={status.resolved_source_id ?? ''}
          onChange={(e) => void resolveTo(e.target.value === '' ? null : e.target.value)}
          className="h-8 min-w-56 rounded-md border border-border bg-background px-2 text-xs outline-none focus-visible:border-ring"
        >
          <option value="">{m.activity_import_source_select_placeholder()}</option>
          {orgSources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name} · S{s.scope}
            </option>
          ))}
        </select>
        {!resolved && !creating && (
          <Button type="button" variant="outline" size="sm" onClick={() => setCreating(true)}>
            {m.activity_import_source_create_button()}
          </Button>
        )}
      </div>
      {creating && (
        <div className="flex flex-wrap items-end gap-2 rounded-md border border-border bg-card/30 px-2 py-2">
          <div className="space-y-1">
            <Label className="text-xs">{m.activity_import_source_create_scope()}</Label>
            <select
              aria-label={m.activity_import_source_create_scope()}
              value={scope}
              onChange={(e) => setScope(e.target.value as '1' | '2' | '3')}
              className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none"
            >
              <option value="1">Scope 1</option>
              <option value="2">Scope 2</option>
              <option value="3">Scope 3</option>
            </select>
          </div>
          {sites.length > 1 && (
            <div className="space-y-1">
              <Label className="text-xs">{m.activity_import_source_create_site()}</Label>
              <select
                aria-label={m.activity_import_source_create_site()}
                value={effectiveSiteId}
                onChange={(e) => setSiteId(e.target.value)}
                className="h-8 rounded-md border border-border bg-background px-2 text-xs outline-none"
              >
                {sites.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name_en ?? s.id}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="min-w-40 flex-1 space-y-1">
            <Label className="text-xs">{m.activity_import_source_create_category()}</Label>
            <Input
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-8 text-xs"
            />
          </div>
          <Button
            type="button"
            size="sm"
            disabled={effectiveSiteId === ''}
            onClick={() => void createAndResolve()}
          >
            {m.activity_import_source_create_button()}
          </Button>
        </div>
      )}
    </div>
  );
}

function GroupCard({
  group,
  token,
  onPatched,
  onTokenExpired,
}: {
  group: ActivityImportGroup;
  token: string;
  onPatched: (patch: Partial<ActivityImportGroup>) => void;
  onTokenExpired: () => void;
}) {
  const [open, setOpen] = useState(group.status === 'pending');
  const [efPk, setEfPk] = useState<EfCompositePk | null>(group.ef);
  const [fuelCode, setFuelCode] = useState<string>(group.fuel_code ?? '');
  const [dimensionError, setDimensionError] = useState(false);

  const confirm = async () => {
    if (!efPk) return;
    const res = await activityImportApi.confirmGroup({
      token,
      group_key: group.key,
      ef: efPk,
      fuel_code: fuelCode === '' ? null : fuelCode,
    });
    if (res.ok) {
      setDimensionError(false);
      setOpen(false);
      onPatched({
        status: 'confirmed',
        ef: efPk,
        fuel_code: fuelCode === '' ? null : fuelCode,
      });
      return;
    }
    if (res.error === 'DimensionMismatch') {
      setDimensionError(true);
      return;
    }
    if (res.error === 'TokenExpired') {
      onTokenExpired();
      return;
    }
    toast.error(m.activity_import_failed(), { description: res.error });
  };

  const skip = async () => {
    const res = await activityImportApi.skipGroup({ token, group_key: group.key });
    if (!res.ok) {
      onTokenExpired();
      return;
    }
    setOpen(false);
    onPatched({ status: 'skipped', ef: null, fuel_code: null });
  };

  const statusLabel =
    group.status === 'confirmed'
      ? m.activity_import_group_status_confirmed()
      : group.status === 'skipped'
        ? m.activity_import_group_status_skipped()
        : m.activity_import_group_status_pending();

  return (
    <div className="rounded-md border border-border">
      <div className="flex items-center justify-between gap-3 px-3 py-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{group.description}</p>
          <p className="text-xs text-muted-foreground tabular-nums">
            {m.activity_import_group_rows_total({
              count: String(group.row_count),
              total: String(Math.round(group.amount_total * 100) / 100),
              unit: group.unit,
            })}
            {' · '}
            {group.source_name}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span
            className={cn(
              'rounded-sm border px-1.5 py-0.5 text-[11px]',
              group.status === 'confirmed'
                ? 'border-primary/40 bg-primary/10 text-primary'
                : group.status === 'skipped'
                  ? 'border-border bg-secondary text-muted-foreground'
                  : 'border-destructive/40 bg-destructive/10 text-destructive',
            )}
          >
            {statusLabel}
          </span>
          {!open && (
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}>
              {m.activity_import_group_reopen_button()}
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <EfPicker
            selectedSourceId={group.source_id}
            currentEfPk={efPk}
            textHint={`${group.description} ${group.unit}`}
            onChange={(pk) => {
              setEfPk(pk);
              setDimensionError(false);
            }}
          />
          {dimensionError && (
            <p className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
              {m.activity_import_group_dimension_mismatch()}
            </p>
          )}
          <div className="flex items-end justify-between gap-3">
            <div className="space-y-1">
              <Label className="text-xs">{m.activities_form_fuel()}</Label>
              <select
                aria-label={m.activities_form_fuel()}
                value={fuelCode}
                onChange={(e) => setFuelCode(e.target.value)}
                className="h-8 min-w-44 rounded-md border border-border bg-background px-2 text-xs outline-none"
              >
                <option value="">{m.activities_form_fuel_none()}</option>
                {FUEL_CODES.map((code) => (
                  <option key={code} value={code}>
                    {FUEL_CODE_LABELS[code]()}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="gap-1"
                onClick={() => void skip()}
              >
                <SkipForward className="h-3.5 w-3.5" />
                {m.activity_import_group_skip_button()}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={efPk === null}
                onClick={() => void confirm()}
              >
                {m.activity_import_group_confirm_button()}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function IssueList({
  heading,
  issues,
  totalCount,
  tone,
}: {
  heading: string;
  issues: ActivityImportRowIssue[];
  totalCount: number;
  tone: 'error' | 'warning';
}) {
  return (
    <div className="space-y-1">
      <h4
        className={`text-xs font-medium ${tone === 'error' ? 'text-destructive' : 'text-muted-foreground'}`}
      >
        {heading}
      </h4>
      <ul className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border px-3 py-2">
        {issues.map((issue, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: the list is replaced wholesale on revalidation, never reordered in place; (row, code) alone can repeat.
          <li key={`${issue.row}-${issue.code}-${i}`} className="text-xs text-muted-foreground">
            <span className="font-mono tabular-nums">
              {m.activity_import_row_label({ row: String(issue.row) })}
            </span>{' '}
            {ISSUE_LABELS[issue.code]()}
            {issue.detail !== undefined && (
              <span className="ml-1 font-mono text-foreground/70">{issue.detail}</span>
            )}
          </li>
        ))}
        {totalCount > issues.length && (
          <li className="pt-0.5 text-xs text-muted-foreground">
            {m.activity_import_more_issues({ count: String(totalCount - issues.length) })}
          </li>
        )}
      </ul>
    </div>
  );
}
