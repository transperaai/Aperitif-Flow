import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    // Database test files share one Postgres cluster, and the auth shim creates
    // cluster-wide roles, so run the files one at a time.
    fileParallelism: false,
  },
});
