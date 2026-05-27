import type { LicenseService } from '@main/services/license-service.js';
import type { IpcTypeMap } from './types.js';

/**
 * Channels that mutate persistent state or invoke an AI pipeline. When the
 * license is `expired` or `revoked` the gate refuses these — keeping
 * existing data untouched but blocking any new write.
 *
 * Per design spec §10 "Read-only mode definition":
 *   ❌ activity_data writes, AI pipeline, new reports, calculation snapshot
 *      freeze, EF library writes, MCP write tools, generating new answers.
 *   ✅ View existing data, export PDF/Excel of existing data, browse EF
 *      catalog, change AI provider key (so users can fix a broken key
 *      without re-licensing first), license activation.
 *
 * The set is exported (not just internal) so tests can assert the exact
 * coverage and so a future audit can grep for it.
 */
export const READ_ONLY_BLOCKED_CHANNELS: ReadonlySet<keyof IpcTypeMap> = new Set([
  // activity-data writes
  'activity:create',
  'activity:rebind-ef',
  // emission-source writes
  'source:create',
  'source:update',
  'source:delete',
  // organization writes (existing org's reporting profile / sites / periods
  // — onboarding under unverified is fine; expired users shouldn't be able
  // to add new sites without a working license)
  'org:create',
  'org:create-site',
  'org:create-reporting-period',
  'org:complete-onboarding',
  'org:update-reporting-profile',
  'org:update-basic-info',
  // document writes (uploading new source files)
  'document:upload',
  // extraction pipeline (all AI-backed)
  'extraction:run',
  'extraction:classify-and-run',
  'extraction:confirm',
  'extraction:discard',
  // questionnaire writes
  'questionnaire:create',
  'questionnaire:finalize',
  // inbound questionnaire writes (Phase 2.3 — supplier disclosure)
  'questionnaire:inbound-create-draft',
  'questionnaire:inbound-export-xlsx',
  'questionnaire:inbound-import-preview',
  'questionnaire:inbound-ingest',
  'supplier:create',
  // answer pipeline (all AI-backed except save, which still mutates)
  'answer:generate',
  'answer:save',
  'answer:unfinalize',
  'answer:generate-all-unanswered',
  // report generation (LLM narrative + snapshot freeze)
  'report:generate',
  // EF matcher (AI-backed)
  'ef:recommend',
  // MCP integration writes (file mutations on user's other-app configs)
  'mcp:configure',
  'mcp:remove',
  // Agent skill installer writes (file mutations under ~/.agents/skills/ and host symlinks)
  'skill:install',
  'skill:update',
  'skill:remove',
  // Undo/Redo (post-launch) — inverse operations are themselves writes;
  // expired/revoked licenses block them too per the spec.
  'undo:do',
]);

/**
 * Tagged error thrown by the gate when a write channel is invoked under
 * `expired` or `revoked` license state. `sanitize.ts` keeps an allow-list
 * of error classes whose messages may pass through to the renderer; this
 * one is on it so the UI can render a "renew to continue" banner instead
 * of a generic `[<correlation-id>]` opaque error.
 */
export class LicenseReadOnlyError extends Error {
  readonly _tag = 'LicenseReadOnlyError' as const;
  /** The terminal state that triggered the block. */
  readonly state: 'expired' | 'revoked';

  constructor(state: 'expired' | 'revoked', channel: string) {
    super(`License is ${state}; cannot perform '${channel}' until the license is restored.`);
    this.name = 'LicenseReadOnlyError';
    this.state = state;
  }
}

/**
 * Wrap an IPC handler with a license-state precondition. Reads
 * `licenseService.getState()` on every call (cheap — see LicenseService
 * docs); if the channel is in `READ_ONLY_BLOCKED_CHANNELS` and the state
 * is `expired` or `revoked`, throws `LicenseReadOnlyError` before the
 * handler runs. All other states (`unverified`, `active`, `grace`) pass
 * through — see the design spec table: only `expired` and `revoked`
 * trigger read-only mode.
 *
 * Channel typing is intentionally widened to string at this boundary
 * because the dispatcher loop iterates a heterogeneous handler map.
 * The Set lookup uses the same string key, so the gate stays correct.
 */
export function licenseGate(
  channel: string,
  licenseService: LicenseService,
  fn: (...args: unknown[]) => unknown,
): (...args: unknown[]) => unknown {
  // Fast path: channels that are never blocked don't even call getState().
  // Avoids paying the SQLite-read + crypto-verify cost on every settings
  // poll or list query.
  if (!READ_ONLY_BLOCKED_CHANNELS.has(channel as keyof IpcTypeMap)) {
    return fn;
  }
  return (...args: unknown[]) => {
    const view = licenseService.getState();
    if (view.state === 'expired' || view.state === 'revoked') {
      throw new LicenseReadOnlyError(view.state, channel);
    }
    return fn(...args);
  };
}
