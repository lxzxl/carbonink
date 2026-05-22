import { test } from '@playwright/test';

// Deferred. Phase-2 questionnaire flow (upload .xlsx → LLM extracts questions →
// generate answers → finalize → export) requires the same renderer-mount fix
// that the Phase-1 stage specs are gated on. See
// `docs/specs/2026-05-18-playwright-e2e-refresh-design.md` for what's left.
test.skip('questionnaire end-to-end: upload → extract → answer → export (deferred)', () => {});
