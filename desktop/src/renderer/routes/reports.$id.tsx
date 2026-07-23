import type { ReportNarrative } from '@main/llm/report-narrative';
import type { TcfdNarrative } from '@main/llm/tcfd-narrative';
import type { InventoryReportData } from '@main/services/report-data-service';
import { ReportPreview } from '@renderer/components/report/ReportPreview';
import { TcfdReportPreview } from '@renderer/components/report/TcfdReportPreview';
import { toast } from '@renderer/components/toast';
import { reportApi } from '@renderer/lib/api/report';
import { subscribe } from '@renderer/lib/ipc';
import * as m from '@renderer/paraglide/messages';
import { useMutation } from '@tanstack/react-query';
import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ulid } from 'ulid';

export const Route = createFileRoute('/reports/$id')({ component: ReportDetail });

type ReportKind = 'iso' | 'tcfd';

type GeneratedReport =
  | { kind: 'iso'; data: InventoryReportData; narrative: ReportNarrative }
  | { kind: 'tcfd'; data: InventoryReportData; narrative: TcfdNarrative };

function ReportDetail() {
  const { id } = Route.useParams();
  const [language, setLanguage] = useState<'zh-CN' | 'en'>('zh-CN');
  // TCFD four-pillar report (spec 2026-07-22): one detail page, two kinds.
  const [reportKind, setReportKind] = useState<ReportKind>('iso');
  const [reportId, setReportId] = useState<string | null>(null);
  const [progressLabel, setProgressLabel] = useState<string>(m.reports_progress_assembling());
  const [generated, setGenerated] = useState<GeneratedReport | null>(null);

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
    mutationFn: async (): Promise<
      | { canceled: true }
      | { canceled: false; error: { _tag: string; message?: string | undefined } }
      | { canceled: false; error?: never; report: GeneratedReport }
    > => {
      const newId = ulid();
      setReportId(newId);
      setProgressLabel(m.reports_progress_assembling());
      const input = { report_id: newId, reporting_period_id: id, language };
      if (reportKind === 'tcfd') {
        const result = await reportApi.generateTcfd(input);
        if (result.canceled) return { canceled: true };
        if (result.error) return { canceled: false, error: result.error };
        return {
          canceled: false,
          report: { kind: 'tcfd', data: result.data, narrative: result.narrative },
        };
      }
      const result = await reportApi.generate(input);
      if (result.canceled) return { canceled: true };
      if (result.error) return { canceled: false, error: result.error };
      return {
        canceled: false,
        report: { kind: 'iso', data: result.data, narrative: result.narrative },
      };
    },
    onSuccess: (outcome) => {
      setReportId(null);
      if (outcome.canceled) return;
      if (outcome.error) {
        if (outcome.error._tag === 'NoProvider') {
          toast.error(m.reports_no_provider());
        } else {
          toast.error(m.reports_generate_failed({ message: outcome.error.message ?? '' }));
        }
        return;
      }
      setGenerated(outcome.report);
    },
    onError: (err) => {
      setReportId(null);
      toast.error(m.reports_generate_failed({ message: (err as Error).message }));
    },
  });

  const cancel = () => {
    if (reportId) reportApi.cancel({ report_id: reportId });
  };

  const exportTcfdPdf = useMutation({
    mutationFn: async () => {
      if (generated?.kind !== 'tcfd') throw new Error('no tcfd narrative');
      const pdfResult = await reportApi.exportTcfdPdf({
        data: generated.data,
        narrative: generated.narrative,
        language,
      });
      if ('canceled' in pdfResult && pdfResult.canceled) return;
      if ('ok' in pdfResult && pdfResult.ok) {
        toast.success(m.reports_export_success({ kind: 'PDF', path: pdfResult.path }));
      } else if ('ok' in pdfResult && !pdfResult.ok) {
        toast.error(m.reports_export_failed({ message: pdfResult.error }));
      }
    },
  });

  const exportBoth = useMutation({
    mutationFn: async () => {
      if (generated?.kind !== 'iso') throw new Error('no narrative');
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
    // Sticky-top action bar + scrolling report body (see CLAUDE.md →
    // Scroll containment). Parent right-pane is overflow-hidden — see
    // reports.tsx. When generating, the report is potentially many
    // screens tall; the Export / Regenerate buttons stay pinned so the
    // user doesn't have to scroll back to the top to re-export.
    <div className="flex h-full flex-col">
      {!generated && (
        <div className="flex-1 min-h-0 overflow-auto">
          <div className="container mx-auto max-w-4xl space-y-4 px-4 py-8">
            <label className="block">
              <span className="text-sm">{m.reports_kind_label()}</span>
              <select
                value={reportKind}
                onChange={(e) => setReportKind(e.target.value as ReportKind)}
                className="block mt-1 border rounded px-2 py-1"
              >
                <option value="iso">{m.reports_kind_iso()}</option>
                <option value="tcfd">{m.reports_kind_tcfd()}</option>
              </select>
            </label>
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
                <button type="button" onClick={cancel} className="rounded border px-2 py-1 text-sm">
                  {m.reports_cancel_button()}
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => generateMutation.mutate()}
                className="rounded bg-black text-white px-3 py-2"
              >
                {m.reports_generate_button()}
              </button>
            )}
          </div>
        </div>
      )}

      {generated && (
        <>
          {/* === Sticky top action bar === */}
          <div className="shrink-0 flex gap-2 border-b border-border bg-background/95 backdrop-blur px-4 py-3">
            {generated.kind === 'iso' ? (
              <button
                type="button"
                onClick={() => exportBoth.mutate()}
                disabled={exportBoth.isPending}
                className="rounded bg-black text-white px-3 py-2"
              >
                {m.reports_export_both_button()}
              </button>
            ) : (
              <button
                type="button"
                onClick={() => exportTcfdPdf.mutate()}
                disabled={exportTcfdPdf.isPending}
                className="rounded bg-black text-white px-3 py-2"
              >
                {m.reports_export_pdf_button()}
              </button>
            )}
            <button
              type="button"
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
          {/* === Scrolling report body === */}
          <div className="flex-1 min-h-0 overflow-auto">
            <div className="container mx-auto max-w-4xl px-4 py-8">
              {generated.kind === 'iso' ? (
                <ReportPreview
                  data={generated.data}
                  narrative={generated.narrative}
                  printMode={false}
                  editable
                  onChange={(next) =>
                    setGenerated((prev) =>
                      prev?.kind === 'iso' ? { ...prev, narrative: next } : prev,
                    )
                  }
                />
              ) : (
                <TcfdReportPreview
                  data={generated.data}
                  narrative={generated.narrative}
                  printMode={false}
                  editable
                  onChange={(next) =>
                    setGenerated((prev) =>
                      prev?.kind === 'tcfd' ? { ...prev, narrative: next } : prev,
                    )
                  }
                />
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
