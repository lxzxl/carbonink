import { AuditEventCard } from '@renderer/components/audit/AuditEventCard';
import { auditApi } from '@renderer/lib/api/audit';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useMemo, useState } from 'react';

export const Route = createFileRoute('/audit')({ component: AuditPage });

function defaultSinceIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString();
}

const KNOWN_EVENT_KINDS = ['activity_rebind_ef'];

export function AuditPage() {
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [since, setSince] = useState<string>(defaultSinceIso().slice(0, 10)); // YYYY-MM-DD
  const [until, setUntil] = useState<string>(new Date().toISOString().slice(0, 10));
  const [limit, setLimit] = useState<number>(500);

  const queryInput = useMemo(() => {
    const input: {
      event_kinds?: string[];
      since?: string;
      until?: string;
      limit?: number;
    } = { limit };
    if (selectedKinds.length > 0) input.event_kinds = selectedKinds;
    if (since) input.since = `${since}T00:00:00Z`;
    if (until) input.until = `${until}T23:59:59Z`;
    return input;
  }, [selectedKinds, since, until, limit]);

  const eventsQuery = useQuery({
    queryKey: ['audit:list', queryInput],
    queryFn: () => auditApi.list(queryInput),
  });

  const events = eventsQuery.data ?? [];
  const canLoadOlder = events.length >= limit;

  const toggleKind = (kind: string) => {
    setSelectedKinds((prev) =>
      prev.includes(kind) ? prev.filter((k) => k !== kind) : [...prev, kind],
    );
  };

  const reset = () => {
    setSelectedKinds([]);
    setSince(defaultSinceIso().slice(0, 10));
    setUntil(new Date().toISOString().slice(0, 10));
    setLimit(500);
  };

  return (
    <div className="container mx-auto py-8 px-4 max-w-3xl">
      <h1 className="text-2xl font-semibold mb-1">{m.audit_heading()}</h1>
      <p className="text-sm text-muted-foreground mb-6">{m.audit_subheading()}</p>

      <section className="border rounded p-3 mb-4 space-y-2">
        <div>
          <label className="text-sm font-medium">{m.audit_filter_event_kind_label()}: </label>
          {KNOWN_EVENT_KINDS.map((kind) => (
            <label key={kind} className="inline-flex items-center gap-1 ml-3 text-sm">
              <input
                type="checkbox"
                checked={selectedKinds.includes(kind)}
                onChange={() => toggleKind(kind)}
              />
              {kind}
            </label>
          ))}
        </div>
        <div className="flex gap-3 items-center text-sm">
          <label className="flex items-center gap-1">
            {m.audit_filter_since_label()}:
            <input
              type="date"
              value={since}
              onChange={(e) => setSince(e.target.value)}
              className="border rounded px-1"
            />
          </label>
          <label className="flex items-center gap-1">
            {m.audit_filter_until_label()}:
            <input
              type="date"
              value={until}
              onChange={(e) => setUntil(e.target.value)}
              className="border rounded px-1"
            />
          </label>
          <button type="button" onClick={reset} className="text-sm underline ml-auto">
            {m.audit_filter_reset_button()}
          </button>
        </div>
      </section>

      {eventsQuery.isPending && <p>Loading…</p>}

      {!eventsQuery.isPending && events.length === 0 && (
        <div className="text-center py-12">
          <h2 className="text-base font-medium">{m.audit_empty_state_heading()}</h2>
          <p className="text-sm text-muted-foreground mt-2">{m.audit_empty_state_body()}</p>
        </div>
      )}

      {events.map((ev) => (
        <AuditEventCard key={ev.id} event={ev} />
      ))}

      {canLoadOlder && (
        <button
          type="button"
          onClick={() => setLimit((l) => l + 500)}
          className="mt-4 rounded border px-3 py-2 text-sm"
        >
          {m.audit_load_older_button()}
        </button>
      )}
    </div>
  );
}
