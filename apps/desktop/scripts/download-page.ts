// The download page: one self-contained HTML file (no script, no outside request) that the release workflow makes from the
// release's own checksum and size, so the page and the file cannot disagree. It is hosted as a static site (Catalyst Slate);
// see docs/desktop.md.

export interface PageInfo {
  version: string;
  /** The installer's name, such as HAI-Setup-1.2.3.exe. */
  installerName: string;
  /** Its size in bytes. */
  bytes: number;
  /** Its SHA-256, lower case hex. */
  sha256: string;
  /** Where the button points: the file in the release. */
  downloadUrl: string;
  releaseNotesUrl: string;
  sourceUrl: string;
  /** Whether the installer carries a valid signature. An unsigned one gets a notice about Windows' warning. */
  signed: boolean;
}

const escapeHtml = (text: string): string =>
  text.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string,
  );

/** "139 MB": decimal megabytes, as Windows and download sites count. */
export function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1e6)} MB`;
}

export function renderDownloadPage(info: PageInfo): string {
  const e = escapeHtml;
  const unsigned = info.signed
    ? ""
    : `
      <aside class="notice" data-testid="unsigned-notice">
        <h2>This version is not signed yet</h2>
        <p>Windows may show &ldquo;Windows protected your PC&rdquo;. Choose <strong>More info</strong>, then <strong>Run anyway</strong>. If your PC has Smart App Control turned on, Windows can block the installer completely, and the only way past it is to turn Smart App Control off in Windows Security.</p>
      </aside>`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>HAI, the Human AI Interface</title>
<meta name="description" content="Work with your own AI agent and your design software using hands, face and voice and a normal laptop webcam. Free and open source.">
<style>
:root {
  --bg: #f5f5f7;
  --panel: #ffffff;
  --ink: #1d1d1f;
  --muted: #6e6e73;
  --line: rgb(0 0 0 / 0.1);
  --accent: #0071e3;
  --accent-ink: #ffffff;
  --warn-bg: #fff4e5;
  --warn-ink: #6b3b00;
  color-scheme: light dark;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #000000;
    --panel: #1c1c1e;
    --ink: #f5f5f7;
    --muted: #98989d;
    --line: rgb(255 255 255 / 0.12);
    --accent: #0a84ff;
    --warn-bg: #3a2a10;
    --warn-ink: #ffd9a0;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--ink);
  font: 17px/1.55 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif;
  -webkit-font-smoothing: antialiased;
}
main { max-width: 720px; margin: 0 auto; padding: 56px 16px 72px; }
header { text-align: center; padding-bottom: 40px; }
.wordmark { font-weight: 700; letter-spacing: -0.02em; font-size: 20px; }
h1 { margin: 12px 0 10px; font-size: clamp(32px, 6vw, 48px); line-height: 1.1; letter-spacing: -0.02em; text-wrap: balance; }
.lead { margin: 0 auto 28px; max-width: 34em; color: var(--muted); font-size: 19px; text-wrap: pretty; }
.button {
  display: inline-block;
  padding: 14px 30px;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-ink);
  font-weight: 600;
  text-decoration: none;
}
.button:hover { filter: brightness(1.08); }
.button:focus-visible, a:focus-visible { outline: 3px solid var(--accent); outline-offset: 3px; }
.fine { margin: 14px 0 0; color: var(--muted); font-size: 14px; }
section, aside {
  margin: 0 0 16px;
  padding: 22px 24px;
  border: 0.5px solid var(--line);
  border-radius: 16px;
  background: var(--panel);
}
.notice { background: var(--warn-bg); color: var(--warn-ink); border-color: transparent; }
h2 { margin: 0 0 8px; font-size: 21px; letter-spacing: -0.01em; }
p { margin: 0 0 10px; }
p:last-child { margin-bottom: 0; }
ol, ul { margin: 0; padding-left: 1.3em; }
li { margin: 0 0 8px; }
li:last-child { margin-bottom: 0; }
code, .hash {
  font: 14px/1.5 ui-monospace, "SF Mono", "Cascadia Mono", Consolas, monospace;
  overflow-wrap: anywhere;
}
.hash { display: block; padding: 10px 12px; border-radius: 10px; background: var(--bg); user-select: all; }
a { color: var(--accent); }
footer { margin-top: 28px; text-align: center; color: var(--muted); font-size: 14px; }
</style>
</head>
<body>
<main>
  <header>
    <div class="wordmark">HAI</div>
    <h1>Hands, face and voice for your AI agent</h1>
    <p class="lead">Work with your own AI agent and your design software using a normal laptop webcam. Point at a wall, say &ldquo;make it 300 thick&rdquo;, nod to accept.</p>
    <a class="button" data-testid="download" href="${e(info.downloadUrl)}">Download HAI for Windows</a>
    <p class="fine" data-testid="version">Version ${e(info.version)} &middot; ${e(formatSize(info.bytes))} &middot; Windows 10 or 11, 64-bit</p>
  </header>${unsigned}

  <section>
    <h2>Install it in three steps</h2>
    <ol>
      <li><strong>Download and double click.</strong> It installs for you only and needs no administrator rights.</li>
      <li><strong>Follow the first screen.</strong> HAI can install Claude Code for you and download the voice models (about 496 MB, once).</li>
      <li><strong>Sign in with your Claude account</strong> when asked. The sign-in happens in Claude Code&rsquo;s own window, and HAI never sees your login.</li>
    </ol>
  </section>

  <section>
    <h2>What you need</h2>
    <ul>
      <li>A Windows 10 or 11 computer with a webcam</li>
      <li>A Claude account, for the agent. The camera, hands and viewer work without it</li>
      <li>About 1 GB of free space</li>
    </ul>
  </section>

  <section>
    <h2>Your privacy</h2>
    <p>Camera video is processed on your computer and is never recorded or uploaded. HAI checks this project&rsquo;s releases for a newer version when it starts, and you can turn that off in Settings.</p>
  </section>

  <section>
    <h2>Check your download</h2>
    <p>The SHA-256 of <code>${e(info.installerName)}</code> is:</p>
    <code class="hash" data-testid="sha256">${e(info.sha256)}</code>
    <p class="fine">To check it, open PowerShell in the folder you downloaded it to and run <code>Get-FileHash .\\${e(info.installerName)}</code>. The two should match.</p>
  </section>

  <footer>
    <a href="${e(info.releaseNotesUrl)}">Release notes</a> &middot; <a href="${e(info.sourceUrl)}">Source code</a> &middot; Free and open source, Apache-2.0
  </footer>
</main>
</body>
</html>
`;
}

/** The facts the page is made from, read back out of a page (for the check that the page matches the file). */
export function readPage(html: string): {
  version: string | null;
  sha256: string | null;
  downloadUrl: string | null;
} {
  const sha256 = /data-testid="sha256">([0-9a-f]{64})</.exec(html)?.[1] ?? null;
  const downloadUrl =
    /data-testid="download" href="([^"]+)"/.exec(html)?.[1]?.replaceAll("&amp;", "&") ?? null;
  const version = /data-testid="version">Version ([^ ]+) /.exec(html)?.[1] ?? null;
  return { version, sha256, downloadUrl };
}
