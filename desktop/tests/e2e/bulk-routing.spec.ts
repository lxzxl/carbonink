import { test } from '@playwright/test';

// Deferred. Phase-2 bulk + routing flow (seed activity rows missing distance_km
// → trigger routing lookup → assert distance + source label) needs the same
// renderer-mount fix the other specs are gated on. See
// `docs/specs/2026-05-18-playwright-e2e-refresh-design.md` for what's left.
test.skip('bulk routing: lookup distance_km for unrouted activities (deferred)', () => {});
