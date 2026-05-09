# Phase 0 Task 19: Paraglide JS i18n

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 2671-2859.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 19: Paraglide JS i18n

**Files:**
- Create: `project.inlang/settings.json`
- Create: `messages/en.json`
- Create: `messages/zh-CN.json`
- Create: `src/renderer/lib/i18n.ts`
- Modify: `electron.vite.config.ts`
- Modify: `src/renderer/routes/__root.tsx`

- [ ] **Step 1: 装 Paraglide**

```bash
pnpm add -D @inlang/paraglide-js @inlang/paraglide-vite
```

- [ ] **Step 2: 写 project.inlang/settings.json**

```json
{
  "$schema": "https://inlang.com/schema/project-settings",
  "sourceLanguageTag": "en",
  "languageTags": ["en", "zh-CN"],
  "modules": [
    "https://cdn.jsdelivr.net/npm/@inlang/plugin-message-format@4.0.0/dist/index.js"
  ],
  "plugin.inlang.messageFormat": {
    "pathPattern": "./messages/{languageTag}.json"
  }
}
```

> ⚠️ 不要用 `@latest`——CDN 拉到的版本可能在升级时破 build。pin 到具体小版本号，需要升时显式改这里。Plan acceptance（Task 27）要求覆盖 clean install 场景。

- [ ] **Step 3: 写 messages/en.json**

```json
{
  "$schema": "https://inlang.com/schema/inlang-message-format",
  "app_title": "carbonbook",
  "dashboard_welcome_title": "Welcome to carbonbook",
  "dashboard_welcome_body": "You haven't set up your organization yet. The onboarding wizard will guide you next.",
  "dashboard_inventory_title": "Inventory Dashboard",
  "dashboard_inventory_body": "No emission data yet.",
  "nav_dashboard": "Dashboard",
  "loading": "Loading…"
}
```

- [ ] **Step 4: 写 messages/zh-CN.json**

```json
{
  "$schema": "https://inlang.com/schema/inlang-message-format",
  "app_title": "carbonbook",
  "dashboard_welcome_title": "欢迎使用 carbonbook",
  "dashboard_welcome_body": "你还没有设置组织。下一步引导向导会带你完成。",
  "dashboard_inventory_title": "排放清单仪表盘",
  "dashboard_inventory_body": "目前没有排放数据。",
  "nav_dashboard": "仪表盘",
  "loading": "加载中…"
}
```

- [ ] **Step 5: 改 electron.vite.config.ts 在 renderer 部分加 paraglide vite plugin**

```ts
import { paraglide } from '@inlang/paraglide-vite';
// ...
renderer: {
  plugins: [
    paraglide({
      project: './project.inlang',
      outdir: './src/renderer/paraglide',
    }),
    TanStackRouterVite(),
    react(),
  ],
  // ... 其余不变
},
```

- [ ] **Step 6: 写 src/renderer/lib/i18n.ts**

```ts
import * as runtime from '@renderer/paraglide/runtime';

export type Locale = 'en' | 'zh-CN';

const STORAGE_KEY = 'carbonbook.locale';

export function initLocale(): Locale {
  const stored = localStorage.getItem(STORAGE_KEY);
  const navigator = typeof window !== 'undefined' ? window.navigator.language : 'en';
  const locale: Locale = stored === 'zh-CN' || stored === 'en'
    ? stored
    : navigator.startsWith('zh') ? 'zh-CN' : 'en';
  runtime.setLanguageTag(locale);
  return locale;
}

export function setLocale(locale: Locale): void {
  localStorage.setItem(STORAGE_KEY, locale);
  runtime.setLanguageTag(locale);
}

export function currentLocale(): Locale {
  return runtime.languageTag() as Locale;
}
```

- [ ] **Step 7: 改 Sidebar + Dashboard 用 Paraglide messages**

`src/renderer/components/Sidebar.tsx`：

```tsx
import { Link } from '@tanstack/react-router';
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';

export function Sidebar() {
  return (
    <nav className="flex h-full w-56 flex-col border-r border-border bg-muted/30 p-4">
      <h2 className="mb-6 text-lg font-semibold">{m.app_title()}</h2>
      <ul className="space-y-1">
        <li>
          <Link
            to="/"
            className={cn(
              'block rounded-md px-3 py-2 text-sm hover:bg-muted',
              '[&.active]:bg-primary [&.active]:text-primary-foreground',
            )}
          >
            {m.nav_dashboard()}
          </Link>
        </li>
      </ul>
    </nav>
  );
}
```

`src/renderer/routes/index.tsx` Dashboard component 内部:

```tsx
import * as m from '@renderer/paraglide/messages';
// ...
function Dashboard() {
  const hasAny = trpc.organization.hasAny.useQuery();
  if (hasAny.isLoading) return <p className="text-muted-foreground">{m.loading()}</p>;
  if (!hasAny.data) {
    return (
      <div>
        <h1 className="text-2xl font-semibold">{m.dashboard_welcome_title()}</h1>
        <p className="mt-2 text-muted-foreground">{m.dashboard_welcome_body()}</p>
      </div>
    );
  }
  return (
    <div>
      <h1 className="text-2xl font-semibold">{m.dashboard_inventory_title()}</h1>
      <p className="mt-2 text-muted-foreground">{m.dashboard_inventory_body()}</p>
    </div>
  );
}
```

- [ ] **Step 8: 改 src/renderer/main.tsx 启动时调 initLocale**

```tsx
// 在 createRoot 调用前
import { initLocale } from '@renderer/lib/i18n';
initLocale();
```

- [ ] **Step 9: 跑 dev 验证**

Run: `pnpm dev`
Expected: 中文环境下渲染中文文案；切换 OS 语言到 en 后渲染英文。

- [ ] **Step 10: Commit**

```bash
git add project.inlang/ messages/ src/renderer/ electron.vite.config.ts package.json pnpm-lock.yaml
git commit -m "Phase 0/Task 19: Paraglide JS i18n (zh-CN + en, type-safe messages)"
```

---

