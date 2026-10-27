import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { type LetterMarker, LetterMarkers, type Message } from "@hai/protocol";

type Send = (message: Message) => void;

/** Where the open project keeps its markers: inside the project, so they travel with it. */
export const markersFile = (projectDir: string) => join(projectDir, ".hai", "markers.json");

/**
 * The open project's lettered markers (A to Z), placed by the user with Place marker for the agent to refer to. They
 * live in the project's `.hai/markers.json`, are read again when another project opens, and are sent to every client
 * whenever they change. They are not model elements and are never undo steps.
 */
export class MarkerStore {
  private loaded: { dir: string | null; markers: LetterMarker[] } | null = null;

  constructor(
    private readonly projectDir: () => string | null,
    private readonly broadcast: Send,
  ) {}

  get markers(): LetterMarker[] {
    const dir = this.projectDir();
    if (!this.loaded || this.loaded.dir !== dir) this.loaded = { dir, markers: this.read(dir) };
    return this.loaded.markers;
  }

  /** Replaces the project's markers, saves them with the project and tells every client. */
  set(markers: LetterMarker[]): void {
    const dir = this.projectDir();
    const sorted = [...markers].sort((a, b) => a.letter.localeCompare(b.letter));
    this.loaded = { dir, markers: sorted };
    if (dir) {
      const file = markersFile(dir);
      if (sorted.length > 0) {
        mkdirSync(dirname(file), { recursive: true });
        writeFileSync(file, `${JSON.stringify(sorted, null, 2)}\n`);
      } else rmSync(file, { force: true });
    }
    this.broadcast(this.snapshot());
  }

  /** Another project opened: read its markers and tell every client. */
  projectChanged(): void {
    this.loaded = null;
    this.broadcast(this.snapshot());
  }

  greet(send: Send): void {
    send(this.snapshot());
  }

  /** Handles a markers message from a client. Returns false for other messages. */
  handle(message: Message): boolean {
    if (message.type !== "markers.set") return false;
    this.set(message.payload.markers);
    return true;
  }

  private snapshot(): Message {
    return { type: "markers.snapshot", id: randomUUID(), payload: { markers: this.markers } };
  }

  private read(dir: string | null): LetterMarker[] {
    if (!dir) return [];
    try {
      const parsed = LetterMarkers.safeParse(JSON.parse(readFileSync(markersFile(dir), "utf8")));
      return parsed.success ? parsed.data : [];
    } catch {
      return [];
    }
  }
}
