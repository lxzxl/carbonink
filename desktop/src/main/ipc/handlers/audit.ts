import { writeFileSync } from 'node:fs';
import type { AuditEventListInput } from '@main/services/audit-event-service.js';
import { dialog } from 'electron';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const listInput = z.object({
  event_kinds: z.array(z.string().min(1)).optional(),
  since: z.string().optional(),
  until: z.string().optional(),
  limit: z.number().int().positive().optional(),
});

/**
 * Audit-event read-only handler. The table is append-only via DB trigger;
 * producers write directly from their own services (e.g.
 * ActivityDataService.rebindEf writes `event_kind = 'activity_rebind_ef'`).
 * This handler exposes a query path with optional filters and a CSV
 * export path that reuses the same filter shape.
 */
export function auditHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'audit:list': (input) => {
      const parsed = listInput.parse(input);
      const listParams = toListParams(parsed);
      return ctx.auditEventService.list(listParams);
    },
    'audit:export-csv': async (input) => {
      const parsed = listInput.parse(input);
      const today = new Date().toISOString().slice(0, 10);
      const dialogResult = await dialog.showSaveDialog({
        title: 'Export audit log',
        defaultPath: `carbonink-audit-${today}.csv`,
        filters: [{ name: 'CSV', extensions: ['csv'] }],
      });
      if (dialogResult.canceled || !dialogResult.filePath) {
        return { canceled: true };
      }
      try {
        const events = ctx.auditEventService.list(toListParams(parsed));
        // RFC 4180: comma-separated, double-quote text fields containing
        // quotes/commas/newlines, escape inner quotes by doubling them.
        // Header row first; UTF-8 BOM so Excel autoselects encoding on
        // double-click instead of guessing GBK and mangling Chinese
        // event names.
        const header = ['id', 'event_kind', 'occurred_at', 'payload'].join(',');
        const rows = events.map((e) =>
          [
            csvField(e.id),
            csvField(e.event_kind),
            csvField(e.occurred_at),
            csvField(e.payload),
          ].join(','),
        );
        const body = `﻿${header}\n${rows.join('\n')}\n`;
        writeFileSync(dialogResult.filePath, body, 'utf8');
        return { ok: true, path: dialogResult.filePath, rows_written: events.length };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false, error: msg };
      }
    },
  };
}

function toListParams(parsed: z.infer<typeof listInput>): AuditEventListInput {
  const listParams: AuditEventListInput = {};
  if (parsed.event_kinds !== undefined) listParams.event_kinds = parsed.event_kinds;
  if (parsed.since !== undefined) listParams.since = parsed.since;
  if (parsed.until !== undefined) listParams.until = parsed.until;
  if (parsed.limit !== undefined) listParams.limit = parsed.limit;
  return listParams;
}

/**
 * CSV field escape per RFC 4180. Always wraps in double quotes for
 * predictable parsing in Excel/Numbers; doubles inner quotes; leaves
 * commas + newlines safely inside the quoted span.
 */
function csvField(value: string): string {
  const escaped = value.replace(/"/g, '""');
  return `"${escaped}"`;
}
