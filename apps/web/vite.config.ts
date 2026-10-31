import { cpSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";
import { haiSession } from "./vite-plugin-hai-session.ts";
import { runtimeFiles } from "./vite-plugin-runtime-files.ts";

/**
 * The files the Try now build ships from public/: what the viewer, Rhino import and export, and hand and face tracking
 * need (about 55 MB). The speech models (about 500 MB) are not shipped; voice is off there.
 */
const TRIAL_FILES = ["mediapipe", "rhino3dm", "models/hand_landmarker.task", "models/face_landmarker.task"];

function trialFiles(): Plugin {
  let outDir = join(import.meta.dirname, "dist");
  return {
    name: "hai-trial-files",
    apply: "build",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    closeBundle() {
      for (const file of TRIAL_FILES) {
        const from = join(import.meta.dirname, "public", file);
        if (!existsSync(from)) throw new Error(`public/${file} is missing: run pnpm assets first.`);
        const to = join(outDir, file);
        mkdirSync(join(to, ".."), { recursive: true });
        cpSync(from, to, { recursive: true });
      }
    },
  };
}

// `vite build --mode try` makes the Try now site: the same app with its own scene in the page (no bridge), served under
// /try/ of the website. Everything else (the dev server, the desktop app, the tests) is unchanged.
export default defineConfig(({ mode }) => {
  const trial = mode === "try";
  return {
    base: trial ? "/try/" : "/",
    // The trial copies only what it needs (see `trialFiles`); the speech models stay out of it.
    publicDir: trial ? false : "public",
    define: trial ? { "import.meta.env.VITE_HAI_LOCAL": JSON.stringify("1") } : {},
    plugins: [react(), haiSession(), runtimeFiles(), ...(trial ? [trialFiles()] : [])],
    optimizeDeps: {
      // Imported only by workers and on first use, which Vite does not scan at startup. Without this, the first
      // "Start camera" or the first voice request on a fresh dev server makes Vite bundle them and reload the page.
      include: ["@mediapipe/tasks-vision", "@huggingface/transformers", "@ricky0123/vad-web"],
      // The Rhino file reader is already a browser module; it is served as it is, and only the import worker loads it.
      exclude: ["rhino3dm"],
    },
    server: {
      host: "127.0.0.1",
      // HAI_WEB_PORT runs a second dev server (the end-to-end tests') beside yours.
      port: process.env.HAI_WEB_PORT ? Number(process.env.HAI_WEB_PORT) : 5173,
      strictPort: true,
      // The page carries the bridge token; no other origin may read it.
      cors: false,
    },
  };
});
