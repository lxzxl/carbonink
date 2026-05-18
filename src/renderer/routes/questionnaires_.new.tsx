import { toast } from '@renderer/components/toast';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import { questionnaireApi } from '@renderer/lib/api/questionnaire';
import * as m from '@renderer/paraglide/messages';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { FileSpreadsheet, UploadCloud } from 'lucide-react';
import { useRef, useState } from 'react';

export const Route = createFileRoute('/questionnaires_/new')({
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
  const [isDragging, setIsDragging] = useState(false);
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
      toast.success(m.questionnaires_wizard_success({ count: r.question_count }));
      void navigate({ to: '/questionnaires/$id', params: { id: r.questionnaire_id } });
    },
    onError: (err) => {
      toast.error(m.questionnaires_wizard_failed(), {
        description: err instanceof Error ? err.message : String(err),
      });
    },
  });

  const disabled = mutation.isPending;
  const hasCustomer = customerName.trim().length > 0;
  const hasFile = fileName !== null;
  const canSubmit = hasCustomer && hasFile && !disabled;

  // Drag-drop: feed the dropped file into the hidden input via DataTransfer
  // so React's onChange handler treats it the same as a click-picked file.
  function onDrop(e: React.DragEvent<HTMLLabelElement>): void {
    e.preventDefault();
    setIsDragging(false);
    if (disabled) return;
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    if (!file.name.toLowerCase().endsWith('.xlsx')) {
      toast.warning(m.questionnaires_wizard_failed(), {
        description: 'Only .xlsx is supported',
      });
      return;
    }
    if (fileRef.current) {
      const dt = new DataTransfer();
      dt.items.add(file);
      fileRef.current.files = dt.files;
      setFileName(file.name);
    }
  }

  return (
    <div className="max-w-2xl space-y-6">
      <h1 className="text-2xl font-semibold">{m.questionnaires_wizard_title()}</h1>

      <div className="rounded-md border border-border bg-card p-6 space-y-5">
        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-1.5 col-span-2">
            <Label htmlFor="qa-customer">
              {m.questionnaires_wizard_customer()}
              <span className="ml-0.5 text-destructive">*</span>
            </Label>
            <Input
              id="qa-customer"
              value={customerName}
              onChange={(e) => setCustomerName(e.target.value)}
              disabled={disabled}
              placeholder="例：上海某科技有限公司"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qa-year">{m.questionnaires_wizard_year()}</Label>
            <Input
              id="qa-year"
              type="number"
              value={year}
              onChange={(e) => setYear(Number(e.target.value))}
              min={2020}
              max={2100}
              disabled={disabled}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="qa-due">{m.questionnaires_wizard_due()}</Label>
            <Input
              id="qa-due"
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              disabled={disabled}
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="qa-file">
            .xlsx
            <span className="ml-0.5 text-destructive">*</span>
          </Label>
          <label
            htmlFor="qa-file"
            onDragOver={(e) => {
              e.preventDefault();
              if (!disabled) setIsDragging(true);
            }}
            onDragLeave={() => setIsDragging(false)}
            onDrop={onDrop}
            data-dragging={isDragging || undefined}
            data-has-file={hasFile || undefined}
            className={[
              'flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md',
              'border-2 border-dashed border-border bg-muted/30 px-6 py-8 text-sm transition-colors',
              'hover:border-primary/60 hover:bg-muted/50',
              'data-[dragging]:border-primary data-[dragging]:bg-primary/5',
              'data-[has-file]:border-primary/60 data-[has-file]:bg-primary/5',
              disabled ? 'pointer-events-none opacity-60' : '',
            ]
              .filter(Boolean)
              .join(' ')}
          >
            {hasFile ? (
              <>
                <FileSpreadsheet className="h-7 w-7 text-primary" aria-hidden="true" />
                <span className="font-medium text-foreground">
                  {m.questionnaires_wizard_file_chosen({ filename: fileName ?? '' })}
                </span>
              </>
            ) : (
              <>
                <UploadCloud className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
                <span className="font-medium text-foreground">
                  {m.questionnaires_wizard_file_choose()}
                </span>
              </>
            )}
            <input
              id="qa-file"
              ref={fileRef}
              type="file"
              accept={`${XLSX_MIME},.xlsx`}
              onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
              disabled={disabled}
              className="sr-only"
            />
          </label>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button type="button" onClick={() => mutation.mutate()} disabled={!canSubmit}>
            {mutation.isPending
              ? m.questionnaires_wizard_parsing()
              : m.questionnaires_wizard_upload()}
          </Button>
          {!canSubmit && !disabled && (
            <span className="text-xs text-muted-foreground">
              {m.questionnaires_wizard_hint_required()}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
