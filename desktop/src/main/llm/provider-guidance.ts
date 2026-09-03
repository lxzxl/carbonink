import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ProviderGuidance } from '@shared/types.js';

/**
 * Curated provider guidance overlay (spec 2026-09-02 LLM provider guidance).
 *
 * Guidance is an overlay, not a filter: the Settings provider list always
 * shows pi-ai's full runtime catalog, and providers without an entry here
 * render as a bare name. A missing entry means missing copy — never an
 * unavailable provider — so existing saved configs keep working after
 * upgrades and newly-added pi-ai providers degrade to plain rows.
 *
 * Copy rules: no superlatives, no speed numbers (all claims are hedged
 * "typically"/"expect" hints that age gracefully). The strings themselves
 * live in paraglide (`provider_guidance_<id>_latency` / `_note`); only the
 * message keys travel over IPC so a runtime locale switch re-renders
 * without re-fetching.
 *
 * Referral URLs live OUTSIDE this table in a separate, gitignored runtime
 * file (`provider-referrals.json` under the app's userData dir). They are
 * the maintainer's personal links, not repo content: a missing or invalid
 * file means no referral links, and only `https://` URLs are accepted.
 */

interface StaticGuidance {
  /** Display name; pi-ai ids are lowercase slugs, not human copy. */
  name: string;
  /** Paraglide key for the one-line latency hint. */
  latencyHintKey: string;
  /** Paraglide key for the suitability note. */
  noteKey: string;
  /**
   * Locale tags this provider is recommended for. Currently only 'cn'
   * (matched against a `zh-*` app locale) — a hint, not a geo verdict.
   * Empty means "no recommendation either way".
   */
  recommendedFor: string[];
}

const STATIC_GUIDANCE: Record<string, StaticGuidance> = {
  deepseek: {
    name: 'DeepSeek',
    latencyHintKey: 'provider_guidance_deepseek_latency',
    noteKey: 'provider_guidance_deepseek_note',
    recommendedFor: ['cn'],
  },
  openai: {
    name: 'OpenAI',
    latencyHintKey: 'provider_guidance_openai_latency',
    noteKey: 'provider_guidance_openai_note',
    recommendedFor: ['global'],
  },
  anthropic: {
    name: 'Anthropic',
    latencyHintKey: 'provider_guidance_anthropic_latency',
    noteKey: 'provider_guidance_anthropic_note',
    recommendedFor: ['global'],
  },
};

const REFERRAL_FILE = 'provider-referrals.json';

/**
 * Load the maintainer's personal referral links. Any failure (missing
 * file, bad JSON, non-URL values) yields no links — guidance still works.
 */
function loadReferralUrls(userDataDir: string): Record<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(join(userDataDir, REFERRAL_FILE), 'utf8'));
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};
  const out: Record<string, string> = {};
  for (const [id, url] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof url === 'string' && url.startsWith('https://')) out[id] = url;
  }
  return out;
}

/** Static guidance table merged with the runtime referral overlay. */
export function getProviderGuidance(userDataDir: string): ProviderGuidance[] {
  const referrals = loadReferralUrls(userDataDir);
  return Object.entries(STATIC_GUIDANCE).map(([id, g]) => {
    const url = referrals[id];
    return {
      id,
      name: g.name,
      latencyHintKey: g.latencyHintKey,
      noteKey: g.noteKey,
      recommendedFor: g.recommendedFor,
      ...(url !== undefined ? { referralUrl: url } : {}),
    };
  });
}
