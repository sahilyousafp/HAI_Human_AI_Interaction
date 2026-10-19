import { expect, test } from "@playwright/test";
import { type Bridge, createBridge } from "../apps/bridge/src/server.ts";

const status = (page: import("@playwright/test").Page) => page.getByTestId("bridge-status");

test("shell connects to the bridge started by pnpm dev", async ({ page }) => {
  await page.goto("/");
  await expect(status(page)).toHaveAttribute("data-state", "connected");
  await expect(status(page)).toContainText("Connected");
});

test.describe("connection state follows the bridge", () => {
  const PORT = 4899;
  const ORIGINS = ["http://127.0.0.1:5173", "http://localhost:5173"];
  let bridge: Bridge | null = null;

  const startBridge = async (token: string): Promise<Bridge> => {
    const started = createBridge({
      host: "127.0.0.1",
      port: PORT,
      allowedOrigins: ORIGINS,
      version: "e2e",
      token,
    });
    await started.start();
    return started;
  };

  test.afterEach(async () => {
    await bridge?.stop();
    bridge = null;
  });

  test("connected, offline when stopped, connected again on restart, refused on a new token", async ({
    page,
  }) => {
    // Pin the page to this test's bridge; the dev plugin's later assignment cannot overwrite it.
    await page.addInitScript(
      ({ port, token }) => {
        Object.defineProperty(window, "__AEX_SESSION__", { value: { port, token }, writable: false });
      },
      { port: PORT, token: "e2e-token-a" },
    );
    bridge = await startBridge("e2e-token-a");
    await page.goto("/");
    await expect(status(page)).toHaveAttribute("data-state", "connected");

    await bridge.stop();
    bridge = null;
    await expect(status(page)).toHaveAttribute("data-state", "offline");

    bridge = await startBridge("e2e-token-a");
    await expect(status(page)).toHaveAttribute("data-state", "connected", { timeout: 10_000 });

    await bridge.stop();
    bridge = await startBridge("e2e-token-b");
    await expect(status(page)).toHaveAttribute("data-state", "refused", { timeout: 10_000 });
  });
});
