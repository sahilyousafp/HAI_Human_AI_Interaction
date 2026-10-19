import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "bridge",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
