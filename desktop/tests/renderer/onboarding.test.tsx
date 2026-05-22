import { StepCompanyInfo } from '@renderer/features/onboarding/components/StepCompanyInfo';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

// StepCompanyInfo uses TanStack Form + localStorage for the draft, plus the
// router for navigation. It does not call any IPC channels, so we don't need
// to stub `window.ipc` here. (The post-typed-ipc world has no module-level
// IPC bootstrap that crashes outside Electron — unlike the old electron-trpc
// `ipcLink()` which had to be mocked.)

describe('Onboarding wizard step 1', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders company info form fields', async () => {
    // Build a minimal in-memory router that just renders StepCompanyInfo.
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
