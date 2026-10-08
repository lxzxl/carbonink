import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  // The MCP entry pulls in `@shared/agent-bridge/socket-path` so both ends of
  // the bridge derive the address from one place. tsconfig `paths` covers
  // typecheck; vite needs its own alias or the build fails to resolve it.
  resolve: {
    alias: {
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  build: {
    outDir: 'out/mcp',
    emptyOutDir: true,
    target: 'node22',
    lib: {
      entry: resolve(__dirname, 'src/mcp/index.ts'),
      formats: ['cjs'],
      fileName: 'index',
    },
    rollupOptions: {
      external: [
        'node:sqlite',
        'node:fs',
        'node:os',
        'node:path',
        'node:crypto',
        // Agent bridge client. Without this vite substitutes the browser shim
        // and the build fails on the missing `connect` export.
        'node:net',
        '@modelcontextprotocol/sdk',
        /^@modelcontextprotocol\/sdk\/.*/,
      ],
      output: { format: 'cjs', exports: 'auto' },
    },
    minify: true,
  },
});
