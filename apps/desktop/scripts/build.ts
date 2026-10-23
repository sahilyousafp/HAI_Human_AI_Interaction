import { join } from "node:path";
import { stageApp } from "./bundle.ts";

const appDir = join(import.meta.dirname, "..");
await stageApp(appDir);
console.log(`built ${join(appDir, "dist")}`);
