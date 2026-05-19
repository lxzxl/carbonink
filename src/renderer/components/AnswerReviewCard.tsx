import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { answerApi } from '@renderer/lib/api/answer';
import * as m from '@renderer/paraglide/messages';
import type { Answer, Question } from '@shared/types';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';

export interface AnswerReviewCardProps {
  question: Question;
  answer: Answer | null;
  questionnaireId: string;
}

export function AnswerReviewCard({ question, answer, questionnaireId }: AnswerReviewCardProps) {
  const queryClient = useQueryClient();
  const [value, setValue] = useState(answer?.value ?? '');
  const [unit, setUnit] = useState(answer?.unit ?? '');

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['answer:list-by-questionnaire', questionnaireId] });

  const generate = useMutation({
    mutationFn: () => answerApi.generate(question.id),
    onSuccess: (a) => {
      setValue(a.value);
      setUnit(a.unit ?? '');
      void invalidate();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const save = useMutation({
    mutationFn: (finalize: boolean) =>
      answerApi.save({ question_id: question.id, value, unit: unit || null, finalize }),
    onSuccess: () => void invalidate(),
    onError: (e) => toast.error(e instanceof Error ? e.message : String(e)),
  });

  const parsedSummary =
    answer?.source_summary != null
      ? (() => {
          try {
            return JSON.parse(answer.source_summary) as string;
          } catch {
            return answer.source_summary;
          }
        })()
      : null;

  if (!answer) {
    const lastError = generate.isError
      ? generate.error instanceof Error
        ? generate.error.message
        : String(generate.error)
      : null;
    return (
      <div className="rounded-md border border-border bg-muted/30 p-4 text-sm space-y-3">
        <header className="flex items-baseline gap-2">
          <span className="font-medium">{question.raw_text}</span>
          {question.position && (
            <span className="text-xs text-muted-foreground">{question.position}</span>
          )}
        </header>
        <p className="text-muted-foreground">{m.answer_not_generated()}</p>
        <Button
          type="button"
          onClick={() => generate.mutate()}
          disabled={generate.isPending}
          size="sm"
        >
          {generate.isPending ? m.answer_generating() : m.answer_generate()}
        </Button>
        {lastError && (
          <div className="rounded-sm border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
            <span className="font-medium">{m.answer_generate_error_label()}：</span> {lastError}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border bg-muted/30 p-4 text-sm space-y-3">
      <header className="flex items-baseline gap-2">
        <span className="font-medium">{question.raw_text}</span>
        {question.position && (
          <span className="text-xs text-muted-foreground">{question.position}</span>
        )}
        {answer.finalized_at && (
          <span className="ml-auto rounded border border-border bg-background px-2 py-0.5 text-xs">
            {m.answer_finalized()}
          </span>
        )}
      </header>

      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1 flex-1 min-w-[120px]">
          <Label>{m.answer_value()}</Label>
          <Input value={value} onChange={(e) => setValue(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1 flex-1 min-w-[100px]">
          <Label>{m.answer_unit()}</Label>
          <Input value={unit} onChange={(e) => setUnit(e.target.value)} />
        </div>
      </div>

      {parsedSummary && (
        <p className="italic text-muted-foreground text-xs">
          {m.answer_source()}: {parsedSummary}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => save.mutate(false)}
          disabled={save.isPending}
        >
          {m.answer_save()}
        </Button>
        <Button
          type="button"
          size="sm"
          onClick={() => save.mutate(true)}
          disabled={save.isPending || value.trim() === ''}
          title={value.trim() === '' ? '请先填写数值后再定稿' : undefined}
        >
          {m.answer_save_finalize()}
        </Button>
      </div>
    </div>
  );
}
