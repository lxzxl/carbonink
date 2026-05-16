import { AnswerReviewCard } from '@renderer/components/AnswerReviewCard';
import type { Answer, Question } from '@shared/types';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@renderer/lib/api/answer', () => ({
  answerApi: {
    generate: vi.fn(),
    save: vi.fn(),
    listByQuestionnaire: vi.fn(),
  },
}));

const FAKE_QUESTION: Question = {
  id: 'q_01',
  questionnaire_id: 'ques_01',
  question_signature: 'sig_01',
  signature_version: 'v1',
  normalized_text: 'What is the total energy consumption?',
  raw_text: 'Total energy (kWh)',
  parsed_intent: null,
  question_kind: 'numerical',
  expected_unit: 'kWh',
  position: 'B5',
  required: 0,
};

const FAKE_ANSWER: Answer = {
  id: 'ans_01',
  question_id: 'q_01',
  value: '12345.67',
  unit: 'kWh',
  source_kind: 'mapped_inventory',
  source_calculation_snapshot_id: null,
  source_activity_data_id: null,
  source_company_profile_key: null,
  source_narrative_bank_id: null,
  source_summary: null,
  finalized_at: null,
};

function renderCard(answer: Answer | null) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AnswerReviewCard question={FAKE_QUESTION} answer={answer} questionnaireId="ques_01" />
    </QueryClientProvider>,
  );
}

describe('AnswerReviewCard', () => {
  it('renders generate button when answer is null', () => {
    renderCard(null);
    expect(screen.getByRole('button', { name: /generate answer/i })).toBeTruthy();
  });

  it('renders value and unit inputs when answer is provided', () => {
    renderCard(FAKE_ANSWER);
    const inputs = screen.getAllByRole('textbox');
    const valueInput = inputs.find((el) => (el as HTMLInputElement).value === '12345.67');
    expect(valueInput).toBeTruthy();
  });
});
