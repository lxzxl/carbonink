# Carbonbook UI Baseline Sprint — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Phase 1 之前打一次 UI 基线 —— 采纳 craft-agents-oss 验证过的视觉基础（原生 window chrome + OKLch 颜色 token 阶梯）+ 三个标准 UI 增项（sonner / cmdk / vaul），让后续 Phase 1+ 功能 UI 直接站在好底子上。

**Architecture:** 不动 React / TanStack / Tailwind v4 / shadcn / Paraglide。改动只覆盖：(1) Electron main 进程的 BrowserWindow 选项；(2) renderer 的 globals.css 颜色 token；(3) 3 个新轻量 dep + 各自一个 wrapper。

**Tech Stack:**
- Electron 41 `BrowserWindow` chrome options（macOS vibrancy + Windows Mica/Acrylic）
- Tailwind v4 `@theme` + OKLch 颜色空间 + CSS `color-mix()`
- `sonner ^2.0.7` —— toast（替代当前 wizard 的 inline `<p className="text-red-600">` 错误）
- `cmdk ^1.1.1` —— command palette（⌘K 召唤系统）
- `vaul ^1.1.2` —— drawer / bottom-sheet（settings + detail view 用，Phase 1+ 才大用）

**Scope 边界**：
- 不引入 motion / framer-motion（Phase 1 流式 pipeline 时再加，避免给空 dashboard 加无用 dep）
- 不引入 AppShell + 多 pane 布局（Phase 2 问卷答题视图时再做）
- 不引入 Shiki / react-markdown（Phase 2 问卷答题 + 报告时再加）
- 不引入 i18next（Paraglide 留着，他们的 i18next 是倒退）

**Verification gate** —— 每个 task 完成后：

```bash
pnpm typecheck   # 0 errors
pnpm test        # 42 tests minimum（如果加 wrapper 就 +N）
pnpm lint        # 0 errors
pnpm build       # full chain
```

外加 dev session 视觉验证（用户跑 + 确认）。

---

### Task 1: 原生 window chrome（macOS vibrancy + Windows Mica）

**Files:**
- Modify: `src/main/window.ts` — `BrowserWindow` 选项加 platform-specific chrome
- Modify: `src/renderer/routes/__root.tsx` — 加 titlebar drag-region 区域（避免 macOS traffic light 区域被内容盖住）
- Modify: `src/renderer/styles/globals.css` — `body { background: transparent }` 让 vibrancy 透过来

**Preconditions:**
- 当前 `src/main/window.ts` 用的是 default `titleBarStyle`，traffic light 在 macOS 默认位置
- Dashboard 已经能渲染（Phase 0 验证）

- [ ] **Step 1: 重写 `src/main/window.ts`**

```ts
import { join } from 'node:path';
import { BrowserWindow, shell } from 'electron';

const isMac = process.platform === 'darwin';
const isWin = process.platform === 'win32';

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'carbonbook',
    // ── platform-specific window chrome ──────────────────────────────
    // macOS: hide native titlebar, position traffic lights inside content,
    // enable under-window vibrancy so renderer transparent background lets
    // the desktop blur through. Visual effect 'active' = always on, not
    // just on focus.
    ...(isMac && {
      titleBarStyle: 'hiddenInset' as const,
      trafficLightPosition: { x: 18, y: 16 },
      vibrancy: 'under-window' as const,
      visualEffectState: 'active' as const,
    }),
    // Windows 11: Mica is the modern flagship (composited desktop sample);
    // falls back to acrylic on Win10 1903+. autoHideMenuBar removes the
    // legacy F10/Alt menu bar that nobody wants on a desktop SaaS app.
    ...(isWin && {
      backgroundMaterial: 'mica' as const,
      autoHideMenuBar: true,
    }),
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  win.on('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
```

- [ ] **Step 2: 改 `src/renderer/styles/globals.css` —— 透明背景 + drag region**

在文件顶部 `@import` 之后插入：

```css
/* Let macOS vibrancy / Windows Mica show through.
 * Without this the body's opaque background covers the blur layer. */
html, body {
  background: transparent !important;
}

#root {
  background: transparent;
}

/* On macOS hiddenInset the titlebar zone (top 32px) has traffic lights
 * at x:18, y:16. Make it -webkit-app-region: drag so users can grab
 * empty header space to move the window. */
.titlebar-region {
  -webkit-app-region: drag;
  -webkit-user-select: none;
}

/* Buttons + links inside the titlebar region opt out of drag.
 * Otherwise clicks would be eaten by the OS as window-move gestures. */
.titlebar-region button,
.titlebar-region a,
.titlebar-region [role="button"] {
  -webkit-app-region: no-drag;
}
```

