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
    // The Rhino file reader is already a browser module; it is served as it is, and only the import worker loads it.
    exclude: ["rhino3dm"],
  },
  server: {
    host: "127.0.0.1",
    // AEX_WEB_PORT runs a second dev server (the end-to-end tests') beside yours.
    port: process.env.AEX_WEB_PORT ? Number(process.env.AEX_WEB_PORT) : 5173,
    strictPort: true,
    // The page carries the bridge token; no other origin may read it.
    cors: false,
  },
});
