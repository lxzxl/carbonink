import * as m from '@renderer/paraglide/messages';
import type { AuditEvent } from '@shared/types';
import { ActivityRebindCard } from './ActivityRebindCard';
import { RawJsonCard } from './RawJsonCard';

function formatDate(iso: string): string {
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

function kindLabel(kind: string): string {
  switch (kind) {
    case 'activity_rebind_ef':
      return m.audit_event_kind_activity_rebind_ef();
    default:
      return m.audit_unknown_event_kind({ kind });
  }
}

const KIND_COLORS: Record<string, string> = {
  activity_rebind_ef: 'bg-blue-100 text-blue-800',
};

export function AuditEventCard({ event }: { event: AuditEvent }) {
  const chipClass = KIND_COLORS[event.event_kind] ?? 'bg-gray-100 text-gray-800';
  return (
    <article className="audit-card border rounded p-3 mb-2">
      <header className="flex items-center justify-between mb-2">
        <span className={`text-xs px-2 py-0.5 rounded ${chipClass}`}>
          {kindLabel(event.event_kind)}
        </span>
        <time className="text-xs text-muted-foreground">{formatDate(event.occurred_at)}</time>
      </header>
      {event.event_kind === 'activity_rebind_ef' ? (
        <ActivityRebindCard event={event} />
      ) : (
        <RawJsonCard event={event} />
      )}
    </article>
  );
}
