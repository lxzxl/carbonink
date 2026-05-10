import * as m from '@renderer/paraglide/messages';
import { createFileRoute, Navigate, useParams } from '@tanstack/react-router';
import { StepAIProvider } from './-components/StepAIProvider';
import { StepBoundary } from './-components/StepBoundary';
import { StepCompanyInfo } from './-components/StepCompanyInfo';
import { StepFirstSite } from './-components/StepFirstSite';
import { StepReportingYear } from './-components/StepReportingYear';

export const Route = createFileRoute('/onboarding/$step')({
  component: OnboardingShell,
});

function OnboardingShell() {
  const { step } = useParams({ strict: false });

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
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold">{m.onboarding_title()}</h1>
      {children}
    </div>
  );
}
