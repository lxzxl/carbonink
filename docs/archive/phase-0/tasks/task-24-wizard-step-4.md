# Phase 0 Task 24: Wizard step 4 (第一个 Site)

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 3470-3589.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 24: Wizard step 4 (第一个 Site)

**Files:**
- Create: `src/renderer/routes/onboarding/-components/StepFirstSite.tsx`
- Modify: `src/renderer/routes/onboarding/$step.tsx`
- Modify: `messages/*.json`

- [ ] **Step 1: 加 messages**

en：
```json
"onboarding_step_site_title": "Add your first site",
"onboarding_step_site_body": "A site is a physical location (factory, office, warehouse). You'll add more later.",
"onboarding_step_site_name_zh": "Site name (中文)",
"onboarding_step_site_name_en": "Site name (English)",
"onboarding_step_site_address": "Address",
"onboarding_step_site_country": "Country code"
```

zh-CN：
```json
"onboarding_step_site_title": "添加第一个 Site",
"onboarding_step_site_body": "Site 是物理地点（工厂、办公楼、仓库）。后面可以加更多。",
"onboarding_step_site_name_zh": "Site 名称（中文）",
"onboarding_step_site_name_en": "Site 名称（English）",
"onboarding_step_site_address": "地址",
"onboarding_step_site_country": "国家代码"
```

- [ ] **Step 2: 写 StepFirstSite.tsx**

```tsx
import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import * as m from '@renderer/paraglide/messages';
import { loadDraft, saveDraft } from './wizardState';

export function StepFirstSite() {
  const navigate = useNavigate();
  const draft = loadDraft();
  const form = useForm({
    defaultValues: {
      name_zh: draft.first_site?.name_zh ?? '',
      name_en: draft.first_site?.name_en ?? '',
      address: draft.first_site?.address ?? '',
      country_code: draft.first_site?.country_code ?? draft.company?.country_code ?? 'CN',
    },
    onSubmit: async ({ value }) => {
      saveDraft({ ...draft, first_site: value });
      await navigate({ to: '/onboarding/$step', params: { step: '5' } });
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4 max-w-md">
      <h2 className="text-xl font-semibold">{m.onboarding_step_site_title()}</h2>
      <p className="text-sm text-muted-foreground">{m.onboarding_step_site_body()}</p>

      <form.Field name="name_zh" children={(f) => (
        <div>
          <Label htmlFor="site_name_zh">{m.onboarding_step_site_name_zh()}</Label>
          <Input id="site_name_zh" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />
        </div>
      )} />

      <form.Field name="name_en" children={(f) => (
        <div>
          <Label htmlFor="site_name_en">{m.onboarding_step_site_name_en()}</Label>
          <Input id="site_name_en" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />
        </div>
      )} />

      <form.Field name="address" children={(f) => (
        <div>
          <Label htmlFor="site_address">{m.onboarding_step_site_address()}</Label>
          <Input id="site_address" value={f.state.value} onChange={(e) => f.handleChange(e.target.value)} />
        </div>
      )} />

      <form.Field name="country_code" children={(f) => (
        <div>
          <Label htmlFor="site_country">{m.onboarding_step_site_country()}</Label>
          <Input id="site_country" value={f.state.value} onChange={(e) => f.handleChange(e.target.value.toUpperCase())} maxLength={3} />
        </div>
      )} />

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => navigate({ to: '/onboarding/$step', params: { step: '3' } })}>
          {m.onboarding_back()}
        </Button>
        <Button type="submit">{m.onboarding_next()}</Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: 改 $step.tsx 加 step 4 路由**

```tsx
if (step === '4') return <Page><StepFirstSite /></Page>;
```

- [ ] **Step 4: 跑 dev**

Run: `pnpm dev`
Expected: Step 4 显示 site 表单，填完跳到 step 5（暂回 step 1，等下个 task 加）。

- [ ] **Step 5: Commit**

```bash
git add src/renderer/routes/onboarding/-components/StepFirstSite.tsx src/renderer/routes/onboarding/$step.tsx messages/
git commit -m "Phase 0/Task 24: wizard step 4 (first site)"
```

---

