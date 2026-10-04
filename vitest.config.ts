import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    setupFiles: ['src/test/setup.ts'],
    environmentMatchGlobs: [['src/test/typing.test.ts', 'jsdom']],
  },
});