import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, join, normalize, sep } from "node:path";
import type { Plugin } from "vite";

const TYPES: Record<string, string> = {
  ".mjs": "text/javascript",
  ".js": "text/javascript",
  ".wasm": "application/wasm",
  ".onnx": "application/octet-stream",
};

/**
 * Serves the speech runtime (public/ort: the ONNX runtime, public/vad: the voice activity detector) as plain files
 * in dev. The ONNX runtime loads its own .mjs files with dynamic imports, which Vite rewrites to `?import` requests
 * that it refuses for files in public/; answering these paths first, query ignored, avoids that. Builds copy
 * public/ unchanged, so production needs nothing.
 */
export function runtimeFiles(): Plugin {
  return {
    name: "aex-runtime-files",
    apply: "serve",
    configureServer(server) {
      // Normalised, so the containment check below compares like with like (Vite reports it with forward slashes).
      const publicDir = normalize(server.config.publicDir);
      server.middlewares.use((req, res, next) => {
        const path = (req.url ?? "").split("?")[0] ?? "";
        if (!/^\/(ort|vad)\//.test(path)) return next();
        const file = normalize(join(publicDir, path));
        if (!file.startsWith(publicDir + sep) || !existsSync(file) || !statSync(file).isFile()) return next();
        res.setHeader("content-type", TYPES[extname(file)] ?? "application/octet-stream");
        res.setHeader("cache-control", "no-cache");
        createReadStream(file).pipe(res);
      });
    },
  };
}
