# Phase 0 Task 22: Onboarding wizard route + step 1 (公司基本信息)

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 3027-3297.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 22: Onboarding wizard route + step 1 (公司基本信息)

**Files:**
- Create: `src/renderer/routes/onboarding/$step.tsx`
- Create: `src/renderer/routes/onboarding/-components/StepCompanyInfo.tsx`
- Modify: `messages/en.json`
- Modify: `messages/zh-CN.json`
- Modify: `src/renderer/routes/index.tsx` (无组织时跳到 onboarding)
- Create: `src/renderer/components/ui/input.tsx`
- Create: `src/renderer/components/ui/label.tsx`

- [ ] **Step 1: 添加 onboarding 相关 messages 到两个 locale (en / zh-CN)**

`messages/en.json` 加：
```json
"onboarding_title": "Onboarding",
"onboarding_step_company_title": "Company info",
"onboarding_step_company_name_zh": "Chinese name",
"onboarding_step_company_name_en": "English name",
"onboarding_step_company_industry": "Industry",
"onboarding_step_company_country": "Country",
"onboarding_back": "Back",
"onboarding_next": "Next",
"required_field": "Required"
```

`messages/zh-CN.json` 加对应中文：
```json
"onboarding_title": "引导设置",
"onboarding_step_company_title": "公司基本信息",
"onboarding_step_company_name_zh": "中文名",
"onboarding_step_company_name_en": "英文名",
"onboarding_step_company_industry": "行业",
"onboarding_step_company_country": "国家",
"onboarding_back": "返回",
"onboarding_next": "下一步",
"required_field": "必填"
```

- [ ] **Step 2: 加 shadcn ui input + label (copy from shadcn)**

`src/renderer/components/ui/input.tsx`：
```tsx
import * as React from 'react';
import { cn } from '@renderer/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type, ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-10 w-full rounded-md border border-border bg-background px-3 py-2 text-sm',
        'focus-visible:outline-none focus-visible:ring-2 disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';
```

`src/renderer/components/ui/label.tsx`：
```tsx
import * as React from 'react';
import { cn } from '@renderer/lib/utils';

export const Label = React.forwardRef<
  HTMLLabelElement,
  React.LabelHTMLAttributes<HTMLLabelElement>
>(({ className, ...props }, ref) => (
  <label
    ref={ref}
    className={cn('text-sm font-medium leading-none', className)}
    {...props}
  />
));
Label.displayName = 'Label';
```

- [ ] **Step 3: 写 wizard state hook (轻量本地 state，无需 Store)**

`src/renderer/routes/onboarding/-components/wizardState.ts`：
```ts
import { z } from 'zod';

export const wizardDraft = z.object({
  company: z.object({
    name_zh: z.string().optional(),
    name_en: z.string().optional(),
    industry: z.string().optional(),
    country_code: z.string().min(2),
    boundary_kind: z.enum(['equity_share', 'operational_control']),
  }).optional(),
  reporting_year: z.number().int().min(2020).max(2030).optional(),
  first_site: z.object({
    name_zh: z.string().optional(),
    name_en: z.string().optional(),
    address: z.string().optional(),
    country_code: z.string().min(2),
  }).optional(),
  ai_provider_kind: z.enum(['byot', 'oauth', 'compat', 'skip']).optional(),
});
export type WizardDraft = z.infer<typeof wizardDraft>;

const STORAGE_KEY = 'carbonbook.onboarding.draft';

export function loadDraft(): WizardDraft {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return {};
  try { return wizardDraft.parse(JSON.parse(raw)); } catch { return {}; }
}

export function saveDraft(d: WizardDraft): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(d));
}

export function clearDraft(): void {
  localStorage.removeItem(STORAGE_KEY);
}
```

- [ ] **Step 4: 写 src/renderer/routes/onboarding/-components/StepCompanyInfo.tsx**

