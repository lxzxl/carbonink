# Phase 1b — AI Extraction Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 用户上传一张中国电费单 PDF → AI 抽数据 → 人审 confirm → 落 activity_data → 看到 dashboard 数字。AI 是数据工程师，不是决策者；所有 LLM 调用从 main 进程发起，凭证存 OS keychain（macOS Keychain / Windows Credential Manager）。

**Architecture:** Phase 0/1a schema (document / extraction tables 已建于 migration 003) + service layer + typed-ipc 全沿用。Phase 1b 加：(1) 凭证后端接入 + Settings UI，(2) LLMClient（Vercel AI SDK 6 wrapper），(3) DocumentLoader + ExtractionService，(4) Stage Registry，(5) /documents 路由（upload + list + review detail）。

**Tech Stack 增量：**
- `ai` ^6（Vercel AI SDK 6 — 替代 spec 原定 `@earendil-works/pi-ai`，理由：zod 原生 `generateObject`，5 个 provider 独立小包，12.5M weekly DL）
- `@ai-sdk/openai` ^3, `@ai-sdk/anthropic` ^3, `@ai-sdk/azure` ^3, `@ai-sdk/deepseek` ^2, `@ai-sdk/openai-compatible` ^1
- `pdf-parse` ^1.1 —— PDF 文本抽取（OCR fallback 留 Phase 1c）

**Scope 边界：**
- ✅ Provider 代码支持 5 个（OpenAI / Anthropic / Azure / DeepSeek / OpenAI-compat），smoke 只验 OpenAI
- ✅ 1 个 doc type prompt：`china_utility`（中国电费单分类 + 抽取合一）
- ✅ 单次 `generateObject` 调用，**不**做 streaming（Phase 1c 再升 `streamObject`）
- ✅ Pdf-parse 只读文本层；扫描件 / OCR 留 Phase 1c
- ✅ Confirm 流程复用 Phase 1a ActivityForm（预填 amount/unit/dates）
- ❌ OAuth subscription（Claude.ai / ChatGPT）—— Phase 2
- ❌ 加油单 / 物流单 / 钢材 / 通勤 prompt —— Phase 1c
- ❌ Cost tracking / token 计量 —— Phase 1c
- ❌ Streaming UI 进度 —— Phase 1c
- ❌ Prompt 版本 A/B —— Phase 2

**Verification gate（每个 task 完成后）：**
```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```
+ 每 3-4 task 用户 dev session 验证。

**Phase 1b Deliverable：** 用户在 Settings 填 OpenAI key → /documents 上传一张电费单 PDF → 几秒后列表显示 "review_needed" → 点开 review 页 → AI 抽出的 supplier/amount/unit/dates 已预填 → 选 emission_source + EF → 提交 → activity_data 落库 → dashboard 总数自动 +N kg CO2e。

---

## File Structure

**新建：**
- `src/main/credentials/credential-service.ts` + test — IPC 友好的凭证 service（封装 Phase 0 `CredentialStore`）
- `src/main/credentials/safe-storage-backend.ts` + test — Electron safeStorage + filesystem blob 实际后端
- `src/main/llm/llm-client.ts` + test — AI SDK wrapper：`getModel(config) → generateObject(schema, prompt)`
- `src/main/llm/provider-config.ts` + test — provider config zod schemas
- `src/main/services/settings-service.ts` + test — load/save provider config
- `src/main/services/document-service.ts` + test — sha256 + filesystem + document 表
- `src/main/services/extraction-service.ts` + test — pipeline orchestrator
- `src/main/llm/stages/registry.ts` + test — stage map
- `src/main/llm/stages/china-utility.ts` + test — 1 个抽取 stage
- `src/main/ipc/handlers/settings.ts` — settings + LLM ping IPC
- `src/main/ipc/handlers/document.ts` — upload + list + extraction IPC
- `src/renderer/components/SettingsDrawerContent.tsx` — drawer 内容（provider form）
- `src/renderer/components/DocumentsUpload.tsx` — drag-drop upload
- `src/renderer/components/ExtractionReview.tsx` — review detail（左 PDF + 右 JSON + Confirm 按钮）
- `src/renderer/lib/api/settings.ts`, `document.ts` — IPC wrappers
- `src/renderer/routes/documents.tsx` — 列表页
- `src/renderer/routes/documents.$id.tsx` — review detail（或者 modal）

**修改：**
- `src/shared/types.ts` — 加 provider config + extraction 相关 zod schemas
- `src/main/ipc/types.ts` — `IpcTypeMap` 加 ~10 channel
- `src/main/ipc/context.ts` — 加 4 个新 service 注入
- `src/main/ipc/setup.ts` — register 2 new handler groups
- `src/preload/bridge.ts` — allowlist 加新 channel
- `src/renderer/components/Sidebar.tsx` — 加"文档"nav + 把 Moon 占位改成"Settings"齿轮（onClick 开 drawer）
- `src/renderer/components/command-palette.tsx` — 加 nav.documents + nav.settings command
- `src/renderer/routes/__root.tsx` — mount SettingsDrawer（顶层 controlled by global state 或 context）
- `messages/en.json` + `messages/zh-CN.json` — ~30 new keys
- `docs/specs/2026-05-08-carbonbook-design.md` — §2 Tech Stack pi-ai → AI SDK；§4 AI Pipeline 调整为 generateObject 流程；§9 MCP 不动

---

## §0 准备：Spec 更新 + dep install

### Task 0a: Spec §2/§4 update — pi-ai → AI SDK

**Files:** `docs/specs/2026-05-08-carbonbook-design.md`

`§2 Tech Stack 决定` 表把 `AI 抽象 | @earendil-works/pi-ai + 自家 LLMClient 包装` 改成：

