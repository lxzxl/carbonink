import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { userEfLibraryApi } from '@renderer/lib/api/user-ef-library';
import { friendlyErrorDescription } from '@renderer/lib/error-message';
import * as m from '@renderer/paraglide/messages';
import type {
  EfImportField,
  EfImportFileErrorCode,
  EfImportIssueCode,
  EfImportMapping,
  EfImportPreview,
  EfImportRowIssue,
  EfImportValidation,
} from '@shared/types';
import { EF_IMPORT_FIELDS, EF_IMPORT_REQUIRED_FIELDS } from '@shared/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, CheckCircle2, FileSpreadsheet, FileUp, XCircle } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { Drawer } from 'vaul';

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

const FIELD_LABELS: Record<EfImportField, () => string> = {
  factor_code: m.ef_import_field_factor_code,
  name_zh: m.ef_import_field_name_zh,
  name_en: m.ef_import_field_name_en,
  scope: m.ef_import_field_scope,
  category: m.ef_import_field_category,
  year: m.ef_import_field_year,
  geography: m.ef_import_field_geography,
  input_unit: m.ef_import_field_input_unit,
  co2e_kg_per_unit: m.ef_import_field_co2e_kg_per_unit,
  ch4_kg_per_unit: m.ef_import_field_ch4_kg_per_unit,
  n2o_kg_per_unit: m.ef_import_field_n2o_kg_per_unit,
  hfc_kg_per_unit: m.ef_import_field_hfc_kg_per_unit,
  pfc_kg_per_unit: m.ef_import_field_pfc_kg_per_unit,
  sf6_kg_per_unit: m.ef_import_field_sf6_kg_per_unit,
  nf3_kg_per_unit: m.ef_import_field_nf3_kg_per_unit,
  biogenic_co2_factor: m.ef_import_field_biogenic_co2_factor,
  gwp_basis: m.ef_import_field_gwp_basis,
  description_zh: m.ef_import_field_description_zh,
  description_en: m.ef_import_field_description_en,
  notes: m.ef_import_field_notes,
  citation_url: m.ef_import_field_citation_url,
};

const ISSUE_LABELS: Record<EfImportIssueCode, () => string> = {
  name_missing: m.ef_import_issue_name_missing,
  scope_missing: m.ef_import_issue_scope_missing,
  scope_invalid: m.ef_import_issue_scope_invalid,
  year_missing: m.ef_import_issue_year_missing,
  year_invalid: m.ef_import_issue_year_invalid,
  unit_missing: m.ef_import_issue_unit_missing,
  co2e_missing: m.ef_import_issue_co2e_missing,
  value_invalid: m.ef_import_issue_value_invalid,
  gwp_invalid: m.ef_import_issue_gwp_invalid,
  duplicate_key: m.ef_import_issue_duplicate_key,
  category_empty: m.ef_import_issue_category_empty,
  unit_unknown: m.ef_import_issue_unit_unknown,
};

const FILE_ERROR_LABELS: Record<EfImportFileErrorCode, () => string> = {
  file_empty: m.ef_import_file_error_file_empty,
  file_too_large: m.ef_import_file_error_file_too_large,
  too_many_rows: m.ef_import_file_error_too_many_rows,
  xlsx_invalid: m.ef_import_file_error_xlsx_invalid,
  unsupported_file_type: m.ef_import_file_error_unsupported_file_type,
  file_read_failed: m.ef_import_file_error_file_read_failed,
};

/** "factors.csv" → "factors" — the default library name suggestion. */
function nameFromFilename(filename: string): string {
  return filename.replace(/\.(xlsx|csv)$/i, '').trim();
}

export interface EfLibraryImportDrawerProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Import wizard for a user EF library (ROADMAP §8.1-④): pick file (native
 * dialog) → column-mapping + validation preview → import. Parse state is
 * staged in the main process behind a token; closing without importing
 * discards it.
 */
