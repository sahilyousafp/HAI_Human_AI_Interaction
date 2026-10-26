import { defineConfig } from "astro/config";

export default defineConfig({
  site: "https://hai.spairl.si",
  output: "static",
  trailingSlash: "always",
  build: { format: "directory" },
  devToolbar: { enabled: false },
  // `catalyst serve` runs `astro dev --port $ZC_SLATE_PORT`, which Windows shells pass through unexpanded, so
  // read the port it proxies to from the environment instead.
  server: { port: Number(process.env.ZC_SLATE_PORT) || 4321 },
});
