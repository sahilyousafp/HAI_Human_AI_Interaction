import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { aexSession } from "./vite-plugin-aex-session.ts";
import { runtimeFiles } from "./vite-plugin-runtime-files.ts";

export default defineConfig({
  plugins: [react(), aexSession(), runtimeFiles()],
  optimizeDeps: {
    // Imported only by workers and on first use, which Vite does not scan at startup. Without this, the first
    // "Start camera" or the first voice request on a fresh dev server makes Vite bundle them and reload the page.
    include: ["@mediapipe/tasks-vision", "@huggingface/transformers", "@ricky0123/vad-web"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // The page carries the bridge token; no other origin may read it.
    cors: false,
  },
});
