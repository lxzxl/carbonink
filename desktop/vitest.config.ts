import { resolve } from 'node:path';
import { defineConfig, defineProject } from 'vitest/config';

const alias = {
  '@shared': resolve('src/shared'),
  '@main': resolve('src/main'),
  '@renderer': resolve('src/renderer'),
  '@preload': resolve('src/preload'),
};

export default defineConfig({
  test: {
    projects: [
      defineProject({
        test: {
          name: 'renderer',
          environment: 'happy-dom',
          include: ['tests/renderer/**/*.test.{ts,tsx}'],
          exclude: ['tests/e2e/**'],
          globals: false,
        },
        resolve: { alias },
        // Mirror `electron.vite.config.ts` renderer `define`. Tests that
        // mount components reading `__APP_VERSION__` (e.g. UpdateSection
        // inside SettingsPage) need the same compile-time substitution
        // Vite performs in production builds.
        define: {
          __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
        },
      }),
      defineProject({
        test: {
          name: 'preload',
          environment: 'happy-dom',
          include: ['tests/preload/**/*.test.{ts,tsx}'],
          exclude: ['tests/e2e/**'],
          globals: false,
        },
        resolve: { alias },
      }),
      defineProject({
        test: {
          name: 'node',
          environment: 'node',
          include: [
            'tests/main/**/*.test.{ts,tsx}',
            'tests/shared/**/*.test.{ts,tsx}',
            'tests/mcp/**/*.test.{ts,tsx}',
            'tests/scripts/**/*.test.{ts,tsx,mjs}',
          ],
          exclude: ['tests/e2e/**'],
          globals: false,
        },
        // Main-process suites transitively import { app, dialog, BrowserWindow,
        // ... } from 'electron'. Under plain Node that module throws unless the
        // Electron binary was downloaded (postinstall writes path.txt) — which
        // CI skips, so the module is absent and the import crashes the suite at
        // load. Alias it to a benign stub so logic tests never depend on the
        // binary. tsc still uses the real electron types (this is runtime-only).
        // See tests/stubs/electron.ts for the full rationale.
        resolve: { alias: { ...alias, electron: resolve('tests/stubs/electron.ts') } },
      }),
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  resolve: { alias },
});
