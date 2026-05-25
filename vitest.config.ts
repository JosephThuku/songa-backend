import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    setupFiles: ["tests/setup.ts"],
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
    maxWorkers: 1,
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    sequence: {
      concurrent: false,
    },
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
