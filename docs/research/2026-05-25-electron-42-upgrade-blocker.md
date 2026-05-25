# Electron 42 upgrade — blocked on better-sqlite3 V8 API fix

**Date:** 2026-05-25
**Conclusion:** Don't upgrade yet. Stay on `electron@^41.5.1`. Re-evaluate when `better-sqlite3` ships PR #1475 in a release (likely `12.11.0`).

## Context

Electron 42.0.0 shipped on 2026-05-06; the current stable patch as of this
investigation is **42.2.0** (released 2026-05-19). Stack:

| Component | Electron 41 | Electron 42 |
|---|---|---|
| Chromium | ~138 | **148.0.7778.96** |
| Node.js | 22.x | **24.15.0** |
| V8 | 14.0 | **14.8** |

Earlier blocker captured at commit `951b0e1` (2026-05-10): better-sqlite3
12.9.0 wouldn't compile against Electron 42's V8 14.8. We pinned at
`^41.5.1` with a removal trigger of "when better-sqlite3 catches up."

This note is the May 25 re-check. **The blocker is still real.**

## What we use of v42 — audit results

| Breaking change | Our usage | Impact |
|---|---|---|
| `clearStorageData({ quotas })` removed | grep src/ — none | None |
| macOS notifications now use `UNNotification` (requires code-signing; unsigned apps emit `failed`) | No `new Notification(...)` in src/ | None — note for future |
| Offscreen rendering default `deviceScaleFactor` → 1.0 | We don't use OSR | None |
| `ELECTRON_SKIP_BINARY_DOWNLOAD` env removed | Not used | None |
| `electron` no longer auto-downloads in `postinstall` — lazy on first `bin` call | We use `pnpm` with `onlyBuiltDependencies` allowing electron's postinstall | First `pnpm dev`/`pnpm build` after install triggers the lazy download. CI cold-cache cost. Not blocking, just changed timing. |

**No code changes needed in our app.** The blocker is purely a native-dep
build issue.

## Related deps — all compatible

All Electron-ecosystem packages we depend on are already at versions that
support Node 24 / Electron 42:

| Package | Our version | Latest | Engine OK for Node 24 |
|---|---|---|---|
| `electron-builder` | `^26.8.1` | 26.8.1 | yes |
| `electron-vite` | `^5.0.0` | 5.0.0 | yes (`^20.19.0 || >=22.12.0`) |
| `electron-updater` | `^6.8.3` | 6.8.3 | yes |
| `@electron/rebuild` | `^4.0.4` | 4.0.4 | yes (`>=22.12.0`) |
| `electron-playwright-helpers` | `^2.1.0` | 2.1.0 | yes |

Our `package.json` already declares `"engines": { "node": ">=24" }`, which
matches Electron 42's Node 24.15.0 runtime. No engine bump needed.

## The blocker — `better-sqlite3` source still uses 2-arg `v8::External::New`

Electron 42's V8 14.8 changed two C++ APIs:

1. `v8::External::New` requires a third `ExternalPointerTypeTag` arg.
2. `SetNativeDataProperty` overload became ambiguous when passing `int 0`
   instead of `nullptr` for the optional setter slot.

`better-sqlite3@12.10.0` (latest as of 2026-05-25, released 2026-05-12)
still has the old call shapes:

```cpp
// src/better_sqlite3.cpp:60 — current v12.10.0 source
v8::Local<v8::External> data = v8::External::New(isolate, addon);
```

Building against Electron 42 fails at compile time:

```
error: too few arguments to function call, expected 3, have 2
error: call of overloaded 'SetNativeDataProperty(...)' is ambiguous
```

