import { createFileRoute } from '@tanstack/react-router';
import { SettingsPage } from '@renderer/components/SettingsPage';

export const Route = createFileRoute('/settings')({ component: SettingsPage });