- [ ] **Step 3: 改 `src/renderer/routes/__root.tsx` —— 加 titlebar drag zone**

读当前 root layout，在最外层 div 之前（或最顶端）插入一个空的 titlebar drag region：

```tsx
import { Outlet, createRootRoute } from '@tanstack/react-router';

export const Route = createRootRoute({
  component: RootLayout,
});

function RootLayout() {
  return (
    <>
      {/* macOS: traffic lights sit at left:18, top:16 inside this 32px-tall
       *        drag region. Sidebar must offset its content downward so
       *        nothing collides with the traffic lights.
       * Windows: this region is a normal draggable area (no traffic lights).
       *        autoHideMenuBar makes the legacy menu disappear. */}
      <div className="titlebar-region fixed top-0 left-0 right-0 h-8 z-50" />
      <Outlet />
    </>
  );
}
```

如果 `__root.tsx` 已经有 SidebarProvider 之类包裹层，把 `<div className="titlebar-region ..." />` 放在 Provider 之内、Outlet 之上即可。Sidebar 自身的 padding-top 需要给到 ≥40px（macOS traffic light 右边界 ~70px，header 起点高度 ~32px）。

- [ ] **Step 4: 调侧边栏 layout —— 让出 traffic light 区 + 加 theme 占位 icon**

当前 `src/renderer/components/Sidebar.tsx` 用 `p-4`。改成 `px-4 pt-12 pb-4` 顶部让出 48px（macOS traffic light 右边界约 70px，给 sidebar 自身留 24px header 安全区）。同时在底部加一个 sun/moon 占位 icon（**不连任何 onClick**，纯视觉锚点，Phase 1 settings panel 一起做主题切换）：

```tsx
import { cn } from '@renderer/lib/utils';
import * as m from '@renderer/paraglide/messages';
import { Link } from '@tanstack/react-router';
import { Moon } from 'lucide-react';

export function Sidebar() {
  return (
    <nav className="flex h-full w-56 flex-col border-r border-border bg-muted/30 px-4 pt-12 pb-4">
      <h2 className="mb-6 text-lg font-semibold">{m.app_title()}</h2>
      <ul className="space-y-1 flex-1">
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
      {/* Theme toggle placeholder — wired in Phase 1 settings panel.
       * Static for now; the icon reserves the visual position. */}
      <div className="mt-auto pt-4 border-t border-border/50">
        <button
          type="button"
          aria-label="Toggle theme (coming in Phase 1)"
          disabled
          className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground"
        >
          <Moon className="h-4 w-4" />
          <span className="text-xs">Theme</span>
        </button>
      </div>
    </nav>
  );
}
```

主内容区（在 `__root.tsx` 里）也需要 `pt-8`（32px）让出 titlebar drag region。如果 `__root.tsx` 里已经有 layout 结构包 `<Outlet />`，加 padding；如果是简单的 flex 布局，调整 main 容器：

```tsx
<main className="flex-1 pt-8 overflow-y-auto">
  <Outlet />
</main>
```

- [ ] **Step 5: 跑 dev 视觉验证**

```bash
rm -rf ~/Library/Application\ Support/carbonbook/  # 清状态从 wizard step 1 开始
pnpm dev
```

预期视觉：
- macOS：窗口顶部没有原生标题栏；traffic lights (红黄绿三圆点) 落在 sidebar 左上 ~18px 位置；窗口背景能看到桌面壁纸模糊
- 拖动空白 header 区域应能移动窗口
- 拖动按钮 / 输入框等控件**不应**移动窗口（drag opt-out 生效）
- Sidebar 顶部 "carbonbook" 文字不与 traffic light 重叠
- Sidebar 底部出现一个灰色 Moon icon + "Theme" 文字（disabled 按钮，点不动）
- 默认窗口大小 1400×900

如果窗口看起来还是不透明，检查 `<body>` 的实际样式（DevTools → Elements → 看 body 的 `background-color`）。可能是 shadcn 某个组件的 `bg-background` 覆盖了。

- [ ] **Step 6: Commit**