Confirmed in the wild by [issue #1474](https://github.com/WiseLibs/better-sqlite3/issues/1474)
("Build failure starting with electron 42.0.1", filed 2026-05-17).

### Upstream timeline

| Version | Date | Status |
|---|---|---|
| 12.9.0 | 2026-04-12 | Our current pin. Pre-Electron-42. |
| 12.9.1 | 2026-05-06 | Added v42 prebuilds (PR #1466), but they didn't build. Marked **"NOT A VIABLE RELEASE"** by maintainer. |
| 12.10.0 | 2026-05-12 | **Rolled back v42 prebuilds** (PR #1470): "Avoid building for Electron v42 until the updated V8 API errors are resolved." |
| 12.11.0? | TBD | PR #1475 (the source-level fix) lands here. |

### The fix exists but is not yet merged

[PR #1475 — "Fix V8 external API usage for Electron 42"](https://github.com/WiseLibs/better-sqlite3/pull/1475)
by `tstone-1`, opened 2026-05-17.

Status: **approved by maintainer `m4heshd`**, awaiting `JoshuaWise` (final
review). Not merged as of 2026-05-25.

The diff is 10 lines across 3 files — adds a `NODE_MODULE_VERSION >= 146`
guarded macro and switches `v8::External::New`/`SetNativeDataProperty` to
the new signatures. Follows the same version-guard pattern as PR #1459
(prior Electron compat work).

```cpp
// src/util/macros.cpp — proposed
#if defined(NODE_MODULE_VERSION) && NODE_MODULE_VERSION >= 146
#define EXTERNAL_NEW(isolate, value) v8::External::New((isolate), (value), 0)
#define EXTERNAL_VALUE(value) (value)->Value(0)
#else
#define EXTERNAL_NEW(isolate, value) v8::External::New((isolate), (value))
#define EXTERNAL_VALUE(value) (value)->Value()
#endif
```

## Why we're waiting (not patching)

Three options were considered:

1. **Patch better-sqlite3 locally via `pnpm patch`** with PR #1475's diff.
   Defensible (small, maintainer-approved diff, follows prior pattern),
   but ships a patched native dep that hasn't been upstream-released.
2. **Switch to `node:sqlite`** (built into Node 24, available in Electron
   42's runtime). Eliminates the native-dep ABI problem entirely. Cost: a
   meaningful refactor of every prepared statement/transaction/pragma in
   `src/main/db/` plus the in-process MCP server.
3. **Wait.** Cheapest. PR is approved; a release is plausibly imminent.

Decision: wait. The pin at `^41.5.1` is still in Electron's supported
window per their release schedule (one stable cycle = ~8 weeks; v41 LTS
through 2026-08). Patching a native dep without an upstream release
introduces supply-chain and maintenance risk we'd rather avoid for a
shipping product.

## Re-attempt checklist (when better-sqlite3 ships the fix)

When a `better-sqlite3` release lands containing PR #1475 (or a fix that
supersedes it):

1. Re-run this exact audit. The "what we use of v42" table above is
   reusable — confirm no NEW v42 breaking APIs have crept into our code
   since 2026-05-25.
2. Bump `desktop/package.json`:
   - `"electron": "^42.x.x"` (whatever latest 42.x is)
   - `"better-sqlite3": "^12.11.0"` (or whatever release has the fix)
3. `pnpm install` from repo root.
4. `pnpm --filter carbonink rebuild:native` — should now succeed against
   Electron 42 headers.
5. `pnpm desktop:typecheck && pnpm desktop:test` — baseline must hold.
6. `pnpm --filter carbonink dev` — verify the app boots, hits the DB,
   no V8-related crashes.
7. Sanity-check the lazy binary download: after `pnpm install` the
   `node_modules/electron/dist` dir is now NOT populated until first
   `electron` bin invocation. `pnpm dev` should trigger it
   transparently.
8. Commit message: `chore(deps): bump electron 41 → 42 (better-sqlite3 X.Y.Z)`.

## References

- [Electron 42.0.0 release notes](https://github.com/electron/electron/releases/tag/v42.0.0)
- [Electron 42.2.0 release notes](https://github.com/electron/electron/releases/tag/v42.2.0)
- [better-sqlite3 issue #1474 — build failure on electron 42](https://github.com/WiseLibs/better-sqlite3/issues/1474)
- [better-sqlite3 PR #1475 — V8 API fix (approved, unmerged)](https://github.com/WiseLibs/better-sqlite3/pull/1475)
- [better-sqlite3 PR #1470 — rollback of v42 prebuilds](https://github.com/WiseLibs/better-sqlite3/pull/1470)
- Original pin commit: `951b0e1` ("fix: pin electron ^41.5.1")
