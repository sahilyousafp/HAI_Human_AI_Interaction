import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    name: "web",
    environment: "node",
    include: ["src/**/*.test.ts"],
    // phonemize imports its JSON data without an import attribute, which Node's loader refuses: let Vite load it.
    server: { deps: { inline: ["phonemize"] } },
  },
});
