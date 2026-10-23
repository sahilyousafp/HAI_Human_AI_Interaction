import config from "./playwright.desktop.config.ts";

// The same tests against the program electron-builder makes (e2e/desktop-setup.ts packages it first). Set before the
// workers start, so the setup and every test see it.
process.env.HAI_DESKTOP_PACKAGED = "1";

export default config;
