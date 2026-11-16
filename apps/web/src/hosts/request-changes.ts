import type { HostId } from "@hai/protocol";
import type { HostMirrors } from "./host-mirror.ts";

/**
 * What the agent changed for a request about a host's selection: from when the request goes until the team has worked
 * and is idle again, every object the host's batches add or change is noted, and then shown as changed (it glows)
 * until the user's next selection.
 */
export class RequestChanges {
  private watching: { host: HostId; ids: Set<string>; worked: boolean; off(): void } | null = null;

  constructor(private readonly mirrors: HostMirrors) {}

  /** A request limited to this host's objects went: watch its changes (a new request starts over). */
  start(host: HostId): void {
    this.watching?.off();
    const ids = new Set<string>();
    const off = this.mirrors.byHost[host].onChanges((changed) => {
      for (const id of changed) ids.add(id);
    });
    this.watching = { host, ids, worked: false, off };
  }

  /** The team's state changed: once it has worked and stopped, what changed is shown. */
  working(busy: boolean): void {
    const watching = this.watching;
    if (!watching) return;
    if (busy) {
      watching.worked = true;
      return;
    }
    if (!watching.worked) return;
    watching.off();
    this.watching = null;
    this.mirrors.byHost[watching.host].showChanged([...watching.ids]);
  }
}
