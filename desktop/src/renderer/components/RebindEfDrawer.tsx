import { activityApi } from '@renderer/lib/api/activity-data';
import * as m from '@renderer/paraglide/messages';
import type { EfCompositePk, EmissionFactor } from '@shared/types';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CSSProperties, ReactNode } from 'react';
import { useMemo, useState } from 'react';
import { Drawer } from 'vaul';
import { EfPicker } from './EfPicker';
import { toast } from './toast';

const NO_DRAG: CSSProperties = { WebkitAppRegion: 'no-drag' } as CSSProperties;

export interface RebindEfDrawerProps {
  activityId: string;
  open: boolean;
  onClose: () => void;
}

const VOLUME = new Set(['L', 'mL', 'm3']);
const MASS = new Set(['kg', 't', 'g']);
const ENERGY = new Set(['kWh', 'MJ', 'GJ']);

function unitFamily(unit: string): 'volume' | 'mass' | 'energy' | null {
  if (VOLUME.has(unit)) return 'volume';
  if (MASS.has(unit)) return 'mass';
  if (ENERGY.has(unit)) return 'energy';
  return null;
}

function sameFamily(a: string, b: string): boolean {
  if (a === b) return true;
  const fa = unitFamily(a);
  const fb = unitFamily(b);
  if (!fa || !fb) return false;
  return fa === fb;
}

