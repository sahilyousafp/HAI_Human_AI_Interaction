import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "agent-core",
    environment: "node",
    // These tests start processes (Claude Code stand-ins, PowerShell, ffmpeg): a shared CI runner takes several times
    // as long as a laptop to start one.
    testTimeout: process.env.CI ? 30_000 : 5_000,
    hookTimeout: process.env.CI ? 60_000 : 10_000,
    include: ["src/**/*.test.ts"],
  },
});
