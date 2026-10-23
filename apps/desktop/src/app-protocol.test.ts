import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  type AppRoots,
  CONTENT_SECURITY_POLICY,
  createAppHandler,
  resolveAppFile,
  safeSegments,
} from "./app-protocol.ts";

let roots: AppRoots;
let outside: string;

beforeAll(() => {
  const base = mkdtempSync(join(tmpdir(), "hai-protocol-"));
  roots = { web: join(base, "web"), models: join(base, "models") };
  mkdirSync(join(roots.web, "assets"), { recursive: true });
  mkdirSync(join(roots.web, "models"), { recursive: true });
  mkdirSync(join(roots.web, "ort"), { recursive: true });
  mkdirSync(join(roots.models, "kokoro"), { recursive: true });
  writeFileSync(join(roots.web, "index.html"), "<!doctype html><title>HAI</title>");
  writeFileSync(join(roots.web, "assets", "app.js"), "export {}");
  writeFileSync(join(roots.web, "ort", "ort.wasm"), "wasm");
  writeFileSync(join(roots.web, "models", "hand_landmarker.task"), "shipped");
  writeFileSync(join(roots.web, "models", "shadowed.bin"), "from the install folder");
  writeFileSync(join(roots.models, "shadowed.bin"), "from the downloads");
  writeFileSync(join(roots.models, "kokoro", "model.onnx"), "downloaded");
  outside = join(base, "secret.txt");
  writeFileSync(outside, "secret");
});

describe("safeSegments", () => {
  it.each([
    ["/", []],
    ["/assets/app.js", ["assets", "app.js"]],
    ["//assets//app.js", ["assets", "app.js"]],
    ["/a%20b/c.txt", ["a b", "c.txt"]],
  ])("accepts %s", (path, expected) => {
    expect(safeSegments(path)).toEqual(expected);
  });

  it.each([
    "/../secret.txt",
    "/assets/../../secret.txt",
    "/%2e%2e/secret.txt",
    "/%2E%2E%2Fsecret.txt",
    "/assets/..%2f..%2fsecret.txt",
    "/C:/Windows/win.ini",
    "/C%3A/Windows/win.ini",
    "/assets\\..\\secret.txt",
    "/assets%5c..%5csecret.txt",
    "/app.js%00.png",
    "/%E0%A4%A",
    "/./app.js",
  ])("rejects %s", (path) => {
    expect(safeSegments(path)).toBeNull();
  });
});

describe("resolveAppFile", () => {
  it("serves the index for the root", () => {
    expect(resolveAppFile("/", roots)?.file).toBe(join(roots.web, "index.html"));
  });

  it("serves files from the web folder", () => {
    expect(resolveAppFile("/assets/app.js", roots)?.file).toBe(join(roots.web, "assets", "app.js"));
  });

  it("answers /models/* from the downloaded models first", () => {
    expect(resolveAppFile("/models/shadowed.bin", roots)?.file).toBe(join(roots.models, "shadowed.bin"));
    expect(resolveAppFile("/models/kokoro/model.onnx", roots)?.file).toBe(
      join(roots.models, "kokoro", "model.onnx"),
    );
  });

  it("falls back to the models that ship in the install folder", () => {
    expect(resolveAppFile("/models/hand_landmarker.task", roots)?.file).toBe(
      join(roots.web, "models", "hand_landmarker.task"),
    );
  });

  it("does not look in the downloaded models for other paths", () => {
    expect(resolveAppFile("/shadowed.bin", roots)).toBeNull();
  });

  it("finds nothing outside the two folders", () => {
    expect(resolveAppFile("/../secret.txt", roots)).toBeNull();
    expect(resolveAppFile("/models/../../secret.txt", roots)).toBeNull();
    expect(resolveAppFile(`/${outside.replaceAll("\\", "/")}`, roots)).toBeNull();
  });

  it("finds nothing for a folder or a missing file", () => {
    expect(resolveAppFile("/assets", roots)).toBeNull();
    expect(resolveAppFile("/missing.js", roots)).toBeNull();
  });
});

describe("createAppHandler", () => {
  // The folders are made in beforeAll, so the handler reads them when the first request arrives.
  const handle = (request: Request) => createAppHandler(roots)(request);
  const get = (path: string, init?: RequestInit) => handle(new Request(`hai://app${path}`, init));

  it("sends the file with its type and length", async () => {
    const res = await get("/assets/app.js");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/javascript");
    expect(res.headers.get("content-length")).toBe("9");
    expect(await res.text()).toBe("export {}");
  });

  it("serves WebAssembly with its own type so it can be compiled while it streams", async () => {
    const res = await get("/ort/ort.wasm");
    expect(res.headers.get("content-type")).toBe("application/wasm");
  });

  it("sets a Content-Security-Policy that keeps the page to itself and the loopback bridge", async () => {
    const res = await get("/");
    expect(res.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
    expect(CONTENT_SECURITY_POLICY).toContain(
      "connect-src 'self' blob: data: ws://127.0.0.1:* http://127.0.0.1:*",
    );
    expect(CONTENT_SECURITY_POLICY).not.toMatch(/https?:\/\/(?!127\.0\.0\.1)/);
    expect(CONTENT_SECURITY_POLICY).not.toContain("'unsafe-eval'");
  });

  it("answers HEAD without a body, and refuses other methods", async () => {
    const head = await get("/assets/app.js", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect((await get("/assets/app.js", { method: "POST", body: "x" })).status).toBe(405);
  });

  it("answers 404 for a path that leaves the folder, the same as for a missing one", async () => {
    expect((await get("/%2e%2e/secret.txt")).status).toBe(404);
    expect((await get("/missing.js")).status).toBe(404);
  });
});
