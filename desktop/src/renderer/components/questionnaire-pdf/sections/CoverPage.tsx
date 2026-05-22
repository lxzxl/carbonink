import * as m from '@renderer/paraglide/messages';
import type { QuestionnairePdfData } from '@shared/types';

export function CoverPage({ data }: { data: QuestionnairePdfData }) {
  const generatedAt = new Date().toISOString().slice(0, 10);
  return (
    <section className="qpdf__cover">
      <h1>{data.customer.name}</h1>
      <h2>
        {data.questionnaire.reporting_year} · {data.document.filename}
      </h2>
      {data.questionnaire.due_date && (
        <p>
          {m.questionnaire_pdf_cover_due_date()}: {data.questionnaire.due_date}
        </p>
      )}
      <p>
        {m.questionnaire_pdf_cover_generated_at()}: {generatedAt}
      </p>
    </section>
  );
}
