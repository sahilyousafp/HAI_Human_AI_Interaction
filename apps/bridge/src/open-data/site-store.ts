import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type Message, Site } from "@hai/protocol";

type Send = (message: Message) => void;

/** Where the open project keeps its site: inside the project, so it travels with it. */
export const siteFile = (projectDir: string) => join(projectDir, ".hai", "site.json");

/**
 * The open project's site: where it stands on Earth and which way true north points. It lives in the project's
 * `.hai/site.json`, is read again when another project opens, and is sent to every client whenever it changes. A
 * project without a file has no site, and works as it always did.
 */
export class SiteStore {
  private loaded: { dir: string | null; site: Site | null } | null = null;

  constructor(
    private readonly projectDir: () => string | null,
    private readonly broadcast: Send,
    /** Told after every change of the site (the context layer marks itself out of date). */
    private readonly changed: () => void = () => {},
  ) {}

  get site(): Site | null {
    const dir = this.projectDir();
    if (!this.loaded || this.loaded.dir !== dir) this.loaded = { dir, site: this.read(dir) };
    return this.loaded.site;
  }

  /** Sets, changes or (with null) clears the site, saves it with the project and tells every client. */
  set(site: Site | null): void {
    const dir = this.projectDir();
    this.loaded = { dir, site };
    if (dir) {
      const file = siteFile(dir);
      if (site) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify(site, null, 2)}\n`);
      } else rmSync(file, { force: true });
    }
    this.broadcast(this.snapshot());
    this.changed();
  }

  /** Another project opened: read its site and tell every client. */
  projectChanged(): void {
    this.loaded = null;
    this.broadcast(this.snapshot());
    this.changed();
  }

  greet(send: Send): void {
    send(this.snapshot());
  }

  /** Handles a site message from a client (the user's own edit in Settings). Returns false for other messages. */
  handle(message: Message): boolean {
    if (message.type !== "site.set") return false;
    this.set(message.payload.site);
    return true;
  }

  private snapshot(): Message {
    return { type: "site.snapshot", id: randomUUID(), payload: { site: this.site } };
  }

  private read(dir: string | null): Site | null {
    if (!dir) return null;
    try {
      const parsed = Site.safeParse(JSON.parse(readFileSync(siteFile(dir), "utf8")));
      return parsed.success ? parsed.data : null;
    } catch {
      return null;
    }
  }
}
