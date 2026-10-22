import {
  type Message,
  PROTOCOL_VERSION,
  parseMessage,
  TOKEN_PROTOCOL_PREFIX,
  WS_PATH,
  WS_PROTOCOL,
} from "@hai/protocol";

export type ConnectionState =
  | { status: "no-session" }
  | { status: "connecting" }
  | { status: "connected"; clients: number; bridgeVersion: string }
  | { status: "offline" }
  | { status: "refused" };

export interface BridgeConnection {
  send(message: Message): boolean;
  close(): void;
}

export interface Session {
  port: number;
  token: string;
}

/** Minimal surface of the browser WebSocket, so tests can inject a fake. */
export interface SocketLike {
  onopen: (() => void) | null;
  onmessage: ((event: { data: unknown }) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export interface ConnectionDeps {
  createSocket(url: string, protocols: string[]): SocketLike;
  /** Resolves true if the bridge's HTTP server answers at all. */
  probe(port: number): Promise<boolean>;
  setTimer(fn: () => void, ms: number): unknown;
  clearTimer(handle: unknown): void;
}

const RETRY_MS = [500, 1000, 2000, 4000];

/**
 * Keeps one WebSocket to the bridge open, reconnecting with backoff.
 * A browser cannot read the HTTP status of a refused upgrade, so after a failed attempt
 * the bridge's /health endpoint is probed: reachable means it refused us, unreachable means offline.
 */
export function connectToBridge(
  session: Session | null,
  deps: ConnectionDeps,
  onState: (state: ConnectionState) => void,
  onMessage: (message: Message) => void = () => {},
): BridgeConnection {
  if (!session) {
    onState({ status: "no-session" });
    return { send: () => false, close: () => {} };
  }
  const { port, token } = session;
  let socket: SocketLike | null = null;
  let timer: unknown = null;
  let attempt = 0;
  let disposed = false;
  let socketOpen = false;

  const scheduleRetry = () => {
    if (disposed) return;
    const delay = RETRY_MS[Math.min(attempt, RETRY_MS.length - 1)] ?? 4000;
    attempt += 1;
    timer = deps.setTimer(open, delay);
  };

  function open() {
    if (disposed) return;
    onState({ status: "connecting" });
    let opened = false;
    socketOpen = false;
    socket = deps.createSocket(`ws://127.0.0.1:${port}${WS_PATH}`, [
      WS_PROTOCOL,
      `${TOKEN_PROTOCOL_PREFIX}${token}`,
    ]);
    socket.onopen = () => {
      opened = true;
      socketOpen = true;
      attempt = 0;
      socket?.send(
        JSON.stringify({
          type: "hello",
          id: crypto.randomUUID(),
          payload: { client: "web", protocolVersion: PROTOCOL_VERSION },
        }),
      );
    };
    socket.onmessage = (event) => {
      const result = parseMessage(String(event.data));
      if (!result.ok) return;
      if (result.message.type === "bridge.status") {
        const { clients, bridgeVersion } = result.message.payload;
        onState({ status: "connected", clients, bridgeVersion });
      }
      onMessage(result.message);
    };
    socket.onclose = () => {
      socket = null;
      if (disposed) return;
      if (opened) {
        onState({ status: "offline" });
        scheduleRetry();
        return;
      }
      void deps.probe(port).then((reachable) => {
        if (disposed) return;
        onState({ status: reachable ? "refused" : "offline" });
        scheduleRetry();
      });
    };
  }

  open();

  /** Sends a message if the socket is open; returns false (and drops it) otherwise. */
  const send = (message: Message): boolean => {
    if (!socket || !socketOpen) return false;
    socket.send(JSON.stringify(message));
    return true;
  };

  const close = () => {
    disposed = true;
    if (timer !== null) deps.clearTimer(timer);
    const current = socket;
    if (!current) return;
    if (socketOpen) {
      current.close();
    } else {
      // Closing a socket that is still connecting makes the browser log a warning (React StrictMode
      // mounts effects twice in dev). Close it as soon as it opens instead.
      current.onopen = () => current.close();
      current.onmessage = null;
    }
  };

  return { send, close };
}

export const browserDeps: ConnectionDeps = {
  createSocket: (url, protocols) => new WebSocket(url, protocols) as unknown as SocketLike,
  probe: (port) =>
    fetch(`http://127.0.0.1:${port}/health`, { mode: "no-cors", cache: "no-store" }).then(
      () => true,
      () => false,
    ),
  setTimer: (fn, ms) => window.setTimeout(fn, ms),
  clearTimer: (handle) => window.clearTimeout(handle as number),
};
