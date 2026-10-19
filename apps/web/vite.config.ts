import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { aexSession } from "./vite-plugin-aex-session.ts";

export default defineConfig({
  plugins: [react(), aexSession()],
  optimizeDeps: {
    // Imported only by the perception worker, which Vite does not scan at startup. Without this, the first
    // "Start camera" on a fresh dev server makes Vite bundle MediaPipe and reload the page, turning the camera off.
    include: ["@mediapipe/tasks-vision"],
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    // The page carries the bridge token; no other origin may read it.
    cors: false,
  },
});
