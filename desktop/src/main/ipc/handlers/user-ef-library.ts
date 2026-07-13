import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { EfImportParseError } from '@main/services/ef-import/parser.js';
import { EF_IMPORT_FIELDS, type EfImportMapping } from '@shared/types.js';
import { dialog } from 'electron';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

type HandlerMap = { [K in keyof IpcTypeMap]?: IpcTypeMap[K] };

/**
 * Raw mapping off the wire: header-column index per field name. Unknown
 * field keys are dropped (renderer is typed; a stale client just loses the
 * stray key), known ones must be non-negative integers.
 */
const mappingInput = z.record(z.string(), z.number().int().min(0));

function toMapping(raw: Record<string, number>): EfImportMapping {
  const mapping: EfImportMapping = {};
  for (const field of EF_IMPORT_FIELDS) {
    const col = raw[field];
    if (col !== undefined) mapping[field] = col;
  }
  return mapping;
}

const tokenInput = z.object({ token: z.string().min(1) });

const revalidateInput = z.object({
  token: z.string().min(1),
  mapping: mappingInput,
});

/**
 * Boundary-loose on name/version — UserEfLibraryService owns the real
 * rules (trim, length, control chars) and reports them as tagged results
 * the renderer can translate, instead of sanitized handler throws.
 */
const importInput = z.object({
  token: z.string().min(1),
  name: z.string().max(200),
  version: z.string().max(100),
  allow_replace: z.boolean(),
  mapping: mappingInput,
});

const idInput = z.object({ id: z.string().min(1) });

/**
 * User EF library IPC (ROADMAP §8.1-④). The native open/save dialogs live
 * here — same split as handlers/data.ts: dialogs + file IO at the boundary,
 * parsing/import logic in UserEfLibraryService.
 */
export function userEfLibraryHandlers(ctx: IpcContext): HandlerMap {
  return {
    'ef-library:pick-file': async () => {
      const result = await dialog.showOpenDialog({
        title: 'Import EF library',
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
        const preview = await ctx.userEfLibraryService.stageImport(bytes, basename(path));
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

    'ef-library:revalidate': (input) => {
      const parsed = revalidateInput.parse(input);
      return ctx.userEfLibraryService.revalidate(parsed.token, toMapping(parsed.mapping));
    },

    'ef-library:import': (input) => {
      const parsed = importInput.parse(input);
      return ctx.userEfLibraryService.import({
        token: parsed.token,
        name: parsed.name,
        version: parsed.version,
        mapping: toMapping(parsed.mapping),
        allow_replace: parsed.allow_replace,
      });
    },

    'ef-library:discard': (input) => {
      ctx.userEfLibraryService.discardPending(tokenInput.parse(input).token);
      return { ok: true as const };
    },

    'ef-library:list': () => ctx.userEfLibraryService.list(),

    'ef-library:delete': (input) => ctx.userEfLibraryService.delete(idInput.parse(input).id),

    'ef-library:save-template': async () => {
      const result = await dialog.showSaveDialog({
        title: 'Save EF import template',
        defaultPath: 'carbonink-ef-template.xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) {
        return { canceled: true as const };
      }
      try {
        const buffer = await ctx.userEfLibraryService.buildTemplateXlsx();
        await writeFile(result.filePath, buffer);
        return { ok: true as const, path: result.filePath };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { ok: false as const, error: msg };
      }
    },
  };
}
