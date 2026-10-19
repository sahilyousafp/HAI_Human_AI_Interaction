import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { aexSession } from "./vite-plugin-aex-session.ts";

export default defineConfig({
  plugins: [react(), aexSession()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // The page carries the bridge token; no other origin may read it.
    cors: false,
  },
});
