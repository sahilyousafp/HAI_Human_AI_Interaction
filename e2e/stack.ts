import { join } from "node:path";

/**
 * The end-to-end tests' own bridge and dev server, on their own ports and with their own `.aex` folder. Locally
 * Playwright reuses servers that are already running, and these ports keep it from reusing yours: a test page
 * must never reach the bridge you work with, or its fake camera's open palms stop your agents and its edits land
 * in your project.
 */
export const E2E_WEB_PORT = 5183;
export const E2E_BRIDGE_PORT = 4880;
export const E2E_BASE_URL = `http://127.0.0.1:${E2E_WEB_PORT}`;
export const E2E_ORIGINS = [E2E_BASE_URL, `http://localhost:${E2E_WEB_PORT}`];
export const E2E_WORKSPACE = join(import.meta.dirname, "..", ".aex", "e2e");
