# carbonbook final spec feedback

Review date: 2026-05-09

Reviewed file: `docs/specs/2026-05-08-carbonbook-design.md`

## Summary

Final spec is coherent overall. The chapter ordering is OK, especially moving MCP up to §9 instead of leaving it at the end. The two self-review changes around service layer extraction and the privacy wording after MCP exposure are directionally correct and should stay.

The main remaining issues are scope consistency and a few implementation/legal-risk details that should be clarified before treating this as final.

## Findings

### 1. CBAM is both v1 commercial scope and v1.1 backlog

Severity: High

Current conflict:

- §1 and §10 describe CBAM as a priced add-on with independent license validation.
- §7 gives a full CBAM module design.
- §11 says CBAM Add-on rolls to v1.1 after finding 1-2 design partners.

Recommendation:

Pick one product truth:

- If CBAM is v1: keep §7/§10 as-is and remove CBAM from the v1.1 backlog.
- If CBAM is v1.1: mark §7 as "v1.1 design appendix", and update §1/§10 to say CBAM is post-v1 / future add-on.

I recommend the second option. It preserves the strong future module design without letting v1 scope creep.

### 2. License expiry and grace-period logic conflict

Severity: High

Current conflict:

- §10 "离线宽限" says signature wrong / expired enters read-only.
- §10 "续费" says when `expires_at` arrives, the app enters a 30-day grace period and remains writable.

Recommendation:

Add an explicit state model:

- `expires_at`: subscription end.
- `grace_until`: end of writable renewal grace period.
- `revocation_check_after`: next required online revocation refresh.

Then define behavior:

- Before `expires_at`: full access.
- After `expires_at` and before `grace_until`: full access with renewal banner.
- After `grace_until`: read-only.
- Signature invalid or revoked: read-only immediately.

### 3. `activity_data` EF foreign key cannot cleanly target a UNION / attached DB

Severity: Medium-High

Current conflict:

- `activity_data` declares a composite FK to `emission_factor`.
- EF lookup is described as `ef_library.sqlite` readonly DB plus user EF in `app.sqlite`, queried through UNION and app-layer de-dupe.

SQLite cannot make a normal FK point to a UNION view or a table in another attached database in the way this design implies.

Recommendation:

Use one of these:

- Service-layer referential validation only, no DB FK for EF identity.
- A local `pinned_emission_factor_ref` table in `app.sqlite` that records the exact factor identity used by activities.
- Copy used EF rows into `app.sqlite` at bind time and FK against that local copy.

I recommend `pinned_emission_factor_ref` or copied pinned rows because it improves report reproducibility and avoids relying only on service-layer discipline.

### 4. MCP stdio headless mode needs a permission rule

Severity: Medium

Current gap:

- §9 defines stdio mode where Claude Desktop / Cursor launch `carbonbook --mcp-stdio`.
- §9 also says first connection needs GUI pairing and write operations need GUI confirmation.

The spec does not define what happens when the GUI is not running.

Recommendation:

Add a rule:

- Headless stdio starts read-only unless a prior trusted pairing token exists.
- Write tools in headless mode either connect to the running GUI for confirmation or return `permission_required`.
- No first-time pairing can be completed purely headlessly.

This keeps "off by default" and "write confirm" meaningful.

### 5. OAuth subscription support is too risky for v1 wording

Severity: Medium

Current issue:

The spec treats BYOT API keys and OAuth subscription login as parallel v1 choices. That is risky:

- ChatGPT Plus is for the ChatGPT web app; API usage is separate.
- Claude Pro does not include Anthropic Console/API usage.
- GitHub Copilot SDK OAuth exists, but is technical preview and should not be treated as a stable general LLM-provider route.

Recommendation:

For v1, position AI auth as:

- Primary: BYOT API key.
- Primary enterprise path: OpenAI-compatible endpoint / Azure OpenAI / internal endpoint.
- Experimental / later: provider-specific OAuth where officially supported.

Update onboarding copy from "BYOT key 或 OAuth 一选一" to "BYOT key / compatible endpoint; OAuth providers may appear when supported".

## Chapter Ordering

I agree with the current ordering.

MCP belongs at §9, not at the end, because it depends on and cross-cuts:

- §2 service layer architecture.
- §3 data model.
- §5 inventory/report services.
- §6 questionnaire services.
- §8 EF lookup.
- §10 privacy and license language.

Putting it before subscription/license makes the privacy and cloud-boundary sections more accurate.

## Self-Review Changes

### Service layer after MCP introduction

Agree.

The spec now says tRPC, MCP, and future protocols must all call the service layer rather than importing DB / SQL directly. This is the right constraint. Without it, MCP would duplicate router logic and drift quickly.

### Privacy wording after MCP exposure

Agree.

The revised wording is more accurate than a blunt "data never leaves your computer" claim. With MCP enabled, local AI tools may read carbonbook data and then make their own provider calls. The spec correctly distinguishes that from carbonbook-cloud, which should not receive customer activity/report/questionnaire content.

## Add / Remove / Change

Add:

- A license state machine with `expires_at`, `grace_until`, `revocation_check_after`.
- EF reference strategy for attached readonly EF DB plus custom app DB factors.
- MCP headless stdio permission behavior.
- A provider-auth matrix separating stable BYOT from experimental OAuth.

Change:

- Mark CBAM as v1.1 appendix unless it is intentionally in v1.
- Soften OAuth subscription language in §1, §4, §5, and §11.
- Clarify Linux credential storage expectations if Linux is postponed to v1.1.

Remove:

- No full section needs deletion.
- Only remove CBAM from v1 commercial/license wording if v1.1 is the intended scope.

## External Fact Check Sources

- OpenAI Help Center, "What is ChatGPT Plus?": https://help.openai.com/en/articles/6950777-what-is-chatgpt-plus
- Anthropic Help Center, "What is the Pro plan?": https://support.anthropic.com/en/articles/8325606-what-is-claude-pro
- Anthropic Help Center, "How can I access the Claude API?": https://support.anthropic.com/en/articles/8114521-how-can-i-access-the-claude-api
- GitHub Docs, "Using GitHub OAuth with Copilot SDK": https://docs.github.com/en/copilot/how-tos/copilot-sdk/set-up-copilot-sdk/github-oauth
- Electron Docs, `safeStorage`: https://www.electronjs.org/docs/latest/api/safe-storage