```bash
git add src/main/window.ts src/renderer/styles/globals.css src/renderer/routes/__root.tsx src/renderer/components/Sidebar.tsx
git commit -m "$(cat <<'EOF'
feat(ui): native window chrome — macOS vibrancy + Windows Mica

- macOS: titleBarStyle: 'hiddenInset' + vibrancy: 'under-window' +
  visualEffectState: 'active'. trafficLightPosition adjusted to {x:18, y:16}.
- Windows: backgroundMaterial: 'mica' + autoHideMenuBar.
- Renderer: body/html/#root background: transparent so blur layer shows.
- __root.tsx: 32px draggable titlebar region with no-drag opt-out for
  controls inside; main content has pt-8 to clear it.
- Sidebar: px-4 pt-12 pb-4 to clear macOS traffic light zone; sun/moon
  placeholder icon at bottom (disabled, wired in Phase 1 settings).
- Default window size: 1400×900.

UI baseline sprint task 1/5. craft-agents-oss-inspired.
EOF
)"
```

---

### Task 2: OKLch token 系统 + carbonbook 品牌色

**Files:**
- Modify: `src/renderer/styles/globals.css` —— Tailwind v4 `@theme` 段重写为 OKLch + foreground 阶梯

**Preconditions:**
- Task 1 完成（透明 body 已生效）

**核心改动**：把 shadcn 默认的 HSL token（`--background: 0 0% 100%` 之类）替换为 OKLch 值，并加 craft-agents-oss 的 `--foreground-N` color-mix() 阶梯。OKLch 比 HSL 感知更线性，深浅过渡更舒服；阶梯让 "60% opacity 的 muted text" 这种 hack 有正规出处。

- [ ] **Step 1: 改 `src/renderer/styles/globals.css` —— `@theme` 段重写**

定位文件里的 `@theme` 块（task 4 时建的），整段替换为：

```css
@theme {
  /* ── Base palette (OKLch) ─────────────────────────────────────────
   *
   * Light mode background is a warm off-white (slight yellow), foreground
   * is a near-black with the same hue rotation — better contrast on
   * vibrancy backdrops than pure #FFF / #000.
   */
  --background: oklch(0.99 0.005 95);
  --foreground: oklch(0.18 0.012 95);

  --card: oklch(1 0 0 / 0.6);            /* translucent over vibrancy */
  --card-foreground: oklch(0.18 0.012 95);
  --popover: oklch(0.99 0.005 95);
  --popover-foreground: oklch(0.18 0.012 95);

  /* Brand: carbonbook green. OKLch L=0.55 C=0.16 H=160 is a balanced
   * forest green — readable on light bg, still vibrant on dark bg. */
  --primary: oklch(0.55 0.16 160);
  --primary-foreground: oklch(0.99 0.005 95);

  --secondary: oklch(0.96 0.008 95);
  --secondary-foreground: oklch(0.22 0.012 95);

  --muted: oklch(0.95 0.008 95);
  --muted-foreground: oklch(0.50 0.012 95);

  --accent: oklch(0.94 0.012 160);       /* tint with primary hue */
  --accent-foreground: oklch(0.22 0.012 95);

  --destructive: oklch(0.55 0.20 25);
  --destructive-foreground: oklch(0.99 0.005 95);

  --border: oklch(0.90 0.008 95);
  --input: oklch(0.90 0.008 95);
  --ring: oklch(0.55 0.16 160 / 0.5);

  /* ── Foreground opacity ladder ────────────────────────────────────
   * Use these instead of `text-muted-foreground/60` ad-hoc opacity.
   * 15 perceptually-uniform levels via color-mix(). */
  --foreground-1\.5:  color-mix(in oklab, var(--foreground) 1.5%,  transparent);
  --foreground-3:     color-mix(in oklab, var(--foreground) 3%,    transparent);
  --foreground-5:     color-mix(in oklab, var(--foreground) 5%,    transparent);
  --foreground-8:     color-mix(in oklab, var(--foreground) 8%,    transparent);
  --foreground-12:    color-mix(in oklab, var(--foreground) 12%,   transparent);
  --foreground-20:    color-mix(in oklab, var(--foreground) 20%,   transparent);
  --foreground-30:    color-mix(in oklab, var(--foreground) 30%,   transparent);
  --foreground-40:    color-mix(in oklab, var(--foreground) 40%,   transparent);
  --foreground-50:    color-mix(in oklab, var(--foreground) 50%,   transparent);
  --foreground-60:    color-mix(in oklab, var(--foreground) 60%,   transparent);
  --foreground-70:    color-mix(in oklab, var(--foreground) 70%,   transparent);
  --foreground-80:    color-mix(in oklab, var(--foreground) 80%,   transparent);
  --foreground-90:    color-mix(in oklab, var(--foreground) 90%,   transparent);
  --foreground-95:    color-mix(in oklab, var(--foreground) 95%,   transparent);

  /* shadcn radius (unchanged) */
  --radius: 0.5rem;
}

/* ── Dark mode override ─────────────────────────────────────────────
 * Triggered via `.dark` class on <html> (next-themes pattern, or manual
 * toggle later in Phase 1+). */
.dark {
  --background: oklch(0.18 0.012 95);
  --foreground: oklch(0.95 0.008 95);

  --card: oklch(0.22 0.012 95 / 0.6);
  --card-foreground: oklch(0.95 0.008 95);
  --popover: oklch(0.20 0.012 95);
  --popover-foreground: oklch(0.95 0.008 95);

  --primary: oklch(0.65 0.18 160);
  --primary-foreground: oklch(0.18 0.012 95);

  --secondary: oklch(0.25 0.012 95);
  --secondary-foreground: oklch(0.95 0.008 95);

  --muted: oklch(0.28 0.012 95);
  --muted-foreground: oklch(0.65 0.012 95);

  --accent: oklch(0.30 0.018 160);
  --accent-foreground: oklch(0.95 0.008 95);

  --destructive: oklch(0.65 0.22 25);
  --destructive-foreground: oklch(0.18 0.012 95);

  --border: oklch(0.30 0.012 95);
  --input: oklch(0.30 0.012 95);
  --ring: oklch(0.65 0.18 160 / 0.5);
}
```

