# Phase 0 Task 3: electron-vite 脚手架 + Electron 主进程入口

> Extracted from `docs/plans/2026-05-09-carbonbook-phase-0-foundation.md` lines 335-518.
> Pre-split for context-budget reasons; canonical source remains the full plan.

---

### Task 3: electron-vite 脚手架 + Electron 主进程入口

**Files:**
- Create: `electron.vite.config.ts`
- Create: `src/main/index.ts`
- Create: `src/main/window.ts`
- Create: `src/preload/index.ts`
- Create: `src/renderer/index.html`
- Create: `src/renderer/main.tsx`

- [ ] **Step 1: 装依赖**

```bash
pnpm add electron@^33 electron-vite@^4 vite@^7 react@^18 react-dom@^18
pnpm add -D @types/react @types/react-dom @vitejs/plugin-react
```

- [ ] **Step 2: 写 electron.vite.config.ts**

```ts
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'node:path';

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@main': resolve('src/main'),
      },
    },
    build: {
      outDir: 'out/main',
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
    },
  },
  renderer: {
    plugins: [react()],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer'),
      },
    },
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
    },
    server: {
      port: 5173,
    },
  },
});
```

- [ ] **Step 3: 写 src/main/window.ts**

```ts
import { BrowserWindow, shell } from 'electron';
import { join } from 'node:path';

export function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 600,
    show: false,
    title: 'carbonbook',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
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

  if (process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'));
  }

  return win;
}
```

- [ ] **Step 4: 写 src/main/index.ts**

```ts
import { app, BrowserWindow } from 'electron';
import { createMainWindow } from './window.js';

let mainWindow: BrowserWindow | null = null;

app.whenReady().then(() => {
  mainWindow = createMainWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
```

- [ ] **Step 5: 写 src/preload/index.ts (暂为空 stub，后续 Task 加 trpc bridge)**

```ts
// preload script - electron-trpc bridge 在 Task 11 注入
export {};
```

- [ ] **Step 6: 写 src/renderer/index.html**

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline';" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>carbonbook</title>
</head>
<body>
  <div id="root"></div>
  <script type="module" src="./main.tsx"></script>
</body>
</html>
```

- [ ] **Step 7: 写 src/renderer/main.tsx (最简 hello world)**

```tsx
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

const root = document.getElementById('root');
if (!root) throw new Error('#root not found');

createRoot(root).render(
  <StrictMode>
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1>carbonbook</h1>
      <p>Phase 0 — Hello, world.</p>
    </div>
  </StrictMode>,
);
```

- [ ] **Step 8: 跑 dev，确认窗口打开**

Run: `pnpm dev`
Expected: Electron 窗口打开，显示 "carbonbook / Phase 0 — Hello, world."

- [ ] **Step 9: Commit**

```bash
git add electron.vite.config.ts src/ package.json pnpm-lock.yaml
git commit -m "Phase 0/Task 3: electron-vite scaffold (main+preload+renderer hello)"
```

---

