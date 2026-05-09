import { createFileRoute, useParams, Navigate } from '@tanstack/react-router';
import { StepCompanyInfo } from './-components/StepCompanyInfo';
import * as m from '@renderer/paraglide/messages';

export const Route = createFileRoute('/onboarding/$step')({
  component: OnboardingShell,
});

function OnboardingShell() {
  const { step } = useParams({ strict: false });

  if (step === '1') return <Page><StepCompanyInfo /></Page>;
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