export function RebindEfDrawer({ activityId, open, onClose }: RebindEfDrawerProps) {
  const queryClient = useQueryClient();
  const activityQuery = useQuery({
    queryKey: ['activity:get-by-id', activityId],
    queryFn: () => activityApi.getById({ id: activityId }),
    enabled: open,
  });
  const [selectedEfPk, setSelectedEfPk] = useState<EfCompositePk | null>(null);
  // Hold the picked EF's full row so we can compute a preview without a roundtrip.
  const [pickedEfMeta, setPickedEfMeta] = useState<{
    input_unit: string;
    co2e_kg_per_unit: number;
  } | null>(null);
  // Cross-family override: amount the user types in the new unit. Kept as a
  // string so an empty input is distinguishable from "0" (which would
  // otherwise resolve to a falsy 0 and silently submit zero emissions).
  // Parsed to a number only at preview / submit time.
  const [overrideAmountText, setOverrideAmountText] = useState('');

  // Reset the override field whenever the picked EF changes — a different
  // candidate has a different unit, so the prior typed value no longer
  // makes physical sense.
  // biome-ignore lint/correctness/useExhaustiveDependencies: setOverrideAmountText identity is stable; we only want to reset on EF PK change.
  useMemo(() => {
    setOverrideAmountText('');
  }, [selectedEfPk]);

  const overrideAmountNum = useMemo(() => {
    const trimmed = overrideAmountText.trim();
    if (trimmed === '') return null;
    const n = Number(trimmed);
    return Number.isFinite(n) && n > 0 ? n : null;
  }, [overrideAmountText]);

  const preview = useMemo(() => {
    if (!activityQuery.data || !selectedEfPk || !pickedEfMeta) return null;
    const ad = activityQuery.data;
    const sameUnit = ad.unit === pickedEfMeta.input_unit;
    const crossFamily = !sameUnit && !sameFamily(ad.unit, pickedEfMeta.input_unit);
    if (crossFamily) {
      // If the user has typed a valid override amount, attach a numeric
      // preview so the new-co2e block can render alongside the input.
      const newCo2eKg =
        overrideAmountNum !== null ? overrideAmountNum * pickedEfMeta.co2e_kg_per_unit : null;
      return {
        crossFamily: true as const,
        fromUnit: ad.unit,
        toUnit: pickedEfMeta.input_unit,
        overrideAmount: overrideAmountNum,
        newCo2eKg,
        oldCo2eKg: ad.computed_co2e_kg,
      };
    }
    // Client-side optimistic preview. Server is authoritative; we just need a
    // plausible number for the UI. For same-family with conversion the server
    // applies the canonical conversion; here we approximate by trusting the
    // unit-family equivalence as-is (1:1 only when units match exactly).
    const newAmount = sameUnit ? ad.amount : null;
    const newCo2e = newAmount === null ? null : newAmount * pickedEfMeta.co2e_kg_per_unit;
    return {
      crossFamily: false as const,
      newAmount,
      newUnit: pickedEfMeta.input_unit,
      newCo2eKg: newCo2e,
      oldCo2eKg: ad.computed_co2e_kg,
    };
  }, [activityQuery.data, selectedEfPk, pickedEfMeta, overrideAmountNum]);

  const rebindMutation = useMutation({
    mutationFn: () =>
      activityApi.rebindEf({
        activity_id: activityId,
        new_ef_pk: selectedEfPk!,
        // Only pass override_amount when this is actually the cross-family path
        // *and* the user has supplied a valid positive number. Same-family
        // rebinds rely on the server's UnitConversionService.
        ...(preview?.crossFamily && overrideAmountNum !== null
          ? { override_amount: overrideAmountNum }
          : {}),
      }),
    onSuccess: (result) => {
      if (!result.ok) {
        toast.error(m.rebind_error_toast({ message: result.error.message }));
        return;
      }
      const pct =
        result.old_co2e_kg === 0
          ? 0
          : ((result.new_co2e_kg - result.old_co2e_kg) / result.old_co2e_kg) * 100;
      toast.success(
        m.rebind_success_toast({
          co2e: result.new_co2e_kg.toFixed(0),
          pct_signed: (pct >= 0 ? '+' : '') + pct.toFixed(1),
        }),
      );
      queryClient.invalidateQueries({ queryKey: ['activity:list-by-period'] });
      queryClient.invalidateQueries({ queryKey: ['activity:totals-by-period'] });
      onClose();
    },
    onError: (e) => toast.error(m.rebind_error_toast({ message: (e as Error).message })),
  });

  if (!open) return null;

  return (
    <Drawer.Root open={open} onOpenChange={(isOpen) => !isOpen && onClose()} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground/30" style={NO_DRAG} />
        <Drawer.Content
          aria-describedby={undefined}
          style={NO_DRAG}
          className="fixed right-0 top-0 bottom-0 z-50 flex w-[480px] flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Drawer.Title className="text-base font-semibold text-foreground">
              {m.rebind_drawer_heading()}
            </Drawer.Title>
            <button
              type="button"
              onClick={onClose}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="Close rebind drawer"
            >
              ✕
            </button>
          </div>

          <div className="flex-1 overflow-y-auto p-4">
            {activityQuery.isPending && <p>{m.ef_picker_loading()}</p>}
            {activityQuery.data && (
              <>
                <section className="mb-6 space-y-2 rounded border border-border bg-secondary/30 p-3">
                  <div className="text-sm font-semibold text-foreground">
                    {m.rebind_current_label()}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {activityQuery.data.amount} {activityQuery.data.unit}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    {activityQuery.data.pinned_ef.factor_code} @{' '}
                    {activityQuery.data.pinned_ef.source} {activityQuery.data.pinned_ef.year}
                  </div>
                  <div className="text-sm font-medium text-foreground">
                    {m.rebind_current_co2e()}: {activityQuery.data.computed_co2e_kg.toFixed(0)} kg
                    CO2e
                  </div>
                </section>

                <section className="mb-6 space-y-3">
                  <div className="text-sm font-semibold text-foreground">
                    Pick a new emission factor
                  </div>
                  <EfPicker
                    selectedSourceId={activityQuery.data.emission_source_id}
                    currentEfPk={{
                      factor_code: activityQuery.data.ef_factor_code,
                      year: activityQuery.data.ef_year,
                      source: activityQuery.data.ef_source,
                      geography: activityQuery.data.ef_geography,
                      dataset_version: activityQuery.data.ef_dataset_version,
                    }}
                    onChange={(pk, row) => {
                      setSelectedEfPk(pk);
                      setPickedEfMeta(
                        row
                          ? { input_unit: row.input_unit, co2e_kg_per_unit: row.co2e_kg_per_unit }
                          : null,
                      );
                    }}
                  />
                </section>

                {preview && preview.crossFamily && (
                  <div className="mb-6 space-y-3 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                    <p className="text-foreground">
                      {m.rebind_unit_cross_family({ from: preview.fromUnit, to: preview.toUnit })}
                    </p>
                    <div className="space-y-1">
                      <label
                        htmlFor="rebind-override-amount"
                        className="text-xs font-medium text-foreground"
                      >
                        {m.rebind_override_amount_label({ unit: preview.toUnit })}
                      </label>
                      <input
                        id="rebind-override-amount"
                        type="number"
                        min="0"
                        step="any"
                        inputMode="decimal"
                        value={overrideAmountText}
                        onChange={(e) => setOverrideAmountText(e.target.value)}
                        placeholder={m.rebind_override_amount_placeholder({ unit: preview.toUnit })}
                        className="w-full rounded border border-border bg-background px-2 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                    </div>
                    {preview.newCo2eKg != null && (
                      <div className="text-sm font-medium text-foreground">
                        {m.rebind_new_co2e()}: {preview.newCo2eKg.toFixed(0)} kg CO2e
                      </div>
                    )}
                  </div>
                )}

                {preview && !preview.crossFamily && preview.newCo2eKg != null && (
                  <section className="mb-6 space-y-2 rounded border border-border bg-secondary/30 p-3">
                    <div className="text-sm font-semibold text-foreground">
                      {m.rebind_preview_heading()}
                    </div>
                    {preview.newAmount != null &&
                      preview.newAmount !== activityQuery.data.amount && (
                        <div className="text-sm text-muted-foreground">
                          {m.rebind_unit_conversion({
                            from_amt: activityQuery.data.amount.toString(),
                            from_unit: activityQuery.data.unit,
                            to_amt: preview.newAmount.toFixed(2),
                            to_unit: preview.newUnit,
                          })}
                        </div>
                      )}
                    <div className="text-sm font-medium text-foreground">
                      {m.rebind_new_co2e()}: {preview.newCo2eKg.toFixed(0)} kg CO2e
                    </div>
                    <div className="text-sm text-muted-foreground">
                      {m.rebind_delta({
                        delta_signed:
                          (preview.newCo2eKg - preview.oldCo2eKg >= 0 ? '+' : '') +
                          (preview.newCo2eKg - preview.oldCo2eKg).toFixed(0),
                        pct_signed:
                          (preview.oldCo2eKg === 0
                            ? 0
                            : ((preview.newCo2eKg - preview.oldCo2eKg) / preview.oldCo2eKg) *
                              100) >= 0
                            ? '+'
                            : '' +
                              (preview.oldCo2eKg === 0
                                ? 0
                                : ((preview.newCo2eKg - preview.oldCo2eKg) / preview.oldCo2eKg) *
                                  100
                              ).toFixed(1),
                      })}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>

          <div className="flex gap-2 border-t border-border bg-popover px-4 py-3">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 rounded px-3 py-2 text-sm font-medium text-foreground hover:bg-accent"
            >
              {m.rebind_cancel()}
            </button>
            <button
              type="button"
              disabled={
                !selectedEfPk ||
                rebindMutation.isPending ||
                // Cross-family path requires a valid positive override amount.
                // Same-family path: no extra gating beyond the EF selection.
                (preview?.crossFamily === true && overrideAmountNum === null)
              }
              onClick={() => rebindMutation.mutate()}
              className="flex-1 rounded bg-primary px-3 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {m.rebind_confirm()}
            </button>
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
