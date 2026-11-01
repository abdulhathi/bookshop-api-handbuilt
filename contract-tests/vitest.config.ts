import { defineConfig } from 'vitest/config';

// One server, shared state: run the suite file by file, test by test.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts'],
    fileParallelism: false,
    testTimeout: 20_000,
  },
});