```
| AI 抽象 | Vercel AI SDK 6 (`ai` + `@ai-sdk/{openai,anthropic,azure,deepseek,openai-compatible}`) + 自家 LLMClient 包装 |
```

`§2 关键架构决定` 加一段：

```
**8. AI provider 多路 = AI SDK + 凭证 main-only**
- 用 Vercel AI SDK 6 的 model 抽象（`openai('gpt-4o')` / `anthropic('claude-sonnet-4-5')` / `azure(...)` / `deepseek(...)` / `createOpenAICompatible(...)`）
- Phase 1b 替代 spec 初版选的 `@earendil-works/pi-ai`：AI SDK 6 zod 原生 + 12.5M weekly DL + Apache-2.0 + 独立 provider 小包（用户没选的 provider 不进 bundle）；pi-ai 只 64k DL + TypeBox + 单 version 包，bus-factor 不可接受
- 凭证存 OS keychain（Electron safeStorage，Phase 0 CredentialStore 抽象已有，Phase 1b 接实际后端）
- 所有 LLM 调用从 main 发起，renderer 通过 IPC 提交"用 AI 总结这个 PDF"请求；API key 永不进 renderer 进程
- 结构化抽取统一用 `generateObject({ model, schema: z.object({...}), prompt })`，schema 同时 enforce + parse；Phase 1c 升 `streamObject` 加渐进 UI
```

`§4 AI Pipeline` 把"五步流水线"的实现细节调整 generateObject 风格（原 spec 已是 stage 化设计，无大改）。

`§7 Bug bash — Phase 1b 内容`（如果 spec 有）暂不动，acceptance 在 Phase 1b deliverable 处补充。

- [ ] **Commit**

```bash
git add docs/specs/2026-05-08-carbonbook-design.md
git commit -m "docs(spec): §2 §4 — switch AI lib from pi-ai to Vercel AI SDK 6

pi-ai (single-version 64k DL TypeBox-based) replaced by AI SDK 6
(12.5M DL Apache-2.0 zod-native, 5 provider packages). Reasoning
recorded in §2 architectural decision #8.

Phase 1b task 0a/19."
```

---

### Task 0b: dep install

```bash
cd /Users/lxz/ws/personal/carbonbook
pnpm add ai @ai-sdk/openai @ai-sdk/anthropic @ai-sdk/azure @ai-sdk/deepseek @ai-sdk/openai-compatible pdf-parse
pnpm add -D @types/pdf-parse
```

验证 versions（写进 package.json）：
- `ai`: ^6.x
- `@ai-sdk/openai`: ^3.x
- `@ai-sdk/anthropic`: ^3.x
- `@ai-sdk/azure`: ^3.x
- `@ai-sdk/deepseek`: ^2.x
- `@ai-sdk/openai-compatible`: ^1.x
- `pdf-parse`: ^1.1.x

**`pdf-parse` 注意**：包内含 `test/data/*.pdf` 文件，import 时不要碰那条加载路径。我们要的是 `import pdfParse from 'pdf-parse'`，只用默认导出，传 Buffer，返回 `{ text, numpages, info, metadata }`。Phase 1b 只读 `text`。

- [ ] **Commit**

```bash
git add package.json pnpm-lock.yaml
git commit -m "deps: AI SDK 6 (5 providers) + pdf-parse for Phase 1b extraction pipeline

Phase 1b task 0b/19."
```

---

## §1 凭证后端

### Task 1: safeStorage backend wire-up

**Files:**
- Create: `src/main/credentials/safe-storage-backend.ts`
- Test: `tests/main/credentials/safe-storage-backend.test.ts`

把 Phase 0 `CredentialStore` 的 DI 接 Electron 实际 safeStorage + filesystem blob 存储。

**API**：

```ts
// src/main/credentials/safe-storage-backend.ts
import { safeStorage, app } from 'electron';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CredentialStore } from './safe-storage.js';

let singleton: CredentialStore | null = null;

export function getCredentialStore(): CredentialStore {
  if (singleton) return singleton;
  const dir = join(app.getPath('userData'), 'credentials');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

  singleton = new CredentialStore({
    safeStorage: {
      isEncryptionAvailable: () => safeStorage.isEncryptionAvailable(),
      encryptString: (s: string) => safeStorage.encryptString(s),
      decryptString: (b: Buffer) => safeStorage.decryptString(b),
    },
    readBlob: (key: string) => {
      const path = join(dir, `${key}.bin`);
      if (!existsSync(path)) return null;
      return readFileSync(path);
    },
    writeBlob: (key: string, blob: Buffer) => {
      const path = join(dir, `${key}.bin`);
      writeFileSync(path, blob, { mode: 0o600 });
    },
    platform: process.platform,
  });
  return singleton;
}

export function resetCredentialStoreForTest(): void {
  singleton = null;
}
```

**Critical context**：
- 文件权限 0o600（owner read/write only）—— 即使 OS keychain 解密的 blob 落盘，攻击者拿到文件也要 OS 用户身份才能读
- Key 命名约定：`llm.{provider}.apikey`（如 `llm.openai.apikey`、`llm.anthropic.apikey`）
- `getCredentialStore()` 单例：app 全局共享，避免每次 IPC 调用重建

**Test**：mock `electron.safeStorage` + `app.getPath` 验证 set/get roundtrip 写到正确路径。

- [ ] **Commit**

```bash
git add src/main/credentials/safe-storage-backend.ts tests/main/credentials/safe-storage-backend.test.ts
git commit -m "feat(credentials): safeStorage backend — Electron safeStorage + 0o600 file blobs

Wires Phase 0 CredentialStore abstraction to real macOS Keychain /
Windows Credential Manager backend. Singleton lifetime; blob path
\$userData/credentials/{key}.bin with owner-only permissions.

Phase 1b task 1/19."
```

