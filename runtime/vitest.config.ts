import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    include: ["test/**/*.test.ts"],
    exclude: ["**/node_modules/**"],
    testTimeout: 15_000,
    hookTimeout: 15_000,
    pool: "forks",
    maxWorkers: 2,
    minWorkers: 1,
  },
});
