import '@renderer/styles/questionnaire-pdf.css';
import type { QuestionnairePdfData } from '@shared/types';
import { CoverPage } from './sections/CoverPage';
import { SheetSection } from './sections/SheetSection';
import { TableOfContents } from './sections/TableOfContents';

export interface QuestionnairePdfPreviewProps {
  data: QuestionnairePdfData;
}

export function QuestionnairePdfPreview({ data }: QuestionnairePdfPreviewProps) {
  return (
    <div className="qpdf">
      <CoverPage data={data} />
      <TableOfContents data={data} />
      {data.sheets.map((sheet) => (
        <SheetSection key={sheet.sheet_name} sheet={sheet} />
      ))}
    </div>
  );
}