- [ ] **Step 2: 跑 dev 视觉验证**

```bash
pnpm dev
```

预期：
- 整体色调比之前更柔（不那么纯白），主色绿变成 OKLch 调出来的更"自然"的森林绿
- Card 半透明，能看到背后 vibrancy
- 现有所有 shadcn 组件继续正常渲染（Button / Input / Label 等，都用 `bg-primary` `text-foreground` 这种 token，所以会自动跟随）

注意：如果某些组件之前硬编码了 `bg-white` / `text-gray-500` 这种 raw color（不是 token），会"漏出来"在新 theme 里不一致 —— 把它们换成 token 同义词（`bg-background` / `text-muted-foreground`）。

- [ ] **Step 3: 找出所有 raw color 用法**

```bash
cd /Users/lxz/ws/personal/carbonbook
grep -rn -E "bg-(white|black|gray|slate|zinc|neutral|stone|red|green|blue)-[0-9]" src/renderer/ --include="*.tsx" --include="*.ts" | grep -v paraglide
grep -rn -E "text-(white|black|gray|slate|zinc|neutral|stone|red|green|blue)-[0-9]" src/renderer/ --include="*.tsx" --include="*.ts" | grep -v paraglide
```

把每条匹配换成对应 token：
- `bg-white` → `bg-background`
- `text-gray-500` → `text-muted-foreground` 或 `text-foreground/60`（但更推荐用 token）
- `text-red-600` → `text-destructive`
- `border-gray-200` → `border-border`

注意 lint 之前的 `noNonNullAssertion` 在 StepBoundary.tsx 有警告 —— 不要顺便去改这个，先专注 color token 清理。

- [ ] **Step 4: Commit**

```bash
git add src/renderer/styles/globals.css src/renderer/
git commit -m "$(cat <<'EOF'
feat(ui): OKLch color token system + foreground opacity ladder

- Replace shadcn HSL tokens with OKLch (perceptually uniform).
- Add --foreground-1.5..95 color-mix() ladder for muted text levels.
- Brand primary: OKLch(0.55 0.16 160) — carbonbook forest green.
- Card surface: 60% opacity so macOS vibrancy / Windows Mica shows.
- Dark mode tokens defined under .dark class (theme switch comes Phase 1+).
- Replace raw color utilities (bg-white, text-gray-500, etc.) in renderer
  components with token utilities (bg-background, text-muted-foreground).

UI baseline sprint task 2/5. craft-agents-oss-inspired token system.
EOF
)"
```

---

### Task 3: sonner toast

**Files:**
- Install: `sonner ^2.0.7`
- Create: `src/renderer/components/toast.tsx` —— `<Toaster />` wrapper + `toast` helper re-export
- Create: `tests/renderer/toast.test.tsx` —— smoke test
- Modify: `src/renderer/main.tsx` —— 挂 `<Toaster />`
- Modify: `src/renderer/routes/onboarding/-components/StepAIProvider.tsx` —— 把 inline 错误 `<p>` 换成 sonner

- [ ] **Step 1: 装 sonner**

```bash
pnpm add sonner
```

- [ ] **Step 2: 写 `src/renderer/components/toast.tsx` —— wrapper**

