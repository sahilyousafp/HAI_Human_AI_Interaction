import { expect, test } from "@playwright/test";
import { type Bridge, createBridge } from "../apps/bridge/src/server.ts";
import { E2E_ORIGINS } from "./stack.ts";

const status = (page: import("@playwright/test").Page) => page.getByTestId("bridge-status");

test("shell connects to the bridge its dev server was started with", async ({ page }) => {
  await page.goto("/");
  await expect(status(page)).toHaveAttribute("data-state", "connected");
  await expect(status(page)).toContainText("Connected");
});

test.describe("connection state follows the bridge", () => {
  const PORT = 4899;
  let bridge: Bridge | null = null;

  const startBridge = async (token: string): Promise<Bridge> => {
    const started = createBridge({
      host: "127.0.0.1",
      port: PORT,
      allowedOrigins: E2E_ORIGINS,
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
        Object.defineProperty(window, "__HAI_SESSION__", { value: { port, token }, writable: false });
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