---

### Task 2: CredentialService — IPC-facing wrapper

**Files:**
- Create: `src/main/services/credential-service.ts`
- Test: `tests/main/services/credential-service.test.ts`

为啥另起一个 service？`CredentialStore` 是底层抽象（set/get plaintext），`CredentialService` 加业务逻辑：（a）只允许特定 key prefix（`llm.*` 白名单），（b）`getMasked(key)` 返回 `sk-...xxxx` 给 UI 显示，避免 plaintext key 经 IPC 暴露给 renderer。

```ts
class CredentialService {
  constructor(private readonly ctx: { store: CredentialStore });

  set(key: string, plaintext: string): void;       // validates key prefix
  get(key: string): string | null;                  // main-only, never IPC-exposed
  getMasked(key: string): string | null;           // returns sk-...abcd (4 last chars) or null
  delete(key: string): void;                        // removes blob
  isAvailable(): boolean;                          // safeStorage.isEncryptionAvailable
}
```

**Key prefix whitelist**：`['llm.openai.', 'llm.anthropic.', 'llm.azure.', 'llm.deepseek.', 'llm.openai-compat.']`。Set/get/delete 用其他 prefix throw `Error('credential key not in allowlist')`。

**Test**: prefix check、mask format、roundtrip via mocked CredentialStore.

- [ ] **Commit**: `feat(service): CredentialService — IPC-safe wrapper with prefix allowlist + masking`

---

## §2 LLMClient + Provider config

### Task 3: Provider config zod schema

**Files:** modify `src/shared/types.ts`

Append:

```ts
// AI provider config (Phase 1b)
// Discriminated union over provider kinds; each shape has its own required fields.

export const openAiProviderConfig = z.object({
  provider: z.literal('openai'),
  model: z.string().default('gpt-4o-mini'),
  apiKeyKeyref: z.literal('llm.openai.apikey'),  // const, points to credential store key
});

export const anthropicProviderConfig = z.object({
  provider: z.literal('anthropic'),
  model: z.string().default('claude-sonnet-4-5'),
  apiKeyKeyref: z.literal('llm.anthropic.apikey'),
});

export const azureProviderConfig = z.object({
  provider: z.literal('azure'),
  model: z.string(),
  apiKeyKeyref: z.literal('llm.azure.apikey'),
  resourceName: z.string().min(1),
  apiVersion: z.string().default('2024-08-01-preview'),
});

export const deepseekProviderConfig = z.object({
  provider: z.literal('deepseek'),
  model: z.string().default('deepseek-chat'),
  apiKeyKeyref: z.literal('llm.deepseek.apikey'),
});

export const openAiCompatProviderConfig = z.object({
  provider: z.literal('openai-compat'),
  model: z.string().min(1),
  apiKeyKeyref: z.literal('llm.openai-compat.apikey'),
  baseUrl: z.string().url(),
  name: z.string().default('Custom'),
});

export const providerConfig = z.discriminatedUnion('provider', [
  openAiProviderConfig,
  anthropicProviderConfig,
  azureProviderConfig,
  deepseekProviderConfig,
  openAiCompatProviderConfig,
]);

export type ProviderConfig = z.infer<typeof providerConfig>;
export type ProviderKind = ProviderConfig['provider'];
```

- [ ] **Commit**: `feat(types): provider config discriminated union (5 providers)`

---

### Task 4: LLMClient — AI SDK wrapper

**Files:**
- Create: `src/main/llm/llm-client.ts`
- Test: `tests/main/llm/llm-client.test.ts`

```ts
// src/main/llm/llm-client.ts
import { createAnthropic } from '@ai-sdk/anthropic';
import { createAzure } from '@ai-sdk/azure';
import { createDeepSeek } from '@ai-sdk/deepseek';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateObject, type LanguageModel } from 'ai';
import type { z } from 'zod';
import type { ProviderConfig } from '@shared/types.js';
import type { CredentialService } from '@main/services/credential-service.js';

export class ProviderNotConfiguredError extends Error {
  constructor(provider: string) {
    super(`No API key set for provider: ${provider}`);
    this.name = 'ProviderNotConfiguredError';
  }
}

export class LLMClient {
  constructor(private readonly ctx: { credentials: CredentialService }) {}

  /**
   * Resolves a ProviderConfig + the credential store into an AI SDK model
   * instance. Throws if the API key isn't set.
   */
  private getModel(config: ProviderConfig): LanguageModel {
    const apiKey = this.ctx.credentials.get(config.apiKeyKeyref);
    if (!apiKey) throw new ProviderNotConfiguredError(config.provider);

    switch (config.provider) {
      case 'openai':
        return createOpenAI({ apiKey })(config.model);
      case 'anthropic':
        return createAnthropic({ apiKey })(config.model);
      case 'azure':
        return createAzure({
          apiKey,
          resourceName: config.resourceName,
          apiVersion: config.apiVersion,
        })(config.model);
      case 'deepseek':
        return createDeepSeek({ apiKey })(config.model);
      case 'openai-compat':
        return createOpenAICompatible({
          apiKey,
          baseURL: config.baseUrl,
          name: config.name,
        })(config.model);
    }
  }

  /**
   * Run a structured extraction. Schema + prompt come from the caller (usually
   * a Stage Registry entry). Returns the parsed object.
   */
  async extract<T>(
    config: ProviderConfig,
    schema: z.ZodType<T>,
    prompt: string,
  ): Promise<T> {
    const model = this.getModel(config);
    const result = await generateObject({ model, schema, prompt });
    return result.object;
  }

  /**
   * Lightweight health check — returns true if the provider answers a trivial
   * request. Used by Settings "Test connection" button.
   */
  async ping(config: ProviderConfig): Promise<{ ok: true } | { ok: false; error: string }> {
    try {
      const model = this.getModel(config);
      // 单字 prompt + 1 token output 验证 key + endpoint 可达
      await generateObject({
        model,
        schema: { type: 'object', properties: { ok: { type: 'boolean' } } } as never,
        prompt: 'Return {"ok": true}',
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'unknown error' };
    }
  }
}
```