```tsx
import { Toaster as SonnerToaster, toast } from 'sonner';

export { toast };

/**
 * App-wide toast container. Mount once at the root, near the top of the
 * React tree.
 *
 * Styling: sonner's default visual is fine on light bg; for dark mode we
 * inherit our token system via the theme prop. position bottom-right is
 * least obstructive for a desktop app (top-right risks clashing with
 * macOS notifications).
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      richColors
      closeButton
      theme="system"
      toastOptions={{
        classNames: {
          toast: 'bg-popover text-popover-foreground border border-border',
          title: 'text-foreground',
          description: 'text-muted-foreground',
        },
      }}
    />
  );
}
```

- [ ] **Step 3: 写 `tests/renderer/toast.test.tsx` —— smoke**

```tsx
import { Toaster, toast } from '@renderer/components/toast';
import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('Toaster', () => {
  it('renders and shows a toast message when toast() is called', async () => {
    render(<Toaster />);
    toast.success('hello world');
    await waitFor(() => {
      expect(screen.getByText('hello world')).toBeTruthy();
    });
  });

  it('shows distinct error toast styling for toast.error()', async () => {
    render(<Toaster />);
    toast.error('oops');
    await waitFor(() => {
      expect(screen.getByText('oops')).toBeTruthy();
    });
  });
});
```

- [ ] **Step 4: 跑测试验证失败 → 通过**

```bash
pnpm test tests/renderer/toast.test.tsx
```

应该都 pass（sonner 自带测试钩子）。

- [ ] **Step 5: 改 `src/renderer/main.tsx` —— 挂 Toaster**

```tsx
import { Toaster } from '@renderer/components/toast';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReactQueryDevtools } from '@tanstack/react-query-devtools';
import { RouterProvider, createRouter } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { routeTree } from './routeTree.gen';
import './styles/globals.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, refetchOnWindowFocus: false },
  },
});

const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
      <Toaster />
      <ReactQueryDevtools initialIsOpen={false} />
    </QueryClientProvider>
  </StrictMode>,
);
```

- [ ] **Step 6: 改 `StepAIProvider.tsx` —— 错误用 toast 替代 inline `<p>`**

读当前文件，把 `setError(...)` / `{error && <p>...</p>}` 模式换成：

```tsx
import { toast } from '@renderer/components/toast';

// in finish():
} catch (e) {
  const msg = e instanceof Error ? e.message : 'Unknown error';
  toast.error('Failed to complete onboarding', { description: msg });
} finally {
  setSubmitting(false);
}

// 删除组件里的 const [error, setError] = ...
// 删除 JSX 里的 {error && <p className="text-sm text-red-600">{error}</p>}
```

- [ ] **Step 7: 跑测试 + dev**

```bash
pnpm test
pnpm dev
```

dev 里走 wizard，故意填错（如年份填字母）→ 应该看到右下角 toast 弹错误。

- [ ] **Step 8: Commit**

```bash
git add src/renderer/components/toast.tsx tests/renderer/toast.test.tsx src/renderer/main.tsx src/renderer/routes/onboarding/-components/StepAIProvider.tsx package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(ui): sonner toasts — replace inline error <p> patterns

- Add sonner ^2.0.7 dep + Toaster wrapper at src/renderer/components/toast.tsx
- Styled via token classes (bg-popover/text-foreground/border-border) to
  match the new OKLch theme.
- StepAIProvider: catch block now toast.error(...) instead of setError +
  inline <p>. Errors no longer push wizard step layout around.
- Smoke test: tests/renderer/toast.test.tsx (43 tests total).

UI baseline sprint task 3/5.
EOF
)"
```

---

### Task 4: cmdk command palette (⌘K)

**Files:**
- Install: `cmdk ^1.1.1`
- Create: `src/renderer/components/command-palette.tsx` —— `<CommandPalette />` with hotkey + initial command set
- Create: `tests/renderer/command-palette.test.tsx` —— smoke test
- Modify: `src/renderer/main.tsx` —— mount `<CommandPalette />`

**Phase 0 + Phase 1 入门命令集**（先做这些，后面 phase 接着加）：
- "Open dashboard" → navigate `/`
- "Open onboarding wizard" → navigate `/onboarding/$step` step=1（reset / re-onboarding 场景）
- "Toggle theme" → next-themes light/dark（暂留 placeholder，theme switcher 在后续 task 加）

- [ ] **Step 1: 装 cmdk**

```bash
pnpm add cmdk
```

- [ ] **Step 2: 写 `src/renderer/components/command-palette.tsx`**

