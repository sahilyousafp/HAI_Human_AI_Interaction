// The bridge as the desktop app runs it, with the fake Claude Code CLI as the agent (FAKE_CLAUDE_STATE says where it
// keeps its state). Bundled and started by bridge-process.test.ts and by the end-to-end tests of the app.
import { runBridge } from "../../bridge/src/run.ts";
import { fakeProvider } from "../../bridge/test/fake-provider.ts";

// Inside Electron's utility process `process.execPath` is Electron itself; the fake CLI must run as plain Node.
if (process.versions.electron) process.env.ELECTRON_RUN_AS_NODE = "1";

await runBridge(fakeProvider(process.env.FAKE_CLAUDE_STATE ?? process.cwd()));