**Test**：用 vitest 的 `vi.mock('ai', ...)` 把 `generateObject` mock 掉，验证：
- `extract()` 把 config 正确转成 model + 传 schema/prompt
- `ProviderNotConfiguredError` 在缺 key 时抛
- `ping()` 成功路径返回 `{ ok: true }`
- `ping()` 失败路径返回 `{ ok: false, error }`
- 5 个 provider 都 cover（discriminated union 每个 case）

- [ ] **Commit**: `feat(llm): LLMClient — AI SDK wrapper (5 providers, extract + ping)`

---

## §3 Settings UI + IPC

### Task 5: SettingsService

**Files:**
- Create: `src/main/services/settings-service.ts`
- Test: `tests/main/services/settings-service.test.ts`

Settings 数据持久化策略：
- **provider config**（不含 key）—— 写 `app.sqlite` 表 `setting`（Phase 0 migration 001 已建？检查；如果没有就用 KV style 表，或者直接序列化进单行表 `setting`）。需查 Phase 0 migration。
- **API key plaintext** —— 走 CredentialService（safeStorage 加密）。

API:

```ts
class SettingsService {
  constructor(private readonly ctx: {
    db: Database.Database;
    credentials: CredentialService;
  });

  // 写：拆 plaintext key + config，key 进 keychain，config 进 sqlite
  saveProviderConfig(config: ProviderConfig, apiKeyPlaintext: string): void;

  // 读：从 sqlite 拉 config，从 keychain 拉 mask 后的 key
  getProviderConfig(): (ProviderConfig & { apiKeyMasked: string | null }) | null;

  // 完整 config（含 plaintext key）— **main 进程内部用，永不经 IPC**
  getProviderConfigWithKey(): { config: ProviderConfig; apiKey: string } | null;

  // 清除
  clearProviderConfig(): void;
}
```

**Critical**：`getProviderConfigWithKey()` 是 main-only API（不暴露到 IPC handler）。LLMClient 在 main 进程内调它。`getProviderConfig()` 是给 renderer 看的，apiKeyMasked 形如 `sk-...abcd`。

**Migration check**：看 Phase 0 migration 001 有没有 `setting` 表，如果没有需要写 migration 009 加一张：

```sql
CREATE TABLE IF NOT EXISTS setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

Phase 0 plan task 25 提过 `setting` 表给 onboarding step 5 用，先 grep 确认：

```bash
grep -rn "CREATE TABLE setting" src/main/db/migrations/
```

如已有用现成。

- [ ] **Commit**: `feat(service): SettingsService — provider config split (sqlite plain / keychain key)`

---

### Task 6: Settings + LLM IPC handlers

**Files:**
- Modify: `src/main/ipc/types.ts`
- Create: `src/main/ipc/handlers/settings.ts`
- Modify: `src/main/ipc/setup.ts`, `context.ts`
- Modify: `src/preload/bridge.ts` (allowlist)

新 channels:

```ts
'settings:get-provider': () => (ProviderConfig & { apiKeyMasked: string | null }) | null;
'settings:save-provider': (input: { config: ProviderConfig; apiKey: string }) => void;
'settings:clear-provider': () => void;
'settings:ping-provider': (input: { config: ProviderConfig; apiKey?: string }) =>
  { ok: true } | { ok: false; error: string };
'settings:available': () => boolean;  // safeStorage.isEncryptionAvailable
```

**Critical**: `settings:ping-provider` 接受 optional `apiKey` —— UI 在用户输入 key 但还没保存时也能"Test connection"。如果 input 带 key，临时用，不持久化；如果没带，从 keychain 读。

**Handler**:

```ts
export function settingsHandlers(ctx: IpcContext): {
  [K in keyof IpcTypeMap]?: IpcTypeMap[K];
} {
  return {
    'settings:available': () => ctx.credentialService.isAvailable(),
    'settings:get-provider': () => ctx.settingsService.getProviderConfig(),
    'settings:save-provider': (input) => {
      const parsed = saveProviderInput.parse(input);
      ctx.settingsService.saveProviderConfig(parsed.config, parsed.apiKey);
    },
    'settings:clear-provider': () => ctx.settingsService.clearProviderConfig(),
    'settings:ping-provider': async (input) => {
      const parsed = pingInput.parse(input);
      // 临时挂 key 到 credentials（仅本次调用）
      if (parsed.apiKey) {
        ctx.credentialService.set(parsed.config.apiKeyKeyref, parsed.apiKey);
      }
      return ctx.llmClient.ping(parsed.config);
    },
  };
}
```

Allowlist + setup register 同 Phase 1a 模式。

- [ ] **Commit**: `feat(ipc): 5 channels — settings:* (provider config + ping)`

---

### Task 7: Renderer API wrapper + Sidebar Settings button + cmdk

**Files:**
- Create: `src/renderer/lib/api/settings.ts`
- Modify: `src/renderer/components/Sidebar.tsx`
- Modify: `src/renderer/components/command-palette.tsx`
- Modify: `messages/en.json` + `messages/zh-CN.json`

`settingsApi` wrapper（Phase 1a pattern）。

Sidebar 底部 Moon 占位改成"Settings"齿轮 icon：

```tsx
// before: Moon icon disabled button
// after:
import { Settings as SettingsIcon } from 'lucide-react';
// ...
<button type="button" onClick={openSettings} className="flex items-center gap-2 ...">
  <SettingsIcon className="h-4 w-4" />
  <span className="text-xs">{m.nav_settings()}</span>
