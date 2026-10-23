import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bundleMain } from "../scripts/bundle.ts";

// The main process is bundled as an ES module, which has no `require`. Packages in the bundle that are CommonJS
// (cross-spawn, reached through @hai/agent-core) call it, so the bundle brings its own, as the bridge's does.
describe("the main process bundle", () => {
  it("can load its CommonJS dependencies: nothing in it fails on `require`", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hai-main-bundle-"));
    await bundleMain(dir);
    const code = readFileSync(join(dir, "main.js"), "utf8");
    expect(code).toContain("createRequire");
    // Run the bundle's top level under plain Node with Electron replaced by an empty module: the dynamic-require error
    // happens while the bundle's own modules are evaluated, before anything touches Electron.
    const stub = join(dir, "node_modules", "electron");
    const run = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `import { register } from "node:module";
         register("data:text/javascript," + encodeURIComponent(
           'export async function resolve(s, c, n) { if (s === "electron") return { url: "data:text/javascript,export default new Proxy({}, {get:()=>()=>{}});export const app=new Proxy({}, {get:()=>()=>({then(){}}) });export const protocol={registerSchemesAsPrivileged(){}};export const ipcMain={};export const BrowserWindow={};export const session={};export const shell={};export const utilityProcess={};", shortCircuit: true }; return n(s, c); }'
         ));
         await import(${JSON.stringify(`file:///${join(dir, "main.js").replaceAll("\\", "/")}`)});`,
      ],
      { encoding: "utf8", timeout: 20_000 },
    );
    expect(stub).toBeDefined();
    expect(run.stderr).not.toContain("Dynamic require");
  });
});
