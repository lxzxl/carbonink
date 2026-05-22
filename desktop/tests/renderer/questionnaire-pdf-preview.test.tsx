import { QuestionnairePdfPreview } from '@renderer/components/questionnaire-pdf/QuestionnairePdfPreview';
import type { QuestionnairePdfData } from '@shared/types';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const data: QuestionnairePdfData = {
  customer: { name: 'Acme Corp' },
  questionnaire: {
    id: 'qn-1',
    reporting_year: 2025,
    due_date: '2025-12-31',
    created_at: '2025-06-01T00:00:00Z',
    status: 'answering',
  },
  document: { filename: 'cdp.xlsx' },
  sheets: [
    {
      sheet_name: 'Sheet1',
      questions: [
        {
          id: 'q-1',
          position: 'Sheet1!B5',
          raw_text: 'Total employees',
          normalized_text: 'total employees',
          parsed_intent: null,
          question_kind: 'numerical',
          expected_unit: '人',
          answer: {
            value: '320',
            unit: '人',
            finalized_at: '2026-05-01T00:00:00Z',
            source_summary: null,
          },
        },
        {
          id: 'q-2',
          position: 'Sheet1!C3',
          raw_text: 'Company industry',
          normalized_text: 'company industry',
          parsed_intent: 'pick a category',
          question_kind: 'categorical',
          expected_unit: null,
          answer: { value: 'Manufacturing', unit: null, finalized_at: null, source_summary: null }, // draft
        },
        {
          id: 'q-3',
          position: 'Sheet1!D2',
          raw_text: 'Notes',
          normalized_text: 'notes',
          parsed_intent: null,
          question_kind: 'narrative',
          expected_unit: null,
          answer: null, // unanswered
        },
      ],
    },
  ],
  language: 'en',
};

describe('<QuestionnairePdfPreview>', () => {
  it('renders cover page + sheet section with questions', () => {
    render(<QuestionnairePdfPreview data={data} />);
    expect(screen.getByText('Acme Corp')).toBeTruthy();
    expect(screen.getByText(/Sheet1/)).toBeTruthy();
    expect(screen.getByText(/Total employees/)).toBeTruthy();
    expect(screen.getByText(/320/)).toBeTruthy();
  });

  it('renders DRAFT badge for un-finalized answers and Unanswered for null answers', () => {
    render(<QuestionnairePdfPreview data={data} />);
    // StrictMode may double-render, so use getAllByText.
    expect(screen.getAllByText(/DRAFT|草稿/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Unanswered|未答/).length).toBeGreaterThan(0);
  });
});