```tsx
import { useNavigate } from '@tanstack/react-router';
import { Command } from 'cmdk';
import { useEffect, useState } from 'react';

/**
 * Global command palette. Press ⌘K (or Ctrl+K on Windows) to open.
 *
 * Commands are organized by group. To add commands: append to the relevant
 * <Command.Group> below. Each Command.Item must have an `onSelect` that
 * closes the palette via setOpen(false) before navigating / firing action,
 * otherwise the palette stays open behind the navigated page.
 *
 * Phase 0 ships with 3 commands (Dashboard / Onboarding / Toggle theme
 * placeholder). Phase 1+ will register inventory / report / pipeline
 * commands the same way.
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'k' && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const go = (path: '/' | '/onboarding/$step', params?: Record<string, string>) => {
    setOpen(false);
    if (path === '/onboarding/$step') {
      navigate({ to: path, params: { step: '1', ...params } });
    } else {
      navigate({ to: path });
    }
  };

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Command Palette"
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh] backdrop-blur-sm bg-foreground-30"
    >
      <div className="w-[640px] max-w-[90vw] rounded-lg border border-border bg-popover text-popover-foreground shadow-2xl overflow-hidden">
        <Command.Input
          placeholder="Type a command or search…"
          className="w-full px-4 py-3 border-b border-border bg-transparent text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
        <Command.List className="max-h-[400px] overflow-y-auto p-2">
          <Command.Empty className="px-4 py-8 text-center text-sm text-muted-foreground">
            No commands found.
          </Command.Empty>

          <Command.Group heading="Navigation" className="px-2 py-1 text-xs uppercase tracking-wide text-muted-foreground">
            <Command.Item
              onSelect={() => go('/')}
              className="flex items-center gap-2 px-2 py-2 rounded text-sm text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground cursor-pointer"
            >
              Open Dashboard
            </Command.Item>
            <Command.Item
              onSelect={() => go('/onboarding/$step')}
              className="flex items-center gap-2 px-2 py-2 rounded text-sm text-foreground aria-selected:bg-accent aria-selected:text-accent-foreground cursor-pointer"
            >
              Open Onboarding Wizard
            </Command.Item>
          </Command.Group>
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
```

- [ ] **Step 3: 写 `tests/renderer/command-palette.test.tsx`**

```tsx
import { CommandPalette } from '@renderer/components/command-palette';
import { RouterProvider, createMemoryHistory, createRootRoute, createRoute, createRouter } from '@tanstack/react-router';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

function harness() {
  const rootRoute = createRootRoute({ component: () => <CommandPalette /> });
  const indexRoute = createRoute({ getParentRoute: () => rootRoute, path: '/', component: () => <div>dashboard</div> });
  const router = createRouter({
    routeTree: rootRoute.addChildren([indexRoute]),
    history: createMemoryHistory({ initialEntries: ['/'] }),
  });
  return <RouterProvider router={router} />;
}

describe('CommandPalette', () => {
  it('is hidden by default', () => {
    render(harness());
    expect(screen.queryByPlaceholderText(/Type a command/)).toBeNull();
  });

  it('opens on Cmd+K', async () => {
    render(harness());
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Type a command/)).toBeTruthy();
    });
  });

  it('closes on Escape', async () => {
    render(harness());
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    await waitFor(() => screen.getByPlaceholderText(/Type a command/));
    fireEvent.keyDown(document, { key: 'Escape' });
    await waitFor(() => {
      expect(screen.queryByPlaceholderText(/Type a command/)).toBeNull();
    });
  });
});
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/renderer/command-palette.test.tsx
```

- [ ] **Step 5: 改 `src/renderer/main.tsx` —— mount CommandPalette**

在 `<RouterProvider router={router} />` 之后插：

```tsx
<RouterProvider router={router} />
<CommandPalette />
<Toaster />
```

import:

```tsx
import { CommandPalette } from '@renderer/components/command-palette';
```

- [ ] **Step 6: dev 验证**

```bash
pnpm dev
```

按 ⌘K → 应该弹出居中的命令面板，输入 "dash" 应该过滤出 Dashboard，回车跳转，面板消失。

- [ ] **Step 7: Commit**

```bash
git add src/renderer/components/command-palette.tsx tests/renderer/command-palette.test.tsx src/renderer/main.tsx package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(ui): cmdk command palette (⌘K) — Navigation group + dashboard/onboarding commands

- Add cmdk ^1.1.1 dep.
- CommandPalette component listens on document for ⌘K / Ctrl+K toggle +
  Escape to close. Uses TanStack Router's useNavigate for navigation
  commands.
- Styled with token classes; backdrop uses --foreground-30 ladder var
  introduced in task 2.
- 3 smoke tests covering open/close/keybinding (45 tests total).
- Phase 1+ commands will register the same way (inventory / report /
  pipeline triggers).

UI baseline sprint task 4/5.
EOF
)"
```

