# Phase 0 Task 23: Wizard step 2 (报告年度) + step 3 (组织边界)

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 3298-3469.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 23: Wizard step 2 (报告年度) + step 3 (组织边界)

**Files:**
- Create: `src/renderer/routes/onboarding/-components/StepReportingYear.tsx`
- Create: `src/renderer/routes/onboarding/-components/StepBoundary.tsx`
- Modify: `src/renderer/routes/onboarding/$step.tsx`
- Modify: `messages/en.json` + `messages/zh-CN.json`

- [ ] **Step 1: 加 messages**

en：
```json
"onboarding_step_year_title": "Reporting year",
"onboarding_step_year_body": "Default is the current year. Select the fiscal year you'll be calculating emissions for.",
"onboarding_step_boundary_title": "Organizational boundary",
"onboarding_step_boundary_body": "Per GHG Protocol Corporate Standard. Choose how you account for organizational boundaries.",
"onboarding_step_boundary_equity_share": "Equity Share — emissions allocated by ownership share of joint ventures.",
"onboarding_step_boundary_operational_control": "Operational Control — emissions from facilities you operate, regardless of ownership."
```

zh-CN：
```json
"onboarding_step_year_title": "报告年度",
"onboarding_step_year_body": "默认本年。选择你要核算排放的财年。",
"onboarding_step_boundary_title": "组织边界",
"onboarding_step_boundary_body": "依据 GHG Protocol Corporate Standard，选择组织边界核算方式。",
"onboarding_step_boundary_equity_share": "股权比例 — 按对合资公司持股比例分配排放。",
"onboarding_step_boundary_operational_control": "经营控制 — 算自己运营的设施排放，无论是否持股。多数小厂适用。"
```

- [ ] **Step 2: 写 StepReportingYear.tsx**

```tsx
import { useForm } from '@tanstack/react-form';
import { useNavigate } from '@tanstack/react-router';
import { Button } from '@renderer/components/ui/button';
import { Input } from '@renderer/components/ui/input';
import { Label } from '@renderer/components/ui/label';
import * as m from '@renderer/paraglide/messages';
import { loadDraft, saveDraft } from './wizardState';

export function StepReportingYear() {
  const navigate = useNavigate();
  const draft = loadDraft();
  const form = useForm({
    defaultValues: {
      reporting_year: draft.reporting_year ?? new Date().getFullYear() - 1,
    },
    onSubmit: async ({ value }) => {
      saveDraft({ ...draft, reporting_year: value.reporting_year });
      await navigate({ to: '/onboarding/$step', params: { step: '3' } });
    },
  });

  return (
    <form onSubmit={(e) => { e.preventDefault(); form.handleSubmit(); }} className="space-y-4 max-w-md">
      <h2 className="text-xl font-semibold">{m.onboarding_step_year_title()}</h2>
      <p className="text-sm text-muted-foreground">{m.onboarding_step_year_body()}</p>

      <form.Field
        name="reporting_year"
        children={(field) => (
          <div>
            <Label htmlFor="reporting_year">Year</Label>
            <Input
              id="reporting_year"
              type="number"
              min={2020}
              max={2030}
              value={field.state.value}
              onChange={(e) => field.handleChange(Number(e.target.value))}
            />
          </div>
        )}
      />

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => navigate({ to: '/onboarding/$step', params: { step: '1' } })}>
          {m.onboarding_back()}
        </Button>
        <Button type="submit">{m.onboarding_next()}</Button>
      </div>
    </form>
  );
}
```

- [ ] **Step 3: 写 StepBoundary.tsx**

```tsx
import { useNavigate } from '@tanstack/react-router';
import { useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import * as m from '@renderer/paraglide/messages';
import { loadDraft, saveDraft } from './wizardState';

type Boundary = 'equity_share' | 'operational_control';

export function StepBoundary() {
  const navigate = useNavigate();
  const draft = loadDraft();
  const [selected, setSelected] = useState<Boundary>(
    draft.company?.boundary_kind ?? 'operational_control',
  );

  const submit = () => {
    saveDraft({ ...draft, company: { ...draft.company!, boundary_kind: selected } });
    navigate({ to: '/onboarding/$step', params: { step: '4' } });
  };

  return (
    <div className="space-y-4 max-w-xl">
      <h2 className="text-xl font-semibold">{m.onboarding_step_boundary_title()}</h2>
      <p className="text-sm text-muted-foreground">{m.onboarding_step_boundary_body()}</p>

      <div className="space-y-2">
        <button
          type="button"
          className={`w-full rounded-md border p-4 text-left ${selected === 'operational_control' ? 'border-primary bg-primary/5' : 'border-border'}`}
          onClick={() => setSelected('operational_control')}
        >
          <strong>Operational Control</strong>
          <p className="mt-1 text-sm text-muted-foreground">{m.onboarding_step_boundary_operational_control()}</p>
        </button>

        <button
          type="button"
          className={`w-full rounded-md border p-4 text-left ${selected === 'equity_share' ? 'border-primary bg-primary/5' : 'border-border'}`}
          onClick={() => setSelected('equity_share')}
        >
          <strong>Equity Share</strong>
          <p className="mt-1 text-sm text-muted-foreground">{m.onboarding_step_boundary_equity_share()}</p>
        </button>
      </div>

      <div className="flex justify-between pt-2">
        <Button variant="outline" onClick={() => navigate({ to: '/onboarding/$step', params: { step: '2' } })}>
          {m.onboarding_back()}
        </Button>
        <Button onClick={submit}>{m.onboarding_next()}</Button>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: 改 $step.tsx 路由 step 2 / step 3**

```tsx
// 在 OnboardingShell 内：
if (step === '1') return <Page><StepCompanyInfo /></Page>;
if (step === '2') return <Page><StepReportingYear /></Page>;
if (step === '3') return <Page><StepBoundary /></Page>;
return <Navigate to="/onboarding/$step" params={{ step: '1' }} replace />;
```

import 加 StepReportingYear, StepBoundary。

- [ ] **Step 5: 跑 dev 验证 step 1→2→3 流程**

Run: `pnpm dev`
Expected: Step 1 填完 → Step 2 看到年度 → Step 3 看到边界二选一。

- [ ] **Step 6: Commit**

```bash
git add src/renderer/routes/onboarding/-components/StepReportingYear.tsx src/renderer/routes/onboarding/-components/StepBoundary.tsx src/renderer/routes/onboarding/$step.tsx messages/
git commit -m "Phase 0/Task 23: wizard step 2 (year) + step 3 (boundary)"
```

---