</button>
```

`openSettings` 通过 React context 或全局 state 触发 SettingsDrawer 打开。最简：用 `@tanstack/store` 或者 React Context。**推荐**：simple Context (`SettingsDrawerContext`) 包在 __root.tsx 里，Sidebar consumer 调 `setOpen(true)`。

Cmdk 加 `nav.settings`：

```ts
{
  id: 'nav.settings',
  group: 'Navigation',
  label: 'Open Settings',
  onSelect: ({ close }) => { close(); openSettingsDrawer(); },  // imperative store call
},
```

i18n keys: `nav_settings`、`nav_documents`（提前加便于 task 13 用）。

- [ ] **Commit**: `feat(ui): Sidebar Settings button + cmdk + renderer API wrapper`

---

### Task 8: SettingsDrawerContent — provider config form

**Files:**
- Create: `src/renderer/components/SettingsDrawerContent.tsx`
- Modify: `src/renderer/routes/__root.tsx`（mount SettingsDrawer + provide context）

Drawer 内容：

```
Settings drawer
├─ AI Provider section
│  ├─ Provider dropdown (OpenAI / Anthropic / Azure / DeepSeek / OpenAI-compat)
│  ├─ [conditional] Azure: resourceName + apiVersion fields
│  ├─ [conditional] OpenAI-compat: baseUrl + name fields
│  ├─ Model name input (with default placeholder per provider)
│  ├─ API Key input (type=password; if saved, show "sk-...abcd Saved ✓ [Replace]"
│  │   [Replace] toggles to empty input)
│  ├─ "Test connection" button → runs settings:ping-provider with optional new key
│  │   → shows toast or inline result
│  └─ "Save" button → settings:save-provider
└─ (Future: theme / language / EF library version / license)
```

TanStack Form。**关键**：表单 disabled/enable 逻辑 + masked-key replace 流程要清晰：
- 初次进入：所有字段空，"Save" disabled until valid
- 已配置：fields 预填 config + key 显示 mask + "[Replace]" 按钮
- 点 [Replace]：清 key 字段，进入新 key 输入状态，Save 重新激活
- "Test connection" 任何时候点（带 valid form values）

**form state subscription**：用 `useStore(form.store, ...)` 订阅 provider 字段切 conditional fields，避免重蹈 Phase 1a 覆辙（参考 ActivityForm 的 fix commit `d3f1b31` 模式）。

**i18n**: ~15 keys（provider 5 个 label + form labels + buttons + 状态文案）。

- [ ] **Commit**: `feat(ui): SettingsDrawerContent — provider config form with masked-key replace`

---

## §4 Document + Extraction pipeline

### Task 9: DocumentService

**Files:**
- Create: `src/main/services/document-service.ts`
- Test: `tests/main/services/document-service.test.ts`

**Schema check**: Phase 0 migration 003 应已建 `document` + `extraction` 表。先 grep 确认：

```bash
grep -A 30 "CREATE TABLE document" src/main/db/migrations/003_extraction.sql
```

API:

```ts
class DocumentService {
  constructor(private readonly ctx: ServiceContext);

  // 写文件 + 算 sha256 + 插 document 行；如果已存在同 hash → 返回旧 doc id（dedupe）
  uploadFile(input: { filename: string; mimeType: string; bytes: Buffer }): Document;

  getById(id: string): Document | null;
  listAll(limit?: number): Document[];  // 按 created_at DESC
  delete(id: string): void;  // soft? hard? 看 schema 有没有 FK
}
```

**实现要点**：
- sha256 用 `node:crypto` `createHash('sha256').update(bytes).digest('hex')`
- 文件存 `<userData>/uploads/<sha[0:2]>/<sha>.<ext>` 路径（spec §2 决定 #4）
- `mimeType` 限 `application/pdf` for Phase 1b（其他抛错）
- Dedupe: 查 sha 已在 document 表 → 返回现有 row

**Test**: roundtrip + dedupe + invalid mimetype 抛错 + list 顺序。

- [ ] **Commit**: `feat(service): DocumentService — sha256 content-addressed storage + dedupe`

---

### Task 10: Stage Registry + china_utility stage

**Files:**
- Create: `src/main/llm/stages/types.ts` — `Stage` interface
- Create: `src/main/llm/stages/registry.ts` — stage map
- Create: `src/main/llm/stages/china-utility.ts`
- Test: `tests/main/llm/stages/china-utility.test.ts`

**Stage 抽象**：

```ts
// src/main/llm/stages/types.ts
import type { z } from 'zod';

export type Stage<T = unknown> = {
  id: string;                  // e.g. 'china_utility.v1'
  version: string;             // semver
  description: string;
  inputType: 'pdf_text' | 'image' | 'json';  // Phase 1b only 'pdf_text'
  schema: z.ZodType<T>;
  buildPrompt: (input: string) => string;
};
```

**china_utility stage**:

```ts
// src/main/llm/stages/china-utility.ts
import { z } from 'zod';
import type { Stage } from './types.js';