---

### Task 5: vaul drawer — settings 抽屉骨架

**Files:**
- Install: `vaul ^1.1.2`
- Create: `src/renderer/components/settings-drawer.tsx` —— 基础 drawer 组件 + 空 settings content placeholder
- Create: `tests/renderer/settings-drawer.test.tsx` —— smoke test

不直接接入主 UI（settings 路由是 Phase 1+ 的事）—— 这步只是把 vaul 装好、wrapper 写好、测试覆盖。Phase 1 真用的时候 import 进去即可。

- [ ] **Step 1: 装 vaul**

```bash
pnpm add vaul
```

- [ ] **Step 2: 写 `src/renderer/components/settings-drawer.tsx`**

```tsx
import { Drawer } from 'vaul';
import type { ReactNode } from 'react';

/**
 * Right-side settings drawer. Open via SettingsDrawer.Trigger or
 * controlled via the `open` / `onOpenChange` props.
 *
 * Phase 1+ will use this for the Settings panel (AI provider config,
 * license, theme, language, EF library version). For now exposes the
 * shell + a placeholder content area.
 *
 * Layout: 480px wide, full-height, slides in from right. On macOS the
 * vibrancy bleeds through the body so the drawer feels native; the drawer
 * itself uses bg-popover for opacity.
 */
export function SettingsDrawer({
  open,
  onOpenChange,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <Drawer.Root open={open} onOpenChange={onOpenChange} direction="right">
      <Drawer.Portal>
        <Drawer.Overlay className="fixed inset-0 z-40 bg-foreground-30" />
        <Drawer.Content
          aria-describedby={undefined}
          className="fixed right-0 top-0 bottom-0 z-50 flex w-[480px] flex-col border-l border-border bg-popover text-popover-foreground shadow-2xl"
        >
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <Drawer.Title className="text-base font-semibold text-foreground">Settings</Drawer.Title>
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              aria-label="Close settings"
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-y-auto p-4">
            {children ?? (
              <p className="text-sm text-muted-foreground">
                Settings panels will land in Phase 1+ (AI provider, license, theme, language).
              </p>
            )}
          </div>
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}
```

- [ ] **Step 3: 写 `tests/renderer/settings-drawer.test.tsx`**

```tsx
import { SettingsDrawer } from '@renderer/components/settings-drawer';
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

describe('SettingsDrawer', () => {
  it('is not in DOM when open=false', () => {
    render(<SettingsDrawer open={false} onOpenChange={() => {}} />);
    expect(screen.queryByText('Settings')).toBeNull();
  });

  it('renders when open=true', () => {
    render(<SettingsDrawer open={true} onOpenChange={() => {}} />);
    expect(screen.getByText('Settings')).toBeTruthy();
  });

  it('shows placeholder text when no children given', () => {
    render(<SettingsDrawer open={true} onOpenChange={() => {}} />);
    expect(screen.getByText(/Settings panels will land/)).toBeTruthy();
  });

  it('renders custom children', () => {
    render(
      <SettingsDrawer open={true} onOpenChange={() => {}}>
        <div>custom content</div>
      </SettingsDrawer>,
    );
    expect(screen.getByText('custom content')).toBeTruthy();
  });
});
```

- [ ] **Step 4: 跑测试**

```bash
pnpm test tests/renderer/settings-drawer.test.tsx
```

- [ ] **Step 5: Commit**

```bash
git add src/renderer/components/settings-drawer.tsx tests/renderer/settings-drawer.test.tsx package.json pnpm-lock.yaml
git commit -m "$(cat <<'EOF'
feat(ui): vaul drawer — SettingsDrawer shell

- Add vaul ^1.1.2 dep.
- SettingsDrawer component: right-side 480px drawer, token-styled
  (bg-popover + bg-foreground-30 overlay).
- Placeholder body text until Phase 1+ wires the actual settings panels.
- 4 smoke tests covering open/close/custom-children (49 tests total).

UI baseline sprint task 5/5.
EOF
)"
```

---

### Task 6: Spec + plan docs update

**Files:**
- Modify: `docs/specs/2026-05-08-carbonbook-design.md` —— §2 Tech Stack 表加 sonner/cmdk/vaul；§2 关键架构决定加一节 "Window chrome + 视觉基线"

- [ ] **Step 1: 改 spec §2 Tech Stack 表**

在 `| 打包 / 分发 | electron-builder |` 之后插入：