```tsx
import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import * as m from '@renderer/paraglide/messages';
import { loadDraft, saveDraft } from './wizardState';

export function StepCompanyInfo() {
  const navigate = useNavigate();
  const draft = loadDraft();
  const form = useForm({
    defaultValues: {
      name_zh: draft.company?.name_zh ?? '',
      name_en: draft.company?.name_en ?? '',
      industry: draft.company?.industry ?? '',
      country_code: draft.company?.country_code ?? 'CN',
      boundary_kind: (draft.company?.boundary_kind ?? 'operational_control') as 'equity_share' | 'operational_control',
    },
    onSubmit: async ({ value }) => {
      saveDraft({ ...draft, company: value });
      await navigate({ to: '/onboarding/$step', params: { step: '2' } });
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4 max-w-md">
      <h2 className="text-xl font-semibold">{m.onboarding_step_company_title()}</h2>

      <form.Field
        name="name_zh"
        children={(field) => (
          <div>
            <Label htmlFor="name_zh">{m.onboarding_step_company_name_zh()}</Label>
            <Input id="name_zh" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
          </div>
        )}
      />

      <form.Field
        name="name_en"
        children={(field) => (
          <div>
            <Label htmlFor="name_en">{m.onboarding_step_company_name_en()}</Label>
            <Input id="name_en" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
          </div>
        )}
      />

      <form.Field
        name="industry"
        children={(field) => (
          <div>
            <Label htmlFor="industry">{m.onboarding_step_company_industry()}</Label>
            <Input id="industry" value={field.state.value} onChange={(e) => field.handleChange(e.target.value)} />
          </div>
        )}
      />

      <form.Field
        name="country_code"
        validators={{ onChange: ({ value }) => (value.length >= 2 ? undefined : m.required_field()) }}
        children={(field) => (
          <div>
            <Label htmlFor="country_code">{m.onboarding_step_company_country()}</Label>
            <Input id="country_code" value={field.state.value} onChange={(e) => field.handleChange(e.target.value.toUpperCase())} maxLength={3} />
          </div>
        )}
      />

      <div className="flex justify-end pt-2">
        <Button type="submit">{m.onboarding_next()}</Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 5: 写 src/renderer/routes/onboarding/$step.tsx (容器路由)**

```tsx
import { createFileRoute, useParams, Navigate } from '@tanstack/react-router';
import { StepCompanyInfo } from './-components/StepCompanyInfo';
import * as m from '@renderer/paraglide/messages';

export const Route = createFileRoute('/onboarding/$step')({
  component: OnboardingShell,
});

function OnboardingShell() {
  const { step } = useParams({ strict: false });

  if (step === '1') return <Page><StepCompanyInfo /></Page>;
  // 后续 step 在 Task 23-26 加；暂时跳回 1
  return <Navigate to="/onboarding/$step" params={{ step: '1' }} replace />;
}

function Page({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-2xl font-semibold">{m.onboarding_title()}</h1>
      {children}
    </div>
  );
}
```

- [ ] **Step 6: 改 src/renderer/routes/index.tsx 自动跳转**

```tsx
// Dashboard 改为：
function Dashboard() {
  const hasAny = trpc.organization.hasAny.useQuery();
  if (hasAny.isLoading) return <p className="text-muted-foreground">{m.loading()}</p>;
  if (!hasAny.data) return <Navigate to="/onboarding/$step" params={{ step: '1' }} />;
  return (
    <div>
      <h1 className="text-2xl font-semibold">{m.dashboard_inventory_title()}</h1>
      <p className="mt-2 text-muted-foreground">{m.dashboard_inventory_body()}</p>
    </div>
  );
}
```

记得在 `index.tsx` 顶部 import `Navigate` from `@tanstack/react-router`.

- [ ] **Step 7: 跑 dev 验证 step 1 + 触发 routeTree codegen**

Run: `pnpm dev`
Expected: 因为没组织，自动跳到 `/onboarding/1`，看到公司信息表单；填写并 Next 后路由到 `/onboarding/2`（暂会回到 1，因为后续 step 还没加）。Ctrl-C 后验证 `routeTree.gen.ts` 已加入 `/onboarding/$step` route：

```bash
grep -c "onboarding/\$step\|/onboarding/" src/renderer/routeTree.gen.ts
```
Expected: > 0

- [ ] **Step 8: Commit（含更新后的 routeTree.gen.ts）**

```bash
git add src/renderer/routes/onboarding/ src/renderer/routes/index.tsx src/renderer/components/ui/input.tsx src/renderer/components/ui/label.tsx src/renderer/routeTree.gen.ts messages/
git commit -m "Phase 0/Task 22: Onboarding wizard step 1 (company info) + routeTree gen update"
```

---

