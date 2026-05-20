import { useState } from 'react';
import type { AuditEvent } from '@shared/types';
import * as m from '@renderer/paraglide/messages';

export function RawJsonCard({ event }: { event: AuditEvent }) {
  const [showRaw, setShowRaw] = useState(true);
  let pretty: string;
  try {
    pretty = JSON.stringify(JSON.parse(event.payload), null, 2);
  } catch {
    pretty = event.payload;
  }
  return (
    <div className="audit-raw-card">
      <button type="button" onClick={() => setShowRaw((v) => !v)} className="text-xs underline">
        {showRaw ? m.audit_hide_raw() : m.audit_show_raw()}
      </button>
      {showRaw && (
        <pre className="text-xs bg-muted p-2 rounded mt-1 overflow-auto">{pretty}</pre>
      )}
    </div>
  );
}
