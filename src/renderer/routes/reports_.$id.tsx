import { createFileRoute } from '@tanstack/react-router';
import { useMutation } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { ulid } from 'ulid';
import { reportApi } from '@renderer/lib/api/report';
import { ReportPreview } from '@renderer/components/report/ReportPreview';
import { subscribe } from '@renderer/lib/ipc';
import * as m from '@renderer/paraglide/messages';
import { toast } from '@renderer/components/toast';
import type { InventoryReportData } from '@main/services/report-data-service';
import type { ReportNarrative } from '@main/llm/report-narrative';

export const Route = createFileRoute('/reports_/$id')({ component: ReportDetail });

function ReportDetail() {
  const { id } = Route.useParams();
  const [language, setLanguage] = useState<'zh-CN' | 'en'>('zh-CN');
  const [reportId, setReportId] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState<string>(m.reports_progress_assembling());
  const [generated, setGenerated] = useState<{
    data: InventoryReportData;
    narrative: ReportNarrative;
  } | null>(null);

  // Subscribe to progress events for the duration of an inflight call.
  useEffect(() => {
    if (!reportId) return;
    const unsubscribe = subscribe('report:progress', (payload) => {
      if (payload.report_id !== reportId) return;
      switch (payload.sub_phase) {
        case 'boundary':
          setProgressLabel(m.reports_progress_boundary());
          break;
        case 'reporting-boundary':
          setProgressLabel(m.reports_progress_reporting_boundary());
          break;
        case 'methodology':
          setProgressLabel(m.reports_progress_methodology());
          break;
        case 'emissions':
          setProgressLabel(m.reports_progress_emissions());
          break;
        case 'changes':
          setProgressLabel(m.reports_progress_changes());
          break;
        case 'observations':
          setProgressLabel(m.reports_progress_observations());
          break;
        default:
          if (payload.phase === 'finalizing') setProgressLabel(m.reports_progress_finalizing());
          break;
      }
    });
    return () => unsubscribe();
  }, [reportId]);

  const generateMutation = useMutation({
    mutationFn: async () => {
      const newId = ulid();
      setReportId(newId);
      setProgressLabel(m.reports_progress_assembling());
      return reportApi.generate({ report_id: newId, reporting_period_id: id, language });
    },
    onSuccess: (result) => {
      setReportId(null);
      if ('canceled' in result && result.canceled) return;
      if ('error' in result) {
        if (result.error._tag === 'NoProvider') {
          toast.error(m.reports_no_provider());
        } else {
          toast.error(m.reports_generate_failed({ message: result.error.message ?? '' }));
        }
        return;
      }
      setGenerated({ data: result.data, narrative: result.narrative });
    },
    onError: (err) => {
      setReportId(null);
      toast.error(m.reports_generate_failed({ message: (err as Error).message }));
    },
  });

  const cancel = () => {
    if (reportId) reportApi.cancel({ report_id: reportId });
  };

  const exportBoth = useMutation({
    mutationFn: async () => {
      if (!generated) throw new Error('no narrative');
      const pdfResult = await reportApi.exportPdf({
        data: generated.data,
        narrative: generated.narrative,
        language,
      });
      if ('canceled' in pdfResult && pdfResult.canceled) return;
      if ('ok' in pdfResult && pdfResult.ok) {
        toast.success(m.reports_export_success({ kind: 'PDF', path: pdfResult.path }));
      } else if ('ok' in pdfResult && !pdfResult.ok) {
        toast.error(m.reports_export_failed({ message: pdfResult.error }));
        return;
      }
      const xlsxResult = await reportApi.exportXlsx({
        data: generated.data,
        narrative: generated.narrative,
        language,
      });
      if ('canceled' in xlsxResult && xlsxResult.canceled) return;
      if ('ok' in xlsxResult && xlsxResult.ok) {
        toast.success(m.reports_export_success({ kind: 'Excel', path: xlsxResult.path }));
      } else if ('ok' in xlsxResult && !xlsxResult.ok) {
        toast.error(m.reports_export_failed({ message: xlsxResult.error }));
      }
    },
  });

  return (
    <div className="container mx-auto py-8 px-4 max-w-4xl">
      {!generated && (
        <div className="space-y-4">
          <label className="block">
            <span className="text-sm">{m.reports_lang_label()}</span>
            <select
              value={language}
              onChange={(e) => setLanguage(e.target.value as 'zh-CN' | 'en')}
              className="block mt-1 border rounded px-2 py-1"
            >
              <option value="zh-CN">{m.reports_lang_zh()}</option>
              <option value="en">{m.reports_lang_en()}</option>
            </select>
          </label>
          {generateMutation.isPending ? (
            <div className="flex items-center gap-2">
              <span>{progressLabel}</span>
              <button onClick={cancel} className="rounded border px-2 py-1 text-sm">
                {m.reports_cancel_button()}
              </button>
            </div>
          ) : (
            <button
              onClick={() => generateMutation.mutate()}
              className="rounded bg-black text-white px-3 py-2"
            >
              {m.reports_generate_button()}
            </button>
          )}
        </div>
      )}

      {generated && (
        <>
          <div className="flex gap-2 mb-4">
            <button
              onClick={() => exportBoth.mutate()}
              disabled={exportBoth.isPending}
              className="rounded bg-black text-white px-3 py-2"
            >
              {m.reports_export_both_button()}
            </button>
            <button
              onClick={() => {
                if (window.confirm(m.reports_regenerate_warning())) {
                  setGenerated(null);
                  generateMutation.mutate();
                }
              }}
              className="rounded border px-3 py-2"
            >
              {m.reports_regenerate_button()}
            </button>
          </div>
          <ReportPreview
            data={generated.data}
            narrative={generated.narrative}
            printMode={false}
            editable
            onChange={(next) =>
              setGenerated((prev) => (prev ? { ...prev, narrative: next } : prev))
            }
          />
        </>
      )}
    </div>
  );
}