export function EfLibraryImportDrawer({ open, onClose }: EfLibraryImportDrawerProps) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<EfImportPreview | null>(null);
  const [mapping, setMapping] = useState<EfImportMapping>({});
  const [validation, setValidation] = useState<EfImportValidation | null>(null);
  const [name, setName] = useState('');
  const [version, setVersion] = useState('');
  // Set when import came back NameExists — arms the replace confirmation.
  const [replaceArmed, setReplaceArmed] = useState(false);

  const resetAll = () => {
    setPreview(null);
    setMapping({});
    setValidation(null);
    setName('');
    setVersion('');
    setReplaceArmed(false);
  };

  const closeAndDiscard = () => {
    if (preview) void userEfLibraryApi.discard({ token: preview.token });
    resetAll();
    onClose();
  };

  const pickMutation = useMutation({
    mutationFn: userEfLibraryApi.pickFile,
    onSuccess: (result) => {
      if (result.canceled) return;
      if ('error' in result) {
        toast.error(FILE_ERROR_LABELS[result.error.code](), {
          ...(result.error.detail !== undefined ? { description: result.error.detail } : {}),
        });
        return;
      }
      setPreview(result.preview);
      setMapping(result.preview.mapping);
      setValidation(result.preview.validation);
      setReplaceArmed(false);
      setName((prev) => (prev.trim() === '' ? nameFromFilename(result.preview.filename) : prev));
    },
    onError: (err) => {
      toast.error(m.ef_import_pick_failed(), { description: friendlyErrorDescription(err) });
    },
  });

  const revalidateMutation = useMutation({
    mutationFn: (next: EfImportMapping) => {
      if (!preview) return Promise.resolve(null);
      return userEfLibraryApi.revalidate({ token: preview.token, mapping: next });
    },
    onSuccess: (result) => {
      if (result === null) {
        // Staged parse is gone (app restart etc.) — back to the pick step.
        toast.error(m.ef_import_error_token_expired());
        resetAll();
        return;
      }
      setValidation(result);
    },
  });

  const changeMapping = (field: EfImportField, column: number | undefined) => {
    const next: EfImportMapping = { ...mapping };
    if (column === undefined) delete next[field];
    else next[field] = column;
    setMapping(next);
    setReplaceArmed(false);
    revalidateMutation.mutate(next);
  };

  const importMutation = useMutation({
    mutationFn: (allowReplace: boolean) => {
      if (!preview) throw new Error('no staged import');
      return Promise.resolve(
        userEfLibraryApi.import({
          token: preview.token,
          name: name.trim(),
          version: version.trim(),
          allow_replace: allowReplace,
          mapping,
        }),
      );
    },
    onSuccess: (result) => {
      if (result.ok) {
        toast.success(m.ef_import_success({ count: String(result.imported_count) }), {
          ...(result.skipped_count > 0
            ? { description: m.ef_import_success_skipped({ count: String(result.skipped_count) }) }
            : {}),
        });
        void queryClient.invalidateQueries({ queryKey: ['ef-library:list'] });
        void queryClient.invalidateQueries({ queryKey: ['ef:list'] });
        resetAll();
        onClose();
        return;
      }
      switch (result.error._tag) {
        case 'NameExists':
          setReplaceArmed(true);
          break;
        case 'TokenExpired':
          toast.error(m.ef_import_error_token_expired());
          resetAll();
          break;
        case 'InvalidName':
          toast.error(m.ef_import_error_invalid_name());
          break;
        case 'NothingToImport':
          toast.error(m.ef_import_error_nothing_to_import());
          break;
      }
    },
    onError: (err) => {
      toast.error(m.ef_import_failed(), { description: friendlyErrorDescription(err) });
    },
  });

  const requiredMapped = EF_IMPORT_REQUIRED_FIELDS.every((f) => mapping[f] !== undefined);
  const canImport =
    preview !== null &&
    requiredMapped &&
    (validation?.valid_count ?? 0) > 0 &&
    name.trim().length > 0 &&
    !importMutation.isPending &&
    !revalidateMutation.isPending;

  return (
    <Drawer.Root
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) closeAndDiscard();
      }}
      direction="right"
    >
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30" style={NO_DRAG} />
        <Drawer.Content
          style={NO_DRAG}
          className="fixed right-0 top-0 bottom-0 z-50 flex w-[640px] flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="shrink-0 border-b border-border px-5 py-4">
            <Drawer.Title className="text-base font-semibold text-foreground">
              {m.ef_import_title()}
            </Drawer.Title>
            <p className="mt-1 text-xs text-muted-foreground">{m.ef_import_description()}</p>
          </div>

          <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
            {/* Step 1 — file */}
            {preview === null ? (
              <div className="rounded-md border border-border bg-card/30 px-4 py-6 text-center">
                <FileSpreadsheet className="mx-auto h-6 w-6 text-muted-foreground" />
                <p className="mt-2 text-xs text-muted-foreground">{m.ef_import_pick_hint()}</p>
                <div className="mt-3 flex justify-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="gap-2"
                    disabled={pickMutation.isPending}
                    onClick={() => pickMutation.mutate()}
                  >
                    <FileUp className="h-4 w-4" />
                    {m.ef_import_pick_button()}
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {/* File summary + repick */}
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-card/30 px-3 py-2">
                  <div className="flex min-w-0 items-center gap-2">
                    <FileSpreadsheet className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="truncate text-sm" title={preview.filename}>
                      {preview.filename}
                    </span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {m.ef_import_row_count({ count: String(preview.total_rows) })}
                    </span>
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={pickMutation.isPending}
                    onClick={() => pickMutation.mutate()}
                  >
                    {m.ef_import_repick_button()}
                  </Button>
                </div>

                {/* Library name + version */}
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="ef-import-name">{m.ef_import_name_label()}</Label>
                    <Input
                      id="ef-import-name"
                      value={name}
                      maxLength={50}
                      placeholder={m.ef_import_name_placeholder()}
                      onChange={(e) => {
                        setName(e.target.value);
                        setReplaceArmed(false);
                      }}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ef-import-version">{m.ef_import_version_label()}</Label>
                    <Input
                      id="ef-import-version"
                      value={version}
                      maxLength={50}
                      placeholder={m.ef_import_version_placeholder()}
                      onChange={(e) => setVersion(e.target.value)}
                    />
                  </div>
                </div>

                {/* Column mapping */}
                <section className="space-y-2">
                  <h3 className="text-sm font-semibold">{m.ef_import_mapping_heading()}</h3>
                  <p className="text-xs text-muted-foreground">{m.ef_import_mapping_body()}</p>
                  <div className="divide-y divide-border rounded-md border border-border">
                    {EF_IMPORT_FIELDS.map((field) => {
                      const required = EF_IMPORT_REQUIRED_FIELDS.includes(field);
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
                                title={m.ef_import_required()}
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
                            <option value="">{m.ef_import_unmapped()}</option>
                            {preview.headers.map((header, idx) => (
                              // biome-ignore lint/suspicious/noArrayIndexKey: the column index IS the option's identity (its value); headers may repeat.
                              <option key={idx} value={String(idx)}>
                                {header === ''
                                  ? m.ef_import_column_n({ n: String(idx + 1) })
                                  : header}
                              </option>
                            ))}
                          </select>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Validation summary */}
                {validation && (
                  <section className="space-y-2">
                    <div className="flex flex-wrap items-center gap-4 text-sm">
                      <span className="inline-flex items-center gap-1.5">
                        <CheckCircle2 className="h-4 w-4 text-primary" />
                        <span className="tabular-nums">
                          {m.ef_import_summary_valid({ count: String(validation.valid_count) })}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <XCircle className="h-4 w-4 text-destructive" />
                        <span className="tabular-nums">
                          {m.ef_import_summary_errors({ count: String(validation.error_count) })}
                        </span>
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4 text-muted-foreground" />
                        <span className="tabular-nums">
                          {m.ef_import_summary_warnings({
                            count: String(validation.warning_count),
                          })}
                        </span>
                      </span>
                    </div>

                    {validation.errors.length > 0 && (
                      <IssueList
                        heading={m.ef_import_errors_heading()}
                        issues={validation.errors}
                        totalCount={validation.error_count}
                        tone="error"
                      />
                    )}
                    {validation.warnings.length > 0 && (
                      <IssueList
                        heading={m.ef_import_warnings_heading()}
                        issues={validation.warnings}
                        totalCount={validation.warning_count}
                        tone="warning"
                      />
                    )}

                    {validation.sample.length > 0 && (
                      <div className="space-y-1">
                        <h4 className="text-xs font-medium text-muted-foreground">
                          {m.ef_import_sample_heading()}
                        </h4>
                        <ul className="divide-y divide-border rounded-md border border-border">
                          {validation.sample.map((row) => (
                            <li
                              key={`${row.factor_code}-${row.year}-${row.geography}`}
                              className="px-3 py-1.5"
                            >
                              <span className="text-sm">
                                {row.name_zh ?? row.name_en ?? row.factor_code}
                              </span>
                              <span className="ml-2 text-xs text-muted-foreground">
                                SCOPE {row.scope} · {row.geography} · {row.year} ·{' '}
                                <span className="tabular-nums">{row.co2e_kg_per_unit}</span> kg
                                CO2e/
                                {row.input_unit}
                              </span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </section>
                )}

                {/* Replace confirmation (armed by a NameExists result) */}
                {replaceArmed && (
                  <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2.5">
                    <p className="flex items-start gap-2 text-sm text-destructive">
                      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                      {m.ef_import_replace_body({ name: name.trim() })}
                    </p>
                    <div className="flex justify-end gap-2">
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        onClick={() => setReplaceArmed(false)}
                      >
                        {m.ef_import_cancel_button()}
                      </Button>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={importMutation.isPending}
                        onClick={() => importMutation.mutate(true)}
                      >
                        {m.ef_import_replace_confirm_button()}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-background/95 px-5 py-3 backdrop-blur">
            <Button type="button" variant="outline" onClick={closeAndDiscard}>
              {m.ef_import_cancel_button()}
            </Button>
            <Button
              type="button"
              disabled={!canImport || replaceArmed}
              onClick={() => importMutation.mutate(false)}
            >
              {m.ef_import_import_button()}
            </Button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function IssueList({
  heading,
  issues,
  totalCount,
  tone,
}: {
  heading: string;
  issues: EfImportRowIssue[];
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
              {m.ef_import_row_label({ row: String(issue.row) })}
            </span>{' '}
            {ISSUE_LABELS[issue.code]()}
            {issue.detail !== undefined && (
              <span className="ml-1 font-mono text-foreground/70">{issue.detail}</span>
            )}
          </li>
        ))}
        {totalCount > issues.length && (
          <li className="pt-0.5 text-xs text-muted-foreground">
            {m.ef_import_more_issues({ count: String(totalCount - issues.length) })}
          </li>
        )}
      </ul>
    </div>
  );
}
