import { StepCompanyInfo } from '@renderer/routes/onboarding/-components/StepCompanyInfo';
import {
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// electron-trpc's ipcLink() executes at module load time and crashes outside Electron.
// Mock the module before any route tree import can trigger it.
vi.mock('electron-trpc/renderer', () => ({
  ipcLink: () => () => ({ next: () => {} }),
}));

describe('Onboarding wizard step 1', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders company info form fields', async () => {
    // Build a minimal in-memory router that just renders StepCompanyInfo
    const rootRoute = createRootRoute();
    const stepRoute = createRoute({
      getParentRoute: () => rootRoute,
      path: '/onboarding/1',
      component: StepCompanyInfo,
    });
    const routeTree = rootRoute.addChildren([stepRoute]);
    const history = createMemoryHistory({ initialEntries: ['/onboarding/1'] });
    const router = createRouter({ routeTree, history });

    render(<RouterProvider router={router} />);

    // Labels come from paraglide messages: "Chinese name" (en) / "中文名" (zh-CN)
    expect(await screen.findByLabelText(/中文名|Chinese name/i)).toBeTruthy();
    // Labels come from paraglide messages: "English name" (en) / "英文名" (zh-CN)
    expect(await screen.findByLabelText(/英文名|English name/i)).toBeTruthy();
  });
});
