import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { ReportPreview } from '@renderer/components/report/ReportPreview';
import { QuestionnairePdfPreview } from '@renderer/components/questionnaire-pdf/QuestionnairePdfPreview';
import type { InventoryReportData } from '@main/services/report-data-service';
import type { ReportNarrative } from '@main/llm/report-narrative';
import type { QuestionnairePdfData } from '@shared/types';

export const Route = createFileRoute('/print-render')({ component: PrintRender });

type InventoryReportPayload = {
  kind: 'inventory_report';
  data: InventoryReportData;
  narrative: ReportNarrative;
  language: 'zh-CN' | 'en';
};
type QuestionnairePdfPayload = {
  kind: 'questionnaire_pdf';
  data: QuestionnairePdfData;
};
type PrintPayload = InventoryReportPayload | QuestionnairePdfPayload;

declare global {
  interface Window {
    __REPORT_PAYLOAD__?: PrintPayload;
  }
}

function PrintRender() {
  const [payload, setPayload] = useState<PrintPayload | null>(null);

  useEffect(() => {
    // Wait for main process to inject window.__REPORT_PAYLOAD__ via executeJavaScript.
    // Poll briefly (the injection is typically synchronous before loadURL resolves, but
    // be defensive).
    let attempts = 0;
    const tick = () => {
      if (window.__REPORT_PAYLOAD__) {
        setPayload(window.__REPORT_PAYLOAD__);
        return;
      }
      attempts++;
      if (attempts < 50) setTimeout(tick, 50); // up to 2.5s
    };
    tick();
  }, []);

  useEffect(() => {
    if (!payload) return;
    // Signal main that DOM is stable: wait for fonts + a frame, then set title=READY.
    const signal = async () => {
      if (typeof document.fonts?.ready?.then === 'function') {
        await document.fonts.ready;
      }
      requestAnimationFrame(() => {
        document.title = 'READY';
      });
    };
    void signal();
  }, [payload]);

  if (!payload) return <div>Loading payload…</div>;

  if (payload.kind === 'inventory_report') {
    return (
      <ReportPreview
        data={payload.data}
        narrative={payload.narrative}
        printMode={true}
      />
    );
  }
  if (payload.kind === 'questionnaire_pdf') {
    return <QuestionnairePdfPreview data={payload.data} />;
  }
  return <div>Unknown payload kind</div>;
}
