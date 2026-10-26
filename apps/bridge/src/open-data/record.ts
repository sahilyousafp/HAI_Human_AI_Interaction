import type { OpenDataRecordEntry } from "@hai/protocol";

/** How many requests the list keeps (the oldest fall off). */
const KEPT = 200;

/** The open-data requests made in this session, for the list in Settings. */
export class OpenDataRecord {
  private list: OpenDataRecordEntry[] = [];

  constructor(private readonly changed: () => void = () => {}) {}

  get entries(): readonly OpenDataRecordEntry[] {
    return this.list;
  }

  add(entry: OpenDataRecordEntry): void {
    this.list = [...this.list, entry].slice(-KEPT);
    this.changed();
  }

  clear(): void {
    if (this.list.length === 0) return;
    this.list = [];
    this.changed();
  }
}
