import { StepAIProvider } from '@renderer/features/onboarding/components/StepAIProvider';
import { StepBoundary } from '@renderer/features/onboarding/components/StepBoundary';
import { StepCompanyInfo } from '@renderer/features/onboarding/components/StepCompanyInfo';
import { StepFirstSite } from '@renderer/features/onboarding/components/StepFirstSite';
import { StepReportingYear } from '@renderer/features/onboarding/components/StepReportingYear';
import { orgApi } from '@renderer/lib/api/organization';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate, useParams } from '@tanstack/react-router';

/**
 * Onboarding route. The visual chrome (centering, card frame, progress
 * dots, eyebrow + title + subtitle, footer separator) lives in each
 * step's `<WizardShell>` invocation — see
 * `src/renderer/features/onboarding/components/WizardShell.tsx`.
 *
 * This component is intentionally thin: pre-check singleton org, then
 * dispatch on `$step`. Each step owns its own form state + Wizard
 * shell instance because (a) the step component already knows its
 * title/subtitle/footer, and (b) form state per step lives in
 * `wizardState.ts` localStorage — no shared form context needed.
 */
export const Route = createFileRoute('/onboarding/$step')({
  component: OnboardingShell,
});

function OnboardingShell() {
  const { step } = useParams({ strict: false });

  // Guard: if an organization already exists, onboarding can't run a second
  // time (singleton enforced in DB via UNIQUE singleton_key on organization).
  // Block here BEFORE the user fills out a multi-step form only to be told
  // at step 5 the create transaction failed. Dashboard owns the post-onboarding
  // view; route them there.
  const hasAny = useQuery({ queryKey: ['org:has-any'], queryFn: orgApi.hasAny });
  if (hasAny.isLoading) return null; // brief flicker is acceptable vs a misleading wizard frame
  if (hasAny.data === true) return <Navigate to="/" replace />;

  if (step === '1') return <StepCompanyInfo />;
  if (step === '2') return <StepReportingYear />;
  if (step === '3') return <StepBoundary />;
  if (step === '4') return <StepFirstSite />;
  if (step === '5') return <StepAIProvider />;
  return <Navigate to="/onboarding/$step" params={{ step: '1' }} replace />;
}