export const chinaUtilityExtraction = z.object({
  doc_type: z.literal('china_utility').describe('Must be the literal "china_utility" if confident this is a Chinese electricity bill'),
  supplier_name: z.string().describe('国网XX供电公司 or similar'),
  account_no: z.string().nullable().describe('User account number, if visible'),
  amount_kwh: z.number().positive().describe('Energy consumption in kWh (degrees, 度)'),
  amount_yuan: z.number().positive().nullable().describe('Total bill amount in CNY, if visible'),
  period_start: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Billing period start date (ISO YYYY-MM-DD)'),
  period_end: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('Billing period end date (ISO YYYY-MM-DD)'),
  confidence: z.enum(['high', 'medium', 'low']).describe('Your confidence in the extraction (medium if any field unclear; low if document looks unfamiliar)'),
});

export type ChinaUtilityExtraction = z.infer<typeof chinaUtilityExtraction>;

export const chinaUtilityStage: Stage<ChinaUtilityExtraction> = {
  id: 'china_utility.v1',
  version: '1.0.0',
  description: 'Chinese electricity bill (国网/南方电网 风格) — classify + extract',
  inputType: 'pdf_text',
  schema: chinaUtilityExtraction,
  buildPrompt: (pdfText) => `
You are extracting data from a Chinese electricity utility bill (中国电费单).

Text content from the PDF:
---
${pdfText}
---

Instructions:
- If this is NOT a Chinese electricity bill, return doc_type with confidence='low' but still attempt fields.
- "用电量" / "kWh" / "度" → amount_kwh
- "应收合计" / "电费" / "总金额" → amount_yuan (CNY)
- "抄表日期" / "计费起止" → period_start / period_end (parse to ISO YYYY-MM-DD)
- Common suppliers: 国家电网, 南方电网, etc.
- confidence='high' only if supplier_name, amount_kwh, period_start, period_end are all clearly visible and unambiguous.

Return the structured object directly.`,
};
```

**Registry**：

```ts
// src/main/llm/stages/registry.ts
import { chinaUtilityStage } from './china-utility.js';
import type { Stage } from './types.js';

export const stageRegistry: ReadonlyMap<string, Stage> = new Map([
  [chinaUtilityStage.id, chinaUtilityStage as Stage],
]);

export function getStage(id: string): Stage | undefined {
  return stageRegistry.get(id);
}

export function listStages(): Stage[] {
  return Array.from(stageRegistry.values());
}
```

**Test**: schema validates a representative chinese-bill JSON; rejects malformed (e.g. non-ISO date).

- [ ] **Commit**: `feat(llm): Stage Registry + china_utility v1 (extract + classify combined)`

---

### Task 11: ExtractionService — pipeline orchestrator

**Files:**
- Create: `src/main/services/extraction-service.ts`
- Test: `tests/main/services/extraction-service.test.ts`

API:

```ts
class ExtractionService {
  constructor(private readonly ctx: ServiceContext & {
    documentService: DocumentService;
    settingsService: SettingsService;
    llmClient: LLMClient;
  });

  // 主入口：跑 stage 抽取，落 extraction 表
  run(input: {
    document_id: string;
    stage_id: string;  // 'china_utility.v1' for now
  }): Promise<Extraction>;

  getById(id: string): Extraction | null;
  listByDocument(documentId: string): Extraction[];
  listPendingReview(limit?: number): Extraction[];  // status = 'review_needed'
  confirm(id: string): void;  // status: review_needed → confirmed
  discard(id: string): void;  // status: review_needed → discarded
}
```

**`run` 实现**（一次性，无 stream）：

```ts
async run({ document_id, stage_id }: ...): Promise<Extraction> {
  const doc = this.ctx.documentService.getById(document_id);
  if (!doc) throw new Error(`Document not found: ${document_id}`);

  const stage = getStage(stage_id);
  if (!stage) throw new Error(`Stage not found: ${stage_id}`);

  const providerConfig = this.ctx.settingsService.getProviderConfigWithKey();
  if (!providerConfig) throw new Error('AI provider not configured. Open Settings to set up.');

  // 读 PDF 文本
  const bytes = readFileSync(doc.storage_path);
  const pdf = await pdfParse(bytes);
  const pdfText = pdf.text;

  // Cache key: (document_sha256, stage_id, provider+model)
  const cacheKey = `${doc.sha256}|${stage.id}|${providerConfig.config.provider}:${providerConfig.config.model}`;
  const cached = this.findCached(cacheKey);
  if (cached) return cached;

  // 调 LLM
  const result = await this.ctx.llmClient.extract(
    providerConfig.config,
    stage.schema,
    stage.buildPrompt(pdfText),
  );

  // 写 extraction
  const id = newId();
  const ts = this.ctx.now();
  this.ctx.db.prepare(`
    INSERT INTO extraction (
      id, document_id, stage_id, stage_version,
      provider, model, prompt_version, cache_key,
      parsed_json, status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'review_needed', ?, ?)
  `).run(
    id, document_id, stage.id, stage.version,
    providerConfig.config.provider, providerConfig.config.model,
    stage.id /* prompt_version == stage.id for Phase 1b */,
    cacheKey, JSON.stringify(result), ts, ts,
  );

  return this.getById(id)!;
}
```

**Cache 命中**：如果同 `(document.sha256, stage_id, provider+model)` 之前已抽过 → 直接返回老 extraction，不调 LLM（spec §4 设计原则 #5）。

**`extraction` schema check**：先 grep migration 003 看实际列名。如果列名跟我假设的不一致，按 schema 实际改写。

**Test**: mock LLMClient + DocumentService + ContextDB；run 一次 → 行写进表 → 重跑同 doc 命中 cache → 不再调 LLM。

- [ ] **Commit**: `feat(service): ExtractionService — pipeline with sha256+stage+model cache`

---

### Task 12: Document + Extraction IPC handlers

**Files:**
- Modify: `src/main/ipc/types.ts`
- Create: `src/main/ipc/handlers/document.ts`
- Modify: `src/main/ipc/setup.ts`, `context.ts`
- Modify: `src/preload/bridge.ts`

Channels:

```ts
'document:upload': (input: { filename: string; mimeType: string; bytes: Uint8Array }) => Document;
'document:list': () => Document[];
'document:get-by-id': (input: { id: string }) => Document | null;

