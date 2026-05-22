import { resolve } from 'node:path';
import { paraglideVitePlugin as paraglide } from '@inlang/paraglide-js';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, externalizeDepsPlugin } from 'electron-vite';

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
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      rollupOptions: {
        output: {
          format: 'cjs',
          entryFileNames: '[name].cjs',
        },
      },
    },
  },
  renderer: {
    plugins: [
      paraglide({
        project: './project.inlang',
        outdir: './src/renderer/paraglide',
      }),
      TanStackRouterVite({
        routesDirectory: resolve('src/renderer/routes'),
        generatedRouteTree: resolve('src/renderer/routeTree.gen.ts'),
      }),
      react(),
    ],
    resolve: {
      alias: {
        '@shared': resolve('src/shared'),
        '@renderer': resolve('src/renderer'),
      },
    },
    // Phase 5 — make the app version available to the renderer at build
    // time. UpdateSection uses this for the "Current version: …" label so
    // we don't have to round-trip an IPC call just to read `app.getVersion()`.
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version ?? '0.0.0'),
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
