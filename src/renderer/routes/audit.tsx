import { ListItem } from '@renderer/components/app-shell/ListItem';
import { AuditEventCard } from '@renderer/components/audit/AuditEventCard';
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@renderer/components/ui/resizable';
import { auditApi } from '@renderer/lib/api/audit';
import * as m from '@renderer/paraglide/messages';
import type { AuditEvent } from '@shared/types';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { FileSearch } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

export const Route = createFileRoute('/audit')({ component: AuditPage });

function defaultSinceIso(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return d.toISOString();
}

const KNOWN_EVENT_KINDS = ['activity_rebind_ef'] as const;
type KnownEventKind = (typeof KNOWN_EVENT_KINDS)[number];

function eventKindLabel(kind: KnownEventKind): string {
  switch (kind) {
    case 'activity_rebind_ef':
      return m.audit_event_kind_activity_rebind_ef();
  }
}

function eventKindShortLabel(kind: string): string {
  if (kind === 'activity_rebind_ef') return m.audit_event_kind_activity_rebind_ef();
  return kind;
}

function formatTime(iso: string): string {
  try {
    return new Intl.DateTimeFormat(undefined, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * /audit — two-pane (Round 3 redesign).
 *
 *   ┌──────────────────────┬─────────────────────────────────┐
 *   │   Filter section     │   Selected event detail         │
 *   │   - kind chips       │     (AuditEventCard full body)  │
 *   │   - date range       │                                 │
 *   │   - event list rows  │                                 │
 *   └──────────────────────┴─────────────────────────────────┘
 *
 * Selection is local state (no `audit/$id` route) — audit events rarely
 * need to be deep-linkable, and a routed approach would add a 4th
 * "must update routeTree" file for marginal benefit.
 */
export function AuditPage() {
  const [selectedKinds, setSelectedKinds] = useState<string[]>([]);
  const [since, setSince] = useState<string>(defaultSinceIso().slice(0, 10));
  const [until, setUntil] = useState<string>(new Date().toISOString().slice(0, 10));
  const [limit, setLimit] = useState<number>(500);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);

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

  const events = useMemo(() => eventsQuery.data ?? [], [eventsQuery.data]);
  const canLoadOlder = events.length >= limit;
  const selectedEvent = useMemo(
    () => events.find((e) => e.id === selectedEventId) ?? null,
    [events, selectedEventId],
  );

  // Auto-select the first event whenever the list refreshes and the
  // current selection is no longer in it (e.g. filter changed). Saves a
  // click — most of the time the user wants to see the freshest event
  // anyway.
  useEffect(() => {
    if (events.length === 0) {
      setSelectedEventId(null);
      return;
    }
    if (!selectedEventId || !events.find((e) => e.id === selectedEventId)) {
      setSelectedEventId(events[0]?.id ?? null);
    }
  }, [events, selectedEventId]);

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
    <ResizablePanelGroup orientation="horizontal" className="h-full">
      {/* v4 breaking: sizes are strings with "%" suffix (numbers = px). */}
      <ResizablePanel
        defaultSize="36%"
        minSize="26%"
        maxSize="55%"
        className="border-r border-border/60"
      >
        <div className="flex h-full flex-col">
          <header className="sticky top-0 z-10 border-b border-border/60 bg-background/85 px-4 py-3 backdrop-blur-sm">
            <h1 className="text-sm font-semibold">{m.audit_heading()}</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{m.audit_subheading()}</p>
          </header>

          {/* Round 4 #14: filter section rebuilt with breathing room.
           * - Event-kind chips on row 1 (each is a clickable pill).
           * - Date range on row 2 with proper spacing.
           * - Reset on row 3 right-aligned (was cramped on row 2).
           * Pill toggle replaces the bare checkbox — easier to tap. */}
          <section className="space-y-3 border-b border-border/40 px-4 py-3 text-xs">
            <div>
              <div className="mb-1.5 font-medium">{m.audit_filter_event_kind_label()}</div>
              <div className="flex flex-wrap gap-1.5">
                {KNOWN_EVENT_KINDS.map((kind) => {
                  const active = selectedKinds.includes(kind);
                  return (
                    <button
                      key={kind}
                      type="button"
                      onClick={() => toggleKind(kind)}
                      className={
                        active
                          ? 'rounded-full border border-primary/40 bg-primary/15 px-2.5 py-0.5 text-primary'
                          : 'rounded-full border border-border bg-background px-2.5 py-0.5 text-foreground hover:bg-foreground/5'
                      }
                    >
                      {eventKindLabel(kind)}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-1">
                <span className="font-medium">{m.audit_filter_since_label()}</span>
                <input
                  type="date"
                  value={since}
                  onChange={(e) => setSince(e.target.value)}
                  className="h-7 rounded border border-border bg-background px-1.5"
                />
              </label>
              <label className="flex flex-col gap-1">
                <span className="font-medium">{m.audit_filter_until_label()}</span>
                <input
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  className="h-7 rounded border border-border bg-background px-1.5"
                />
              </label>
            </div>
            <div className="flex justify-end">
              <button
                type="button"
                onClick={reset}
                className="text-muted-foreground hover:text-foreground hover:underline"
              >
                {m.audit_filter_reset_button()}
              </button>
            </div>
          </section>

          <div className="flex-1 overflow-y-auto">
            {eventsQuery.isPending && (
              <p className="px-4 py-3 text-sm text-muted-foreground">{m.loading()}</p>
            )}
            {!eventsQuery.isPending && events.length === 0 && (
              <div className="py-12 text-center">
                <h2 className="text-sm font-medium">{m.audit_empty_state_heading()}</h2>
                <p className="mt-2 px-4 text-xs text-muted-foreground">
                  {m.audit_empty_state_body()}
                </p>
              </div>
            )}
            <ul className="py-1">
              {events.map((ev) => (
                <AuditListItem
                  key={ev.id}
                  event={ev}
                  isSelected={ev.id === selectedEventId}
                  onSelect={() => setSelectedEventId(ev.id)}
                />
              ))}
            </ul>
            {canLoadOlder && (
              <div className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => setLimit((l) => l + 500)}
                  className="w-full rounded border border-border px-3 py-2 text-sm hover:bg-foreground/5"
                >
                  {m.audit_load_older_button()}
                </button>
              </div>
            )}
          </div>
        </div>
      </ResizablePanel>

      <ResizableHandle />

      <ResizablePanel defaultSize="64%">
        <div className="h-full overflow-auto p-6">
          {selectedEvent ? (
            <AuditEventCard event={selectedEvent} />
          ) : (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <FileSearch
                className="size-12 text-muted-foreground/50"
                strokeWidth={1.5}
                aria-hidden="true"
              />
              <p className="mt-3 text-sm text-muted-foreground">{m.audit_empty_state_heading()}</p>
            </div>
          )}
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  );
}

function AuditListItem({
  event,
  isSelected,
  onSelect,
}: {
  event: AuditEvent;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <ListItem
      onClick={onSelect}
      isSelected={isSelected}
      title={eventKindShortLabel(event.event_kind)}
      meta={<span>{formatTime(event.occurred_at)}</span>}
    />
  );
}