'extraction:run': (input: { document_id: string; stage_id: string }) => Extraction;
'extraction:list-pending': () => Extraction[];
'extraction:get-by-id': (input: { id: string }) => Extraction | null;
'extraction:confirm': (input: { id: string }) => void;
'extraction:discard': (input: { id: string }) => void;

'stages:list': () => Array<{ id: string; version: string; description: string }>;
```

**Critical**: `document:upload` 的 `bytes` 是 `Uint8Array`（IPC structured clone friendly），handler 转 `Buffer.from(bytes)` 再交给 service。

- [ ] **Commit**: `feat(ipc): 9 channels — document:* + extraction:* + stages:list`

---

### Task 13: Renderer API wrappers (document + extraction)

**Files:** `src/renderer/lib/api/document.ts`, `extraction.ts`

Phase 1a pattern 套。

- [ ] **Commit**: `feat(renderer): IPC wrappers for document / extraction`

---

## §5 UI

### Task 14: /documents route — upload + list

**Files:**
- Create: `src/renderer/routes/documents.tsx`
- Create: `src/renderer/components/DocumentsUpload.tsx`
- Test: `tests/renderer/documents.test.tsx`

UI:

```
Documents page
├─ DocumentsUpload (drag-drop zone)
│  └─ accept .pdf, on drop:
│      1. Read as ArrayBuffer → Uint8Array
│      2. document:upload → returns Document
│      3. extraction:run with stage_id='china_utility.v1' → returns Extraction
│      4. Toast 成功
│      5. Refresh list
└─ DocumentList (table)
   ├─ created_at | filename | sha (short) | extractions count | status badges
   └─ row click → navigate /documents/$id (or open Review drawer)
```

**Note**: 文件读 `File.arrayBuffer()` → `new Uint8Array(buffer)` 经 IPC 传 main。Electron structured clone 支持 Uint8Array，但大文件（>50MB）可能慢。Phase 1b 电费单一般 <500KB，无问题。

**Sidebar**: 加 "文档" nav link 到 `/documents`。

**Cmdk**: 加 `nav.documents` 命令。

- [ ] **Commit**: `feat(ui): /documents route + drag-drop upload + extraction trigger`

---

### Task 15: Document review detail — PDF preview + extraction JSON + Confirm

**Files:**
- Create: `src/renderer/routes/documents.$id.tsx`
- Create: `src/renderer/components/ExtractionReview.tsx`
- Test: `tests/renderer/documents-review.test.tsx`

Layout:

```
[ doc title + back to list ]
[ PDF preview (left, 50%) | Extraction (right, 50%) ]

Right pane:
├─ Stage badge: "china_utility.v1"
├─ Provider used: "openai · gpt-4o-mini"
├─ Confidence: high / medium / low (color coded)
├─ Extracted fields (read-only display):
│  - supplier_name
│  - amount_kwh
│  - amount_yuan
│  - period_start / period_end
├─ "Confirm → Add as activity" button (primary)
│  └─ Opens ActivityForm with prefilled values:
│      - emission_source: (user picks)
│      - reporting_period: (user picks)
│      - occurred_at_start = extraction.period_start
│      - occurred_at_end = extraction.period_end
│      - amount = extraction.amount_kwh
│      - unit = 'kWh'
│      - EF: (user picks from EF candidates as Phase 1a)
│      - notes = "Auto-extracted from: <filename>"
│      On submit → activity:create AND extraction:confirm (both)
└─ "Discard" button → extraction:discard (status → 'discarded')
```

**PDF preview**: Phase 1b 简化 — 用 `<iframe>` 或 `<embed>` 直接渲染 PDF（Chromium 内置 PDF viewer 可用）。后续 Phase 1c+ 升 `react-pdf` 更细控制。

**Prefill ActivityForm**: 复用 Phase 1a `ActivityForm` 组件，加 `initialValues` prop（如果之前没有）+ 顶层 `extractionId` prop 用于 confirm 联动。

```tsx
<ActivityForm
  onCancel={...}
  onSubmitSuccess={(activity) => {
    extractionApi.confirm({ id: extractionId });  // 联动
    navigate({ to: '/' });
  }}
  initialValues={{
    occurred_at_start: extraction.parsed_json.period_start,
    occurred_at_end: extraction.parsed_json.period_end,
    amount: extraction.parsed_json.amount_kwh,
    unit: 'kWh',
    notes: `Auto-extracted from: ${document.filename}`,
  }}
