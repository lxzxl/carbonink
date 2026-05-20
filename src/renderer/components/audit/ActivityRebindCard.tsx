import { useState } from 'react';
import type { ActivityRebindEfPayload, AuditEvent } from '@shared/types';
import * as m from '@renderer/paraglide/messages';

function formatNumber(n: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(n);
}

function signed(n: number, digits = 0): string {
  const fixed = n.toFixed(digits);
  return n >= 0 ? `+${fixed}` : fixed;
}

export function ActivityRebindCard({ event }: { event: AuditEvent }) {
  const [showRaw, setShowRaw] = useState(false);
  let payload: ActivityRebindEfPayload | null = null;
  let parseError = false;
  try {
    payload = JSON.parse(event.payload) as ActivityRebindEfPayload;
  } catch {
    parseError = true;
  }
  if (parseError || !payload) {
    return <div className="text-sm text-destructive">{m.audit_malformed_payload()}</div>;
  }

  const delta = payload.new_computed_co2e_kg - payload.old_computed_co2e_kg;
  const pct =
    payload.old_computed_co2e_kg === 0
      ? 0
      : (delta / payload.old_computed_co2e_kg) * 100;
  const activityIdShort = payload.activity_id.slice(0, 8);

  return (
    <div className="audit-rebind-card">
      <div className="text-sm">
        {m.audit_rebind_summary({
          activity_id_short: activityIdShort,
          old_ef: payload.old_ef.factor_code,
          new_ef: payload.new_ef.factor_code,
        })}
      </div>
      <div className="text-sm text-muted-foreground mt-1">
        {m.audit_rebind_delta({
          old_co2e: formatNumber(payload.old_computed_co2e_kg),
          new_co2e: formatNumber(payload.new_computed_co2e_kg),
          delta_signed: signed(delta),
          pct_signed: signed(pct, 1),
        })}
      </div>
      <button
        type="button"
        onClick={() => setShowRaw((v) => !v)}
        className="text-xs underline mt-2"
      >
        {showRaw ? m.audit_hide_raw() : m.audit_show_raw()}
      </button>
      {showRaw && (
        <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-auto">
          {JSON.stringify(payload, null, 2)}
        </pre>
      )}
    </div>
  );
}
