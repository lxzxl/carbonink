import { readFile, writeFile } from 'node:fs/promises';
import { dialog } from 'electron';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const createDraftInput = z.object({
  supplier_id: z.string().min(1),
  reporting_period_id: z.string().min(1),
  template_kind: z.literal('cat1_supplier_disclosure'),
  included_question_positions: z.array(z.string()).min(1),
});

const exportInput = z.object({ questionnaire_id: z.string().min(1) });
const importInput = z.object({ questionnaire_id: z.string().min(1) });
const ingestInput = z.object({
  questionnaire_id: z.string().min(1),
  accepted_question_ids: z.array(z.string()),
  tier1_purchased_quantity: z.number().optional(),
  tier_override: z.union([z.literal(1), z.literal(2)]).optional(),
});

/**
 * IPC handlers for the inbound questionnaire flow (Phase 2.3 / v2.0).
 *
 * Three of the four channels wrap dialog interactions — `export-xlsx`
 * pops a save dialog, `import-preview` pops an open dialog — so the
 * renderer doesn't have to round-trip file paths through itself.
 * `create-draft` and `ingest` are pure service calls.
 */
export function inboundQuestionnaireHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'questionnaire:inbound-create-draft': async (input) => {
      const parsed = createDraftInput.parse(input);
      return ctx.inboundQuestionnaireService.createDraft(parsed);
    },

    'questionnaire:inbound-export-xlsx': async (input) => {
      const parsed = exportInput.parse(input);

      // Build the buffer first so a failed render aborts before the user
      // sees a save dialog. Then prompt for path. Then write.
      const buf = await ctx.inboundQuestionnaireService.exportBlankXlsx(parsed.questionnaire_id);

      const result = await dialog.showSaveDialog({
        title: 'Export inbound questionnaire',
        defaultPath: `inbound-${parsed.questionnaire_id}.xlsx`,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (result.canceled || !result.filePath) {
        return { canceled: true as const };
      }
      await writeFile(result.filePath, buf);
      return {
        canceled: false as const,
        path: result.filePath,
        bytes_written: buf.length,
      };
    },

    'questionnaire:inbound-import-preview': async (input) => {
      const parsed = importInput.parse(input);

      const openResult = await dialog.showOpenDialog({
        title: 'Import filled supplier xlsx',
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
        properties: ['openFile'],
      });
      if (openResult.canceled || openResult.filePaths.length === 0) {
        return { canceled: true as const };
      }
      const filePath = openResult.filePaths[0];
      if (!filePath) {
        return { canceled: true as const };
      }
      const bytes = await readFile(filePath);
      try {
        const preview = await ctx.inboundQuestionnaireService.importFilledXlsx(
          parsed.questionnaire_id,
          bytes,
        );
        return { canceled: false as const, preview };
      } catch (e) {
        // Parser-side typed errors carry a friendly Chinese-or-English message
        // already. Surface them on the discriminated result so the renderer
        // can show a toast without catching exceptions across the IPC line.
        const message = e instanceof Error ? e.message : String(e);
        const tag = (e as { _tag?: string } | null)?._tag ?? 'InboundImportFailed';
        return {
          canceled: false as const,
          error: { _tag: tag, message },
        };
      }
    },

    'questionnaire:inbound-get-preview': async (input) => {
      const parsed = importInput.parse(input);
      // Service method is synchronous (no file I/O), but we await
      // through the same Promise-shaped IPC surface for uniformity.
      return ctx.inboundQuestionnaireService.getIngestPreview(parsed.questionnaire_id);
    },

    'questionnaire:inbound-ingest': async (input) => {
      const parsed = ingestInput.parse(input);
      // Service's ingest is synchronous — wrap so the IPC signature is
      // uniformly Promise-typed.
      return ctx.inboundQuestionnaireService.ingest({
        questionnaire_id: parsed.questionnaire_id,
        accepted_question_ids: parsed.accepted_question_ids,
        ...(parsed.tier1_purchased_quantity !== undefined
          ? { tier1_purchased_quantity: parsed.tier1_purchased_quantity }
          : {}),
        ...(parsed.tier_override !== undefined ? { tier_override: parsed.tier_override } : {}),
      });
    },
  };
}