/>
```

ActivityForm 需要加 optional `initialValues` 支持 + `onSubmitSuccess(activity)` callback（之前只关闭 form）。

- [ ] **Commit**: `feat(ui): document review — PDF preview + extraction display + Confirm → ActivityForm prefill`

---

## §6 收尾

### Task 16: Migration 009 — setting table (if not already exists)

如果 Task 5 grep 确认 setting 表不存在，加一个 migration：

```sql
-- migrations/009_settings.sql
CREATE TABLE setting (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

如果已存在则 skip 这个 task。

- [ ] **Commit**: `feat(db): migration 009 — setting table` (conditional)

---

### Task 17: Tests — integration smoke

加一个 main-side integration test：

```ts
// tests/main/integration/extraction-pipeline.test.ts
// 1. Set up in-memory db + all services
// 2. Mock LLMClient.extract() to return a fixed china_utility result
// 3. Mock CredentialService to "have" an openai key
// 4. Upload a fake PDF (small Buffer) → document row created
// 5. extraction.run → extraction row with status=review_needed
// 6. Re-run same → cache hit, no second LLM call
// 7. extraction.confirm → status=confirmed
```

- [ ] **Commit**: `test: extraction pipeline integration smoke (mocked LLM)`

---

### Task 18: Acceptance + phase-1b tag

**Verification gate**:

```bash
pnpm typecheck
pnpm test   # ≥ 195 tests (162 + ~33 Phase 1b)
pnpm lint
pnpm build
```

**Dev session smoke**:

```bash
rm -rf ~/Library/Application\ Support/carbonbook/
cd ~/ws/personal/carbonbook && pnpm dev
```

清单：
- [ ] Onboarding 5 步过
- [ ] ⌘K → "Open Settings" → drawer 打开
- [ ] 选 OpenAI provider，填一个真 key，"Test connection" → toast "✓"
- [ ] Save → drawer 关掉
- [ ] /sources 创建一个 source（厂区电表，Scope 2, electricity.grid）
- [ ] /documents → 拖一张中国电费单 PDF → 几秒后列表出现一行
- [ ] 点 row → review 页：左 PDF 显示，右 extraction JSON 显示
  - supplier_name: "国网XX供电公司"
  - amount_kwh: 1000（之类）
  - period: 2025-XX → 2025-XX
- [ ] 点 "Confirm → Add as activity" → ActivityForm 弹出，amount/unit/dates 预填
- [ ] 选 emission_source + EF → 提交
- [ ] activity_data 落库 → dashboard CO2e 数字 +N kg
- [ ] DevTools console 无 IPC 报错

**SQL 验证**:

```bash
sqlite3 ~/Library/Application\ Support/carbonbook/app.sqlite "
  SELECT COUNT(*) FROM document;        -- 1
  SELECT COUNT(*) FROM extraction;      -- 1, status='confirmed'
  SELECT COUNT(*) FROM activity_data;   -- 1
  SELECT printf('%.2f', total_co2e_kg) FROM (
    SELECT SUM(computed_co2e_kg) AS total_co2e_kg FROM activity_data
  );  -- expect non-zero
"
```

- [ ] **Tag**:

```bash
git tag -a phase-1b -m "Phase 1b — AI extraction pipeline (china_utility v1)

Deliverable verified: user uploads Chinese electricity bill PDF →
Vercel AI SDK 6 + OpenAI extracts supplier/amount/period → human
review + Confirm → ActivityForm prefilled → activity_data + dashboard.

Scope: 1 doc type (china_utility.v1), 5 providers in code (smoke=OpenAI).
generateObject (one-shot, no streaming yet). PDF text only (no OCR).
Credentials via Electron safeStorage; main-only key access.

Not in Phase 1b: streaming UI, OCR fallback, additional doc prompts
(fuel/freight/steel), OAuth subscriptions, cost tracking.

Sprint plan: docs/plans/2026-05-12-carbonbook-phase-1b-ai-extraction.md"
```

---

## Sprint scope 摘要

| Task | 内容 | 估时 |
|---|---|---|
| 0a | Spec §2 §4 update | 30 min |
| 0b | dep install | 10 min |
| 1 | safeStorage backend | 1.5 hr |
| 2 | CredentialService | 1 hr |
| 3 | Provider config zod | 30 min |
| 4 | LLMClient + 5 providers | 2 hr |
| 5 | SettingsService | 1.5 hr |
| 6 | Settings IPC | 1 hr |
| 7 | Sidebar Settings button + wrapper | 1 hr |
| 8 | SettingsDrawerContent form | 3 hr |
| 9 | DocumentService | 1.5 hr |
| 10 | Stage Registry + china_utility | 1.5 hr |
| 11 | ExtractionService | 2 hr |
| 12 | Document/Extraction IPC | 1 hr |
| 13 | Renderer wrappers | 30 min |
| 14 | /documents + upload | 2.5 hr |
| 15 | Review detail + ActivityForm prefill | 3 hr |
| 16 | Migration 009 (conditional) | 30 min |
| 17 | Integration test | 1 hr |
| 18 | Acceptance + tag | 1 hr |

**估总**：~25 hr 实施 + reviews，约 **4-5 个工作日**。

**测试增量**：162 → ~195+。

---

## 关键技术决定（写进 spec §2 第 8 条）

1. **AI SDK 6 替代 pi-ai**：zod 原生、12.5M weekly、Apache-2.0、独立 provider 包
2. **凭证 main-only**：API key 永远不进 renderer 进程；renderer 只能见 `sk-...abcd` mask
3. **Provider config split**：plaintext key → keychain；config 元数据 → sqlite
4. **Stage Registry in-memory**：Phase 1b 1 个 stage 就 hardcode；不做 DB-stored 注册表
5. **Cache key 三元组**：`(document.sha256, stage_id, provider+model)`，命中跳过 LLM 调用
6. **Confirm 联动**：extraction.confirm + activity:create 在 renderer 端是两个 IPC 调用，不是 atomic transaction —— Phase 1c 如果需要 atomic 再升

---

## 不在 Phase 1b 里、留给 Phase 1c+

- OCR fallback（Tesseract.js or LLM-vision，扫描件支持）
- 加油单 / 物流单 / 钢材 / 通勤 prompt
- `streamObject` 渐进 UI
- Cost / token 计量 + 显示
- Prompt 版本 A/B
- LLM 调用 retry / backoff
- OAuth subscription（Claude.ai / ChatGPT）
- EF FTS+LLM 智能匹配（替代 Phase 1a 的精确 match）
- calculation_snapshot freeze + Excel/PDF export
- MCP server v1
