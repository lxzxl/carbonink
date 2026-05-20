import { CommandPalette } from '@renderer/components/command-palette';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

function buildHarness(initialPath = '/') {
  const rootRoute = createRootRoute({
    component: () => (
      <>
        <CommandPalette />
        <Outlet />
      </>
    ),
  });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <div data-testid="route-marker">dashboard-route</div>,
  });
  const onboardingRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/onboarding/$step',
    component: () => <div data-testid="route-marker">onboarding-route</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute, onboardingRoute]),
    history: createMemoryHistory({ initialEntries: [initialPath] }),
  });
  return { ui: <RouterProvider router={router} />, router };
}

function harness() {
  return buildHarness().ui;
}

describe('CommandPalette', () => {
  afterEach(() => {
    cleanup();
  });

  it('is hidden by default', () => {
    render(harness());
    expect(screen.queryByPlaceholderText(/Type a command/)).toBeNull();
  });

  it('opens on Cmd+K', async () => {
    render(harness());
    // Wait for the router to mount the route + CommandPalette before pressing the hotkey.
    await screen.findByTestId('route-marker');
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type a command/)).toBeTruthy();
    });
  });

  it('closes on Escape (handled by Radix Dialog inside cmdk)', async () => {
    render(harness());
    await screen.findByTestId('route-marker');
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    const input = await waitFor(() => screen.getByPlaceholderText(/Type a command/));
    // Plain Escape — no metaKey filter. Radix Dialog (the basis of
    // Command.Dialog) listens on the dialog itself and fires onOpenChange(false).
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Type a command/)).toBeNull();
    });
  });

  it('navigates to Dashboard when its command is selected, then closes', async () => {
    // Start on the onboarding route so we can observe a real route change to /.
    const { ui, router } = buildHarness('/onboarding/1');
    render(ui);

    // Sanity: we begin on the onboarding route.
    const marker = await screen.findByTestId('route-marker');
    expect(marker.textContent).toBe('onboarding-route');

    // Open the palette.
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    const input = await waitFor(() => screen.getByPlaceholderText(/Type a command/));

    // Filter to the Dashboard command.
    fireEvent.change(input, { target: { value: 'Dashboard' } });
    await waitFor(() => screen.getByText('Open Dashboard'));

    // Select the highlighted item via Enter.
    fireEvent.keyDown(input, { key: 'Enter' });

    // Palette closes.
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Type a command/)).toBeNull();
    });

    // Router navigated to '/'.
    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/');
    });
    expect(screen.getByTestId('route-marker').textContent).toBe('dashboard-route');
  });
});
