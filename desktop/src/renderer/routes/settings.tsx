import { Main } from '@renderer/components/layout/main';
import { SettingsPage } from '@renderer/components/SettingsPage';
import { createFileRoute } from '@tanstack/react-router';

export const Route = createFileRoute('/settings')({ component: SettingsRoute });

function SettingsRoute() {
  return (
    <Main>
      <SettingsPage />
    </Main>
  );
}
