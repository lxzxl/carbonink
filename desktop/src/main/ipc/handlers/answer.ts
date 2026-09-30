import * as fs from 'node:fs/promises';
import { type AnswerCell, writeAnswers } from '@main/excel/answer-writer.js';
import { aiErrToast } from '@main/llm/error-copy.js';
import * as answerSvc from '@main/services/answer-generation/index.js';
import { Cause, Effect, Either, Exit, Option } from 'effect';
import { dialog } from 'electron';
import { z } from 'zod';
import type { IpcContext } from '../context.js';
import type { IpcTypeMap } from '../types.js';

const generateInput = z.object({ question_id: z.string().min(1) });
const saveInput = z.object({
  question_id: z.string().min(1),
  value: z.string(),
  unit: z.string().nullable(),
  finalize: z.boolean(),
  // Omitted by the renderer (a human typing) and so defaulted to 'manual' in
  // the service; the agent bridge passes 'ai_suggested'.
  source_kind: z.union([z.literal('manual'), z.literal('ai_suggested')]).optional(),
});
const listInput = z.object({ questionnaire_id: z.string().min(1) });

export function answerHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'answer:generate': async (input) => {
      const parsed = generateInput.parse(input);
      // Guard against inbound questionnaires — their answers come from
      // the supplier, not from our LLM-driven agent loop. The wizard +
      // detail page should never wire this button up for inbound rows,
      // but defense in depth: refuse at the IPC boundary too.
      // Defensive optional-chain: existing test fixtures mock
      // questionnaireService with a narrow shape; production always has
      // the method (added in T9 of inbound questionnaire plan).
      const direction = ctx.questionnaireService.getQuestionDirection?.(parsed.question_id);
      if (direction === 'inbound') {
        throw new Error(
          '该题来自 inbound 供应商问卷，无法自动生成答案。请通过"导入回填表"流程获取答案。',
        );
      }
      const config = ctx.providerConfig;
      if (!config) {
        throw new Error('AI provider not configured. Open Settings to set up.');
      }
      const exit = await Effect.runPromiseExit(
        answerSvc.generate(parsed.question_id, config).pipe(Effect.provide(ctx.answerLayer)),
      );
      if (Exit.isSuccess(exit)) return exit.value;

      // Map typed errors to user-friendly messages before throwing across IPC.
      // Without this, Data.TaggedError instances reach the renderer with no
      // .message — the user gets an empty toast.
      const failure = Cause.failureOption(exit.cause);
      const err = Option.getOrNull(failure) as {
        _tag?: string;
        reason?: string;
        cause?: unknown;
        status?: number;
      } | null;
      switch (err?._tag) {
        case 'LLMNoData':
          throw new Error(
            err.reason ? `LLM 无法从库存数据推断答案：${err.reason}` : 'LLM 无可用数据推断答案。',
          );
        case 'InventoryEmpty':
          throw new Error('该年度暂无活动数据，无法推断答案。请先录入活动数据。');
        case 'QuestionAlreadyAnswered':
          throw new Error('该题已有答案。');
        // AiClient-shaped errors share one translation seam with the
        // other IPC handlers (`aiErrToast` in @main/llm/error-copy.ts) —
        // a new `AiErr` member fails typecheck there until it gets copy.
        // `AiCanceled` translates to null (user asked for it): silence.
        default: {
          const copy = aiErrToast(err);
          if (copy === null) throw new Error('已取消');
          throw new Error(copy);
        }
      }
    },
    'answer:save': async (input) => {
      const parsed = saveInput.parse(input);
      return Effect.runPromise(answerSvc.save(parsed).pipe(Effect.provide(ctx.answerDbLayer)));
    },
    'answer:unfinalize': async (input) => {
      const parsed = generateInput.parse(input);
      return Effect.runPromise(
        answerSvc.unfinalize(parsed.question_id).pipe(Effect.provide(ctx.answerDbLayer)),
      );
    },
    'answer:list-by-questionnaire': async (input) => {
      const parsed = listInput.parse(input);
      return Effect.runPromise(
        answerSvc
          .listByQuestionnaire(parsed.questionnaire_id)
          .pipe(Effect.provide(ctx.answerDbLayer)),
      );
    },
    'answer:generate-all-unanswered': async (input) => {
      const parsed = listInput.parse(input);
      if (!ctx.providerConfig) {
        throw new Error('AI provider not configured. Open Settings to set up.');
      }
      const results = await Effect.runPromise(
        answerSvc
          .generateAllUnanswered(parsed.questionnaire_id, ctx.providerConfig)
          .pipe(Effect.provide(ctx.answerLayer)),
      );
      return results.map((r) =>
        Either.match(r, {
          onRight: (value) => ({ ok: true as const, result: { value } }),
          onLeft: (error) => ({
            ok: false as const,
            result: {
              error: {
                _tag: error._tag,
                message: 'cause' in error ? String(error.cause) : error._tag,
              },
            },
          }),
        }),
      );
    },

    'answer:export-to-xlsx': async (input) => {
      const parsed = listInput.parse(input);

      const detail = ctx.questionnaireService.getById(parsed.questionnaire_id);
      if (!detail) throw new Error('Questionnaire not found');
      const { questionnaire, document } = detail;

      const answers = await Effect.runPromise(
        answerSvc
          .listByQuestionnaire(parsed.questionnaire_id)
          .pipe(Effect.provide(ctx.answerDbLayer)),
      );
      const questions = ctx.questionnaireService.listQuestions(parsed.questionnaire_id);
      const questionById = new Map(questions.map((q) => [q.id, q]));

      const cells: AnswerCell[] = answers.flatMap((a) => {
        const q = questionById.get(a.question_id);
        if (!q?.position) return [];
        return [{ ref: q.position, value: a.value, isDraft: a.finalized_at == null }];
      });

      const defaultName = document.filename.replace(/\.xlsx$/i, '') + '_filled.xlsx';
      const dialogResult = await dialog.showSaveDialog({
        title: 'Export answered questionnaire',
        defaultPath: defaultName,
        filters: [{ name: 'Excel', extensions: ['xlsx'] }],
      });
      if (dialogResult.canceled || !dialogResult.filePath) {
        return { canceled: true as const };
      }

      const originalBytes = await fs.readFile(document.storage_path);
      const { buffer, written, drafts } = await writeAnswers(originalBytes, cells);
      await fs.writeFile(dialogResult.filePath, buffer);

      ctx.questionnaireService.markExported(questionnaire.id);

      return {
        canceled: false as const,
        path: dialogResult.filePath,
        written,
        drafts,
      };
    },
  };
}
