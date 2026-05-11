import { CommandPalette } from '@renderer/components/command-palette';
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function harness() {
  const rootRoute = createRootRoute({ component: () => <CommandPalette /> });
  const indexRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/',
    component: () => <div>dashboard</div>,
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return <RouterProvider router={router} />;
}

describe('CommandPalette', () => {
  it('is hidden by default', () => {
    render(harness());
    expect(screen.queryByPlaceholderText(/Type a command/)).toBeNull();
  });

  it('opens on Cmd+K', async () => {
    render(harness());
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type a command/)).toBeTruthy();
    });
  });

  it('closes on Escape', async () => {
    render(harness());
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => screen.getByPlaceholderText(/Type a command/));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Type a command/)).toBeNull();
    });
  });
});