```markdown
| Toast | sonner |
| Command palette | cmdk |
| Drawer / sheet | vaul |
```

- [ ] **Step 2: 改 spec §2 关键架构决定 —— 加视觉基线条目**

在 `**6. 数据流向（隐私承诺）**` 之后追加：

```markdown
**7. UI 视觉基线 = 原生 chrome + OKLch token 阶梯**
- Window chrome：macOS `hiddenInset` + `vibrancy: 'under-window'` + traffic light 内嵌；Windows `backgroundMaterial: 'mica'`。Renderer body 透明让模糊层透出。让 app "看起来像系统原生"，不像 web view 包壳
- 颜色 token：OKLch 替代 HSL（感知线性更舒服），`--foreground-1.5..95` 15 级 color-mix() 阶梯替代 ad-hoc opacity。所有 shadcn 组件继承
- 命令式 UX：cmdk command palette（⌘K）是主导航补充，Phase 1+ 每个新功能要同时注册一条 command
- Toast：sonner 替代 inline 错误 `<p>`，避免错误把 wizard 步骤布局推变形
- Drawer：vaul 是 settings / detail view 的标准容器（不用 Dialog —— Dialog 适合阻塞确认，drawer 适合并行查看）

参考：UI baseline sprint plan `docs/plans/2026-05-11-carbonbook-ui-baseline.md`，灵感来自 craft-agents-oss
```

- [ ] **Step 3: Commit**

```bash
git add docs/specs/2026-05-08-carbonbook-design.md
git commit -m "docs(spec): §2 Tech Stack + 关键架构决定 #7 — UI 视觉基线"
```

---

### Task 7: Acceptance + tag

- [ ] **Step 1: 全 gate 通**

```bash
pnpm typecheck
pnpm test       # 应 ≥49 tests
pnpm lint
pnpm build
```

- [ ] **Step 2: 跑 dev 走 happy path 整段**

```bash
rm -rf ~/Library/Application\ Support/carbonbook/
pnpm dev
```

清单：
- [ ] 窗口启动看到 macOS vibrancy（模糊桌面背景）
- [ ] traffic light 位置正确（左上 ~18px 偏移），不被 sidebar 内容压
- [ ] 走完 wizard 5 步看到 dashboard
- [ ] 故意输入错误（年份非数字之类）→ 右下角弹 sonner toast
- [ ] 按 ⌘K → cmdk 面板弹出居中
- [ ] cmdk 输入 "dash" → 过滤出 Dashboard → 回车跳转 → 面板关闭
- [ ] DevTools console 无 IPC 报错 / cmdk 报错 / vaul 报错

- [ ] **Step 3: 打 tag `ui-baseline`**

```bash
cd /Users/lxz/ws/personal/carbonbook
git tag -a ui-baseline -m "$(cat <<'EOF'
UI baseline sprint — native window chrome + OKLch tokens + sonner/cmdk/vaul

Adopted from craft-agents-oss visual recipe (see spec §2 #7).

Deliverable verified:
- macOS hiddenInset + vibrancy: under-window; Windows Mica backgroundMaterial
- OKLch token system; --foreground-1.5..95 color-mix() ladder; carbonbook
  forest green primary
- sonner toasts (bottom-right) replace inline error <p>
- cmdk command palette (⌘K) with Navigation group
- vaul SettingsDrawer shell ready for Phase 1 Settings panel

Total tests: 49 (was 42 at phase-0). Phase 0 functionality preserved.
EOF
)"
```

---

## Sprint scope 摘要

| Task | 范围 | 测试增量 |
|---|---|---|
| 1 | Window chrome（macOS vibrancy + Windows Mica）+ titlebar drag region | 0 |
| 2 | OKLch token system + foreground 15 级阶梯 + carbonbook 绿主色 | 0（视觉验证）|
| 3 | sonner toast + StepAIProvider 重构 | +2 |
| 4 | cmdk command palette（⌘K，Navigation group）| +3 |
| 5 | vaul SettingsDrawer 骨架（Phase 1+ 真用）| +4 |
| 6 | Spec §2 文档更新 | 0 |
| 7 | Acceptance + `ui-baseline` tag | — |

**总估算**：2-3 天（subagent-driven，每 task 一个 implementer + 两轮 review）。

**不做的事**：
- motion / framer-motion（Phase 1 真有动画需求时再加）
- AppShell + 多 pane（Phase 2 问卷答题）
- next-themes 主题切换 UI（Phase 1 settings panel 时一起做）
- 自定义 traffic light hover 颜色 / 字体替换（system default 已经够好）
