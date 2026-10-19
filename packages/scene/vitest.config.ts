import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "scene",
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
