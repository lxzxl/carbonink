import * as m from '@renderer/paraglide/messages';
import type { QuestionnairePdfData } from '@shared/types';

type Question = QuestionnairePdfData['sheets'][number]['questions'][number];

export function QuestionAnswerRow({ question, index }: { question: Question; index: number }) {
  return (
    <div className="qpdf__qa">
      <div className="qpdf__qa-q">
        Q{index + 1}. {question.raw_text}
      </div>
      {question.parsed_intent && <div className="qpdf__qa-intent">{question.parsed_intent}</div>}
      <AnswerBlock question={question} />
    </div>
  );
}

function AnswerBlock({ question }: { question: Question }) {
  const a = question.answer;
  if (a == null) {
    return (
      <div className="qpdf__qa-a qpdf__qa-unanswered">{m.questionnaire_pdf_unanswered()}</div>
    );
  }
  const unit = a.unit ? ` ${a.unit}` : '';
  const badge =
    a.finalized_at == null ? (
      <span className="qpdf__qa-badge qpdf__qa-badge--draft">{m.questionnaire_pdf_draft()}</span>
    ) : (
      <span className="qpdf__qa-badge qpdf__qa-badge--final">
        {m.questionnaire_pdf_finalized()}
      </span>
    );
  return (
    <div className="qpdf__qa-a">
      {a.value}
      {unit}
      {badge}
      {a.source_summary && (
        <div className="qpdf__qa-source">
          {m.questionnaire_pdf_source_summary()}: {a.source_summary}
        </div>
      )}
    </div>
  );
}
