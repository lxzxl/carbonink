import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { efApi } from '@renderer/lib/api/ef-library';
import { efMatcherApi } from '@renderer/lib/api/ef-matcher';
import type { EfCompositePk, EmissionFactor, MatcherResult } from '@shared/types';
import * as m from '@renderer/paraglide/messages';

export interface EfPickerProps {
  selectedSourceId: string | null;
  /** Pre-selected EF (e.g. the current pin when used inside RebindEfDrawer). */
  currentEfPk: EfCompositePk | null;
  /** Drives the Recommended pane. Omit to hide that pane entirely. */
  matcherHint?: { extraction_id: string; stage_id?: string } | undefined;
  /** Optional scope filter to narrow the Browse pane. */
  scopeFilter?: 1 | 2 | 3 | undefined;
  /** Fires when user picks an EF. Passes both the composite PK and the full row metadata. */
  onChange: (pk: EfCompositePk | null, row: EmissionFactor | null) => void;
}

function efPkEqual(a: EfCompositePk | null, b: EfCompositePk | null): boolean {
  if (!a || !b) return a === b;
  return (
    a.factor_code === b.factor_code &&
    a.year === b.year &&
    a.source === b.source &&
    a.geography === b.geography &&
    a.dataset_version === b.dataset_version
  );
}

function pkOf(ef: EmissionFactor): EfCompositePk {
  return {
    factor_code: ef.factor_code,
    year: ef.year,
    source: ef.source,
    geography: ef.geography,
    dataset_version: ef.dataset_version,
  };
}

export function EfPicker({
  selectedSourceId,
  currentEfPk,
  matcherHint,
  scopeFilter,
  onChange,
}: EfPickerProps) {

  const recommendQuery = useQuery<MatcherResult>({
    queryKey: ['ef:recommend', matcherHint?.extraction_id ?? '', selectedSourceId ?? ''],
    queryFn: (): Promise<MatcherResult> =>
      efMatcherApi.recommend({
        extraction_id: matcherHint!.extraction_id,
        emission_source_id: selectedSourceId!,
      }) as unknown as Promise<MatcherResult>,
    enabled: !!matcherHint && !!selectedSourceId,
    staleTime: Number.POSITIVE_INFINITY,
    retry: false,
  });

  const listQuery = useQuery({
    queryKey: ['ef:list', scopeFilter ?? null],
    queryFn: () => efApi.list(scopeFilter ? { scope: scopeFilter } : {}),
  });

  const efRows: EmissionFactor[] = useMemo(() => listQuery.data ?? [], [listQuery.data]);

  // Return the picker structure. When matcherHint is present, render the Recommended section
  // BEFORE the fieldset, mirroring the original ActivityForm structure for test compatibility.
  return (
    <div className="ef-picker">
      {/* Recommended section — only shown when matcherHint + loading/has candidates */}
      {matcherHint && (recommendQuery.isPending || (recommendQuery.data?.recommended?.length ?? 0) > 0) && (
        <div className="rounded-md border border-[color:var(--color-primary)]/40 bg-[color:var(--color-primary)]/5 p-3">
          <h4 className="text-sm font-medium">{m.ef_matcher_recommended_heading()}</h4>
          {recommendQuery.isPending ? (
            <p className="text-xs text-muted-foreground mt-2">{m.ef_picker_loading()}</p>
          ) : (
            <ul className="mt-2 space-y-2">
              {recommendQuery.data?.recommended.map((rec) => (
                <li key={`${rec.ef.factor_code}-${rec.ef.year}-${rec.ef.source}-${rec.ef.geography}-${rec.ef.dataset_version}`} className="text-sm">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="ef"
                      className="mt-1"
                      checked={efPkEqual(pkOf(rec.ef), currentEfPk)}
                      onChange={() => onChange(pkOf(rec.ef), rec.ef)}
                    />
                    <span>
                      <span className="font-medium">
                        ⭐ {rec.ef.name_zh ?? rec.ef.name_en ?? rec.ef.factor_code}
                      </span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {rec.ef.co2e_kg_per_unit} kgCO₂e/{rec.ef.input_unit}
                      </span>
                      <span className="block text-xs text-muted-foreground">
                        <span>{m.ef_matcher_reasoning_label()}</span> <span>{rec.reasoning_zh}</span>
                      </span>
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* Browse/All fieldset - always shown when a source is selected */}
      <fieldset className="space-y-2 rounded-md border border-border bg-background/40 p-3">
        <legend className="px-1 text-sm font-medium">
          {matcherHint && selectedSourceId ? m.ef_matcher_all_candidates() : m.activities_form_ef()}
        </legend>
        {!selectedSourceId ? (
          <p className="text-xs text-muted-foreground">{m.activities_form_ef_pick_source_first()}</p>
        ) : listQuery.isPending ? (
          <p className="text-xs text-muted-foreground">{m.activities_form_ef_loading()}</p>
        ) : efRows.length === 0 ? (
          <p className="text-xs text-muted-foreground">{m.activities_form_ef_none()}</p>
        ) : (
          <div className="space-y-1">
            {efRows.map((ef) => (
              <EfRow
                key={`${ef.factor_code}-${ef.year}-${ef.source}-${ef.geography}-${ef.dataset_version}`}
                ef={ef}
                selected={efPkEqual(pkOf(ef), currentEfPk)}
                onClick={() => onChange(pkOf(ef), ef)}
              />
            ))}
          </div>
        )}
      </fieldset>
    </div>
  );
}

function EfRow({
  ef,
  selected,
  onClick,
}: { ef: EmissionFactor; selected: boolean; onClick: () => void }) {
  return (
    <label className="flex items-start gap-2 text-sm cursor-pointer rounded px-1 py-1 hover:bg-muted/40">
      <input
        type="radio"
        name="ef"
        className="mt-1"
        checked={selected}
        onChange={onClick}
      />
      <span className="flex-1">
        <span className="font-medium">
          {ef.name_zh ?? ef.name_en ?? ef.factor_code}
        </span>
        <span className="text-muted-foreground">
          {' '}
          · {ef.geography} · {ef.year} · {ef.co2e_kg_per_unit} kg CO2e/{ef.input_unit}
        </span>
      </span>
    </label>
  );
}
