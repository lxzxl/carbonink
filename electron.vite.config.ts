import { resolve } from 'node:path';
import { paraglideVitePlugin as paraglide } from '@inlang/paraglide-js';
import { TanStackRouterVite } from '@tanstack/router-vite-plugin';
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
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
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
    root: 'src/renderer',
    build: {
      outDir: 'out/renderer',
    },
    server: {
      port: 5173,
    },
  },
});
