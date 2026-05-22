import { test } from '@playwright/test';

// Deferred. Sanity spec proves the harness pattern; full Confirm flow needs
// dedicated investigation into the renderer-mount issue under e2e (React
// doesn't paint into #root despite the bundle loading). See
// `docs/specs/2026-05-18-playwright-e2e-refresh-design.md` for what's left.
test.skip('travel.v1: upload → extract → recommend → confirm (deferred)', () => {});
