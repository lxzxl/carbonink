# Phase 0 Task 25: Wizard step 5 (AI Provider 占位) + 完成提交

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 3590-3733.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 25: Wizard step 5 (AI Provider 占位) + 完成提交

**Files:**
- Create: `src/renderer/routes/onboarding/-components/StepAIProvider.tsx`
- Modify: `src/renderer/routes/onboarding/$step.tsx`
- Modify: `messages/*.json`

per spec §11 Phase 0：AI provider 配置在 wizard 第 5 步是 skeleton（凭证存储 Phase 1 完整接 pi-ai 时再做）。

- [ ] **Step 1: 加 messages**

en：
```json
"onboarding_step_ai_title": "AI provider",
"onboarding_step_ai_body": "carbonbook needs an AI provider to parse documents and answer questionnaires. You can configure this later in Settings; skipping is fine for now.",
"onboarding_step_ai_skip": "Skip for now (configure later in Settings)",
"onboarding_step_ai_byot": "I have an API key (configure in Settings after onboarding)",
"onboarding_finish": "Finish",
"onboarding_creating": "Creating organization…"
```

zh-CN：
```json
"onboarding_step_ai_title": "AI 提供方",
"onboarding_step_ai_body": "carbonbook 需要 AI 提供方解析文档和回答问卷。可以稍后在设置里配置；现在跳过也可以。",
"onboarding_step_ai_skip": "稍后在设置里配置",
"onboarding_step_ai_byot": "我有 API key（向导完成后到设置里填）",
"onboarding_finish": "完成",
"onboarding_creating": "正在创建组织…"
```

- [ ] **Step 2: 写 StepAIProvider.tsx (含 finish → 写库 → 跳 dashboard)**

```tsx
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import * as m from '@renderer/paraglide/messages';
import { loadDraft, clearDraft } from './wizardState';
import { trpc } from '@renderer/lib/trpc';

export function StepAIProvider() {
  const navigate = useNavigate();
  const draft = loadDraft();
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const completeOnboarding = trpc.organization.completeOnboarding.useMutation();
  const utils = trpc.useUtils();

  const finish = async (kind: 'byot' | 'skip') => {
    setSubmitting(true);
    setError(null);
    try {
      if (!draft.company || !draft.first_site || !draft.reporting_year) {
        setError('Wizard state incomplete; please restart from step 1.');
        return;
      }
      // 单个原子 mutation：org + site + reporting_period 在一个事务里。
      // 失败 → 全部 rollback，singleton 不会被半初始化数据卡住，用户可重试。
      await completeOnboarding.mutateAsync({
        organization: {
          name_zh: draft.company.name_zh,
          name_en: draft.company.name_en,
          industry: draft.company.industry,
          country_code: draft.company.country_code,
          boundary_kind: draft.company.boundary_kind,
        },
        first_site: {
          name_zh: draft.first_site.name_zh,
          name_en: draft.first_site.name_en,
          address: draft.first_site.address,
          country_code: draft.first_site.country_code,
        },
        reporting_period: {
          year: draft.reporting_year,
          granularity: 'annual',
        },
      });
      // ai_provider_kind 写到 localStorage，Phase 1 才接真凭证
      localStorage.setItem('carbonbook.onboarding.ai_provider_kind', kind);
      clearDraft();
      await utils.organization.hasAny.invalidate();
      await navigate({ to: '/' });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Unknown error');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4 max-w-xl">
      <h2 className="text-xl font-semibold">{m.onboarding_step_ai_title()}</h2>
      <p className="text-sm text-muted-foreground">{m.onboarding_step_ai_body()}</p>

      <div className="space-y-2">
        <Button className="w-full" disabled={submitting} onClick={() => finish('byot')}>
          {m.onboarding_step_ai_byot()}
        </Button>
        <Button className="w-full" variant="outline" disabled={submitting} onClick={() => finish('skip')}>
          {m.onboarding_step_ai_skip()}
        </Button>
      </div>

      {submitting && <p className="text-sm text-muted-foreground">{m.onboarding_creating()}</p>}
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex justify-start pt-2">
        <Button variant="outline" disabled={submitting} onClick={() => navigate({ to: '/onboarding/$step', params: { step: '4' } })}>
          {m.onboarding_back()}
        </Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 改 $step.tsx 加 step 5 路由**

```tsx
if (step === '5') return <Page><StepAIProvider /></Page>;
```

记得 `import { StepAIProvider } from './-components/StepAIProvider';`

- [ ] **Step 4: 跑端到端 dev 验证 Phase 0 deliverable**

Run: `pnpm dev`
Expected: 
1. 第一次启动 → 跳到 `/onboarding/1`
2. 填公司 → step 2 选年度 → step 3 选边界 → step 4 填 site → step 5 选 AI provider option → **单个原子 completeOnboarding mutation** 在 SQLite 一个事务里写入 organization + site + reporting_period → 跳回 `/`
3. Dashboard 显示 "Inventory Dashboard" 空态（不再是欢迎页）
4. 重启 app → Dashboard 直接显示 inventory 空态（不再走 onboarding，因为 organization 表已有数据）

- [ ] **Step 5: Commit**

```bash
git add src/renderer/routes/onboarding/-components/StepAIProvider.tsx src/renderer/routes/onboarding/$step.tsx src/renderer/routeTree.gen.ts messages/
git commit -m "Phase 0/Task 25: wizard step 5 (AI provider) + atomic completeOnboarding mutation → org+site+reporting_period persisted"
```

---

