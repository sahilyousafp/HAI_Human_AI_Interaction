import { once } from "node:events";
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer, type Server, type ServerResponse } from "node:http";
import { join, normalize, sep } from "node:path";

/** Where the desktop test variant is told to download the voice models from (see stageApp's modelsBaseUrl). */
export const MODEL_SERVER_PORT = 4891;
export const MODEL_SERVER_URL = `http://127.0.0.1:${MODEL_SERVER_PORT}`;

const publicDir = join(import.meta.dirname, "..", "apps", "web", "public");

export type ModelServerMode =
  /** Serves the real files, honouring Range requests. */
  | "ok"
  /** The connection is cut as soon as it is made: the host cannot be reached. */
  | "offline"
  /** Serves the right number of bytes, but wrong ones. */
  | "corrupt";

export interface ModelServer {
  url: string;
  /** Every request answered, in order. */
  requests: { path: string; range: string | null }[];
  mode: ModelServerMode;
  /** Bytes per second to send at, or null for as fast as it goes. A throttle keeps a download alive long enough to watch. */
  rate: number | null;
  stop(): Promise<void>;
}

/**
 * Serves the model files from apps/web/public (the ones `pnpm assets` placed) on a local port, so the desktop app's
 * first-run download can be tested against the real files and their real hashes without the internet.
 */
export async function startModelServer(options: { rate?: number } = {}): Promise<ModelServer> {
  const state: ModelServer = {
    url: MODEL_SERVER_URL,
    requests: [],
    mode: "ok",
    rate: options.rate ?? null,
    stop: async () => {},
  };
  const sockets = new Set<import("node:net").Socket>();

  /** Writes the file from `start`, in chunks, at the throttled rate, stopping if the client goes away. */
  async function send(file: string, start: number, res: ServerResponse): Promise<void> {
    for await (const chunk of createReadStream(file, { start, highWaterMark: 256 * 1024 })) {
      if (res.destroyed) return;
      const data = chunk as Buffer;
      const body = state.mode === "corrupt" ? Buffer.alloc(data.length, 1) : data;
      if (!res.write(body)) await once(res, "drain").catch(() => {});
      if (state.rate !== null)
        await new Promise((resolve) => setTimeout(resolve, (data.length / (state.rate as number)) * 1000));
    }
    res.end();
  }

  const server: Server = createServer((req, res) => {
    const path = decodeURIComponent((req.url ?? "").split("?")[0] ?? "");
    state.requests.push({ path, range: req.headers.range ?? null });
    if (state.mode === "offline") {
      req.socket.destroy();
      return;
    }
    const file = normalize(join(publicDir, path));
    if (!file.startsWith(publicDir + sep) || !existsSync(file) || !statSync(file).isFile()) {
      res.writeHead(404).end();
      return;
    }
    const size = statSync(file).size;
    const start = req.headers.range ? Number(/bytes=(\d+)-/.exec(req.headers.range)?.[1]) : 0;
    if (start >= size) {
      res.writeHead(416, { "content-range": `bytes */${size}` }).end();
      return;
    }
    res.writeHead(start > 0 ? 206 : 200, {
      "content-length": size - start,
      ...(start > 0 ? { "content-range": `bytes ${start}-${size - 1}/${size}` } : {}),
    });
    void send(file, start, res);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(MODEL_SERVER_PORT, "127.0.0.1", resolve);
  });
  state.stop = () =>
    new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
  return state;
}
