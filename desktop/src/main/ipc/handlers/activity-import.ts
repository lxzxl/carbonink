import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { EfImportParseError } from '@main/services/ef-import/parser.js';
import { ACTIVITY_IMPORT_FIELDS, type ActivityImportMapping } from '@shared/types.js';
import { dialog } from 'electron';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

type HandlerMap = { [K in keyof IpcTypeMap]?: IpcTypeMap[K] };

/** Same wire discipline as the EF-library mapping: unknown field keys drop. */
const mappingInput = z.record(z.string(), z.number().int().min(0));

function toMapping(raw: Record<string, number>): ActivityImportMapping {
  const mapping: ActivityImportMapping = {};
  for (const field of ACTIVITY_IMPORT_FIELDS) {
    const col = raw[field];
    if (col !== undefined) mapping[field] = col;
  }
  return mapping;
}

const tokenInput = z.object({ token: z.string().min(1) });

const revalidateInput = z.object({
  token: z.string().min(1),
  mapping: mappingInput,
  period_id: z.string().min(1),
});

const configureInput = z.object({
  token: z.string().min(1),
  mapping: mappingInput,
  period_id: z.string().min(1),
  organization_id: z.string().min(1),
});
const listSourcesInput = z.object({
  token: z.string().min(1),
  organization_id: z.string().min(1),
});

const resolveSourceInput = z.object({
  token: z.string().min(1),
  name: z.string().min(1),
  source_id: z.string().min(1).nullable(),
});

const efChoiceInput = z.object({
  factor_code: z.string().min(1),
  year: z.number().int(),
  source: z.string().min(1),
  geography: z.string().min(1),
  dataset_version: z.string().min(1),
});

const confirmGroupInput = z.object({
  token: z.string().min(1),
  group_key: z.string().min(1),
  ef: efChoiceInput,
  fuel_code: z.string().min(1).max(100).nullable(),
});

const skipGroupInput = z.object({
  token: z.string().min(1),
  group_key: z.string().min(1),
});

const decideInput = z.object({
  token: z.string().min(1),
  decisions: z
    .array(
      z.object({
        group_key: z.string().min(1),
        action: z.union([z.literal('confirm'), z.literal('skip')]),
        ef: efChoiceInput.optional(),
        fuel_code: z.string().min(1).max(100).nullable().optional(),
      }),
    )
    .max(10000),
});

/**
 * Batch activity-import IPC (ROADMAP §8.1-①). The native open dialog lives
 * here — same boundary split as user-ef-library: dialogs + file IO at the
 * boundary, staging/validation/import logic in ActivityImportService.
 */
export function activityImportHandlers(ctx: IpcContext): HandlerMap {
  return {
    'activity-import:pick-file': async () => {
      const result = await dialog.showOpenDialog({
        title: 'Import activity data',
        properties: ['openFile'],
        filters: [{ name: 'Spreadsheets', extensions: ['xlsx', 'csv'] }],
      });
      const path = result.filePaths[0];
      if (result.canceled || path === undefined) {
        return { canceled: true as const };
      }
      let bytes: Buffer;
      try {
        bytes = await readFile(path);
      } catch {
        return {
          canceled: false as const,
          error: { _tag: 'EfImportParseFailed' as const, code: 'file_read_failed' as const },
        };
      }
      try {
        const preview = await ctx.activityImportService.stageImport(bytes, basename(path));
        return { canceled: false as const, preview };
      } catch (err) {
        if (err instanceof EfImportParseError) {
          return {
            canceled: false as const,
            error: {
              _tag: 'EfImportParseFailed' as const,
              code: err.code,
              ...(err.detail !== undefined ? { detail: err.detail } : {}),
            },
          };
        }
        throw err;
      }
    },

    'activity-import:revalidate': (input) => {
      const parsed = revalidateInput.parse(input);
      return ctx.activityImportService.revalidate(
        parsed.token,
        toMapping(parsed.mapping),
        parsed.period_id,
      );
    },

    'activity-import:configure': (input) => {
      const parsed = configureInput.parse(input);
      return ctx.activityImportService.configure(
        parsed.token,
        toMapping(parsed.mapping),
        parsed.period_id,
        parsed.organization_id,
      );
    },

    'activity-import:list-sources': (input) => {
      const parsed = listSourcesInput.parse(input);
      return ctx.activityImportService.listSources(parsed.token, parsed.organization_id);
    },

    'activity-import:resolve-source': (input) => {
      const parsed = resolveSourceInput.parse(input);
      return {
        ok: ctx.activityImportService.resolveSource(parsed.token, parsed.name, parsed.source_id),
      };
    },

    'activity-import:list-groups': (input) =>
      ctx.activityImportService.listGroups(tokenInput.parse(input).token),

    'activity-import:decide': (input) => {
      const parsed = decideInput.parse(input);
      return ctx.activityImportService.decide(
        parsed.token,
        parsed.decisions.map((d) => ({
          group_key: d.group_key,
          action: d.action,
          ...(d.ef !== undefined ? { ef: d.ef } : {}),
          ...(d.fuel_code !== undefined ? { fuel_code: d.fuel_code } : {}),
        })),
      );
    },

    'activity-import:confirm-group': (input) => {
      const parsed = confirmGroupInput.parse(input);
      return ctx.activityImportService.confirmGroup(
        parsed.token,
        parsed.group_key,
        parsed.ef,
        parsed.fuel_code,
      );
    },

    'activity-import:skip-group': (input) => {
      const parsed = skipGroupInput.parse(input);
      return { ok: ctx.activityImportService.skipGroup(parsed.token, parsed.group_key) };
    },

    'activity-import:import': (input) =>
      ctx.activityImportService.import(tokenInput.parse(input).token),

    'activity-import:discard': (input) => {
      ctx.activityImportService.discardPending(tokenInput.parse(input).token);
      return { ok: true as const };
    },
  };
}
