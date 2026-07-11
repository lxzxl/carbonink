import type { EvidenceTargetRef } from '@shared/types.js';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

/**
 * Exactly one of the two id keys — mirrors the DB CHECK on
 * evidence_attachment (migration 018) so bad refs die at the boundary
 * with a legible message instead of a constraint error.
 */
const targetInput = z
  .object({
    activity_data_id: z.string().min(1).optional(),
    answer_id: z.string().min(1).optional(),
  })
  .refine((v) => (v.activity_data_id ? 1 : 0) + (v.answer_id ? 1 : 0) === 1, {
    message: 'exactly one of activity_data_id / answer_id is required',
  });

const addMetaInput = z
  .object({
    filename: z.string().min(1),
    mimeType: z.string().min(1),
    note: z.string().max(2000).optional(),
  })
  .and(targetInput);

const idInput = z.object({ id: z.string().min(1) });

function toTarget(parsed: {
  activity_data_id?: string | undefined;
  answer_id?: string | undefined;
}): EvidenceTargetRef {
  return parsed.activity_data_id !== undefined
    ? { activity_data_id: parsed.activity_data_id }
    : // targetInput's refine guarantees answer_id is set on this branch.
      { answer_id: parsed.answer_id as string };
}

/**
 * Evidence-attachment handlers (audit-readiness 2026-07-11). `evidence:add`
 * treats `bytes` exactly like `document:upload` does: no zod on the
 * Uint8Array (fragile across V8 realms), one hand-rolled instanceof check,
 * zero-copy Buffer conversion.
 */
export function evidenceHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'evidence:add': (input) => {
      const meta = addMetaInput.parse({
        activity_data_id: input.activity_data_id,
        answer_id: input.answer_id,
        filename: input.filename,
        mimeType: input.mimeType,
        note: input.note,
      });
      if (!(input.bytes instanceof Uint8Array)) {
        throw new Error('evidence:add bytes must be a Uint8Array');
      }
      return ctx.evidenceService.add({
        target: toTarget(meta),
        file: {
          filename: meta.filename,
          mimeType: meta.mimeType,
          bytes: Buffer.from(input.bytes),
        },
        ...(meta.note !== undefined ? { note: meta.note } : {}),
      });
    },
    'evidence:list': (input) => ctx.evidenceService.list(toTarget(targetInput.parse(input))),
    'evidence:remove': (input) => ctx.evidenceService.remove(idInput.parse(input).id),
  };
}
