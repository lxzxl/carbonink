import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
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
        '@modelcontextprotocol/sdk',
        /^@modelcontextprotocol\/sdk\/.*/,
      ],
      output: { format: 'cjs', exports: 'auto' },
    },
    minify: false,
  },
});
