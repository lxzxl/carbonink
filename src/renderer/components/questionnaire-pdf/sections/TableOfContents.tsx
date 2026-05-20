import * as m from '@renderer/paraglide/messages';
import type { QuestionnairePdfData } from '@shared/types';

export function TableOfContents({ data }: { data: QuestionnairePdfData }) {
  if (data.sheets.length <= 1) return null;
  return (
    <nav className="qpdf__toc">
      <h2>{m.questionnaire_pdf_toc_heading()}</h2>
      <ol>
        {data.sheets.map((s) => (
          <li key={s.sheet_name}>{s.sheet_name}</li>
        ))}
      </ol>
    </nav>
  );
}
