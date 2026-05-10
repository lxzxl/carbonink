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
          globals: false,
        },
        resolve: { alias },
      }),
      defineProject({
        test: {
          name: 'preload',
          environment: 'happy-dom',
          include: ['tests/preload/**/*.test.{ts,tsx}'],
          globals: false,
        },
        resolve: { alias },
      }),
      defineProject({
        test: {
          name: 'node',
          environment: 'node',
          include: ['tests/main/**/*.test.{ts,tsx}', 'tests/shared/**/*.test.{ts,tsx}'],
          globals: false,
        },
        resolve: { alias },
      }),
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
    },
  },
  resolve: { alias },
});
