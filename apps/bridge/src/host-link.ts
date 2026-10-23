/** What the bridge tells the program that started it. */
export type BridgeToHost = { type: "ready"; port: number; token: string };
/** What that program can tell the bridge. */
export type HostToBridge = { type: "stop" };

interface ParentPort {
  postMessage(message: unknown): void;
  on(event: "message", listener: (event: { data: unknown }) => void): unknown;
}

/** The parts of `process` a parent can talk through: Electron's utility process or a Node child with a channel. */
interface HostProcess {
  parentPort?: ParentPort;
  send?: (message: unknown) => boolean;
  on(event: "message", listener: (message: unknown) => void): unknown;
}

export interface HostLink {
  send(message: BridgeToHost): void;
  /** Runs when the parent asks the bridge to stop, so it can end its agents before it exits. */
  onStop(listener: () => void): void;
}

const isStop = (message: unknown): message is HostToBridge =>
  typeof message === "object" && message !== null && (message as { type?: unknown }).type === "stop";

/**
 * The bridge's link to the desktop app that started it, or null when it was started from a terminal. Over this link
 * the app learns the port and token with no file to poll, and asks for a clean stop (a killed bridge cannot end the
 * agent processes it started).
 */
export function hostLink(proc: HostProcess = process as unknown as HostProcess): HostLink | null {
  const port = proc.parentPort;
  if (port) {
    return {
      send: (message) => port.postMessage(message),
      onStop: (listener) =>
        port.on("message", (event) => {
          if (isStop(event.data)) listener();
        }),
    };
  }
  const send = proc.send;
  if (send) {
    return {
      send: (message) => {
        send.call(proc, message);
      },
      onStop: (listener) =>
        proc.on("message", (message) => {
          if (isStop(message)) listener();
        }),
    };
  }
  return null;
}
