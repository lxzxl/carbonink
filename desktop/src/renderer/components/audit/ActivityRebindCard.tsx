import { efApi } from '@renderer/lib/api/ef-library';
import { formatCo2e, formatSignedInteger, formatSignedPercent } from '@renderer/lib/format';
import * as m from '@renderer/paraglide/messages';
import type { ActivityRebindEfPayload, AuditEvent, EfCompositePk } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';

/**
 * Resolve an EF composite-PK to its `name_zh` (or factor_code on miss).
 * Round 4: the audit card used to render the raw factor_code
 * (`electricity.grid.cn.national.2024`) — DB-internal language that
 * had no meaning to end users. Now: "全国电网均值 (2024)".
 *
 * One query per EF; cached forever because the EF library is immutable
 * after ingestion. Two queries per ActivityRebindCard (old + new) is fine.
 */
function useEfName(pk: EfCompositePk): string {
  const q = useQuery({
    queryKey: ['ef:get-by-pk', pk],
    queryFn: () => efApi.getByPk(pk),
    staleTime: Infinity,
  });
  if (!q.data) return pk.factor_code;
  const name = q.data.name_zh ?? q.data.name_en ?? pk.factor_code;
  return `${name} (${pk.year})`;
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
  const pct = payload.old_computed_co2e_kg === 0 ? 0 : (delta / payload.old_computed_co2e_kg) * 100;
  const activityIdShort = payload.activity_id.slice(0, 8);
  const oldEfName = useEfName(payload.old_ef);
  const newEfName = useEfName(payload.new_ef);

  return (
    <div className="audit-rebind-card space-y-2">
      <div className="text-sm">
        {/* Activity id is now a link to the activities page (no /$id route
         * yet — drops user near the row, they'll find it by the short id
         * still rendered as text). */}
        <span>{m.audit_rebind_activity_label()}: </span>
        <Link
          to="/activities"
          className="font-mono text-primary hover:underline"
          title={payload.activity_id}
        >
          #{activityIdShort}
        </Link>
      </div>
      {/* EF transition rendered as humanized names + an arrow, not as
       * factor_code → factor_code. The factor_code is still available on
       * hover (title) for users who need the DB-level reference. */}
      <div className="text-sm text-muted-foreground">
        <span className="font-medium text-foreground" title={payload.old_ef.factor_code}>
          {oldEfName}
        </span>
        <span className="mx-1.5" aria-hidden>
          →
        </span>
        <span className="font-medium text-foreground" title={payload.new_ef.factor_code}>
          {newEfName}
        </span>
      </div>
      <div className="text-sm text-muted-foreground">
        {m.audit_rebind_delta({
          old_co2e: formatCo2e(payload.old_computed_co2e_kg),
          new_co2e: formatCo2e(payload.new_computed_co2e_kg),
          delta_signed: formatSignedInteger(delta),
          pct_signed: formatSignedPercent(pct),
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
