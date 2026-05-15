import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useRef, useState } from 'react';

export const Route = createFileRoute('/questionnaires/new')({
  component: NewQuestionnaireRoute,
});

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function NewQuestionnaireRoute() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [customerName, setCustomerName] = useState('');
  const [year, setYear] = useState(new Date().getFullYear());
  const [dueDate, setDueDate] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const mutation = useMutation({
    mutationFn: async () => {
      const file = fileRef.current?.files?.[0];
      if (!file) throw new Error('No file selected');
      if (!file.name.toLowerCase().endsWith('.xlsx')) {
        throw new Error('Only .xlsx is supported');
      }
      const bytes = new Uint8Array(await file.arrayBuffer());
      return questionnaireApi.create({
        customer_name: customerName.trim(),
        reporting_year: year,
        due_date: dueDate || null,
        file_bytes: bytes,
        filename: file.name,
      });
    },
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['questionnaire:list'] });
      const successMsg =
        typeof m.questionnaires_wizard_success === 'function'
          ? m.questionnaires_wizard_success({ count: r.question_count })
          : `Parsed: ${r.question_count} question(s)`;
      toast.success(successMsg);
      // @ts-expect-error route added in T9 — type registers once T9's file is created
      void navigate({ to: '/questionnaires/$id', params: { id: r.questionnaire_id } });
    },
    onError: (err) => {
      toast.error(m.questionnaires_wizard_failed(), {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const canSubmit = customerName.trim().length > 0 && fileName !== null && !mutation.isPending;

  return (
    <div className="max-w-xl space-y-4">
      <h1 className="text-2xl font-semibold">{m.questionnaires_wizard_title()}</h1>
      <div className="space-y-3">
        <div className="space-y-1">
          <Label htmlFor="qa-customer">{m.questionnaires_wizard_customer()}</Label>
          <Input
            id="qa-customer"
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            disabled={mutation.isPending}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="qa-year">{m.questionnaires_wizard_year()}</Label>
          <Input
            id="qa-year"
            type="number"
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            min={2020}
            max={2100}
            disabled={mutation.isPending}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="qa-due">{m.questionnaires_wizard_due()}</Label>
          <Input
            id="qa-due"
            type="date"
            value={dueDate}
            onChange={(e) => setDueDate(e.target.value)}
            disabled={mutation.isPending}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="qa-file">.xlsx</Label>
          <input
            id="qa-file"
            ref={fileRef}
            type="file"
            accept={`${XLSX_MIME},.xlsx`}
            onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
            disabled={mutation.isPending}
            className="block text-sm"
          />
        </div>
      </div>
      <Button type="button" onClick={() => mutation.mutate()} disabled={!canSubmit}>
        {mutation.isPending ? m.questionnaires_wizard_parsing() : m.questionnaires_wizard_upload()}
      </Button>
    </div>
  );
}
