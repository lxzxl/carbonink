import { Main } from '@renderer/components/layout/main';
import { StepAIProvider } from '@renderer/features/onboarding/components/StepAIProvider';
import { StepBoundary } from '@renderer/features/onboarding/components/StepBoundary';
import { StepCompanyInfo } from '@renderer/features/onboarding/components/StepCompanyInfo';
import { StepFirstSite } from '@renderer/features/onboarding/components/StepFirstSite';
import { StepReportingYear } from '@renderer/features/onboarding/components/StepReportingYear';
import { orgApi } from '@renderer/lib/api/organization';
import * as m from '@renderer/paraglide/messages';
import { useQuery } from '@tanstack/react-query';
import { createFileRoute, Navigate, useParams } from '@tanstack/react-router';

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

  if (step === '1')
    return (
      <Page>
        <StepCompanyInfo />
      </Page>
    );
  if (step === '2')
    return (
      <Page>
        <StepReportingYear />
      </Page>
    );
  if (step === '3')
    return (
      <Page>
        <StepBoundary />
      </Page>
    );
  if (step === '4')
    return (
      <Page>
        <StepFirstSite />
      </Page>
    );
  if (step === '5')
    return (
      <Page>
        <StepAIProvider />
      </Page>
    );
  return <Navigate to="/onboarding/$step" params={{ step: '1' }} replace />;
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <Main>
      <div className="mx-auto max-w-2xl">
        <h1 className="mb-6 text-2xl font-semibold">{m.onboarding_title()}</h1>
        {children}
      </div>
    </Main>
  );
}
