# carbonbook final spec feedback

Review date: 2026-05-09

Reviewed file: `docs/specs/2026-05-08-carbonbook-design.md`

## Summary

The previous major issues are mostly resolved:

- CBAM is now clearly marked as a v1.1 design appendix.
- License expiry now has an explicit state machine.
- EF binding now uses a local `pinned_emission_factor` copy, which fixes the attached readonly DB foreign-key problem.
- OAuth subscription wording has been softened into BYOT / compatible endpoint as the v1 stable path, with OAuth experimental.
- Linux has been removed from v1 distribution scope.

I would not delete this feedback file yet. There are still a few spec consistency issues worth fixing before treating the document as final.

## Findings

### 1. Headless MCP still leaves read-resource behavior ambiguous

Severity: High

The new headless stdio section correctly blocks write tools without GUI confirmation, but the unpaired-client row only says "所有 tools 一律拒绝". It does not explicitly deny MCP resources.

Relevant sections:

- §9 says read permissions are automatically granted.
- §9 says every external client first connection needs GUI pairing.
- §9 headless row for "无配对历史" denies tools, but does not mention resources.

Risk:

An unpaired client that can launch `carbonbook --mcp-stdio` might still be able to read `carbonbook://activity-data`, `carbonbook://reports/{snapshot_id}`, or questionnaire resources if implementation follows "read auto grant" literally.

Recommendation:

Clarify:

- Before pairing, headless stdio rejects **resources + tools + prompts**.
- "Read 权限自动 grant" means "after successful pairing", not before pairing.
- The unpaired response should be `permission_required` for any MCP request, not just tools.

### 2. ER diagram still points `activity_data` at `emission_factor`, not `pinned_emission_factor`

Severity: Medium

The schema has been fixed: `activity_data` now references `pinned_emission_factor`.

But the ER overview still shows:

- `activity_data -> emission_factor`
- `emission_factor -> ef_dataset`

That no longer matches the implementation design. It should show:

- `activity_data -> pinned_emission_factor`
- `pinned_emission_factor` copied from / derived from `emission_factor`
- Optional `emission_factor -> ef_dataset` only if `ef_dataset` remains an actual table; otherwise drop it from the ER.

Recommendation:

Update the ER diagram so it reflects the pin-copy model. This matters because §3 is the source of truth future migration work will follow.

### 3. JWT example omits `grace_until`

Severity: Medium

The License State Machine defines `grace_until` as a JWT field computed by cloud, but the example JWT still only includes:

- `expires_at`
- `support_until`
- `revocation_check_after`

Recommendation:

Add `grace_until` to the sample JWT, e.g. `expires_at + 30 days`. Otherwise implementers may miss the field even though the state machine depends on it.

### 4. "v1 不做 API 给第三方调用" conflicts with local MCP unless scoped

Severity: Medium

§1 says v1 explicitly does not do "API 给第三方调用". §9 then exposes local MCP resources/tools and explicitly mentions future third-party integration through MCP.

This is probably intended, but the wording is too broad.

Recommendation:

Change §1 to something like:

- "公网 / 云端第三方 REST API"
- "第三方 SaaS 远程 API"
- "非本机、非用户配对的第三方调用"

That keeps the v1 no-public-API promise without contradicting local opt-in MCP.

### 5. Residual v1/v1.1 wording around CBAM and OAuth should be cleaned up

Severity: Low

The main CBAM scope is fixed, but two small places still blur the phase boundary:

- §1 "新做（Seneca 没做）" still lists `BYOT/OAuth AI 三模认证` and `CBAM XML 输出` as if both are v1.0 capabilities.
- §7 "v1 不做" inside a v1.1 appendix says "CBAM 上游 precursor 自动追溯（v1 让用户手填）"; this should probably say "v1.1 MVP 让用户手填".

Recommendation:

Rephrase §1 to distinguish v1.0 from planned v1.1:

- v1.0 new: questionnaire AI mapping, EF version pinning, BYOT / compatible endpoint, local MCP.
- v1.1 planned: CBAM XML, CBAM license, selected OAuth providers.

And rename the §7 list from "v1 不做" to "v1.1 MVP 不做".

## Notes

No section needs deletion. The architecture is now internally much stronger than the previous version; remaining work is mostly tightening source-of-truth wording so implementation does not inherit ambiguity.

## External Fact Check Sources

- Anthropic Docs, "Set up Claude Code": https://docs.anthropic.com/en/docs/claude-code/getting-started
- Anthropic Docs, "Identity and Access Management": https://docs.anthropic.com/en/docs/claude-code/team
- GitHub Docs, "Using GitHub OAuth with Copilot SDK": https://docs.github.com/en/copilot/how-tos/copilot-sdk/set-up-copilot-sdk/github-oauth
- GitHub Docs, "Getting started with Copilot SDK": https://docs.github.com/en/copilot/how-tos/copilot-sdk/sdk-getting-started
