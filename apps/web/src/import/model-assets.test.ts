import { encodeMeshAsset } from "@aex/scene";
import { describe, expect, it, vi } from "vitest";
import { ModelAssets } from "./model-assets.ts";

const ID = "0f8fad5b-d9cb-469f-a165-70867728950e";
const bytes = encodeMeshAsset([
  { positions: new Float32Array([0, 0, 0, 1000, 0, 0, 0, 1000, 500]), indices: new Uint32Array([0, 1, 2]) },
]);
const session = () => ({ port: 4000, token: "tok" });

const respond = (response: Response | Error) =>
  vi.fn(async () => {
    if (response instanceof Error) throw response;
    return response;
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;

describe("ModelAssets", () => {
  it("fetches an asset once, with the session token, and tells watchers when it arrives", async () => {
    const fetchAsset = respond(new Response(bytes as BodyInit));
    const assets = new ModelAssets(session, fetchAsset);
    const listener = vi.fn();
    assets.subscribe(listener);
    assets.ensure(ID);
    assets.ensure(ID);
    expect(assets.parts(ID)).toBeNull();
    await vi.waitFor(() => expect(assets.parts(ID)).not.toBeNull());
    expect(fetchAsset).toHaveBeenCalledTimes(1);
    expect(fetchAsset).toHaveBeenCalledWith(`http://127.0.0.1:4000/assets/${ID}`, {
      headers: { authorization: "Bearer tok" },
    });
    expect(assets.parts(ID)?.[0]?.indices).toEqual(new Uint32Array([0, 1, 2]));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(assets.getVersion()).toBe(1);
  });

  it("a model the bridge does not have is missing, not an error", async () => {
    const assets = new ModelAssets(session, respond(new Response("no", { status: 404 })));
    assets.ensure(ID);
    await vi.waitFor(() => expect(assets.state(ID)?.status).toBe("missing"));
    expect(assets.parts(ID)).toBeNull();
  });

  it("bytes that are not a model are missing too", async () => {
    const assets = new ModelAssets(session, respond(new Response("not a model at all")));
    assets.ensure(ID);
    await vi.waitFor(() => expect(assets.state(ID)?.status).toBe("missing"));
  });

  it("a network failure is missing, and can be tried again", async () => {
    const fetchAsset = respond(new Error("offline"));
    const assets = new ModelAssets(session, fetchAsset);
    assets.ensure(ID);
    await vi.waitFor(() => expect(assets.state(ID)?.status).toBe("missing"));
    assets.retryMissing();
    assets.ensure(ID);
    await vi.waitFor(() => expect(fetchAsset).toHaveBeenCalledTimes(2));
  });

  it("waits for the bridge to be known", () => {
    const fetchAsset = respond(new Response(bytes as BodyInit));
    const assets = new ModelAssets(() => null, fetchAsset);
    assets.ensure(ID);
    expect(fetchAsset).not.toHaveBeenCalled();
    expect(assets.state(ID)).toBeUndefined();
  });

  it("whenLoaded waits for the asset, and answers null for one that cannot be had", async () => {
    const ready = new ModelAssets(session, respond(new Response(bytes as BodyInit)));
    expect((await ready.whenLoaded(ID))?.[0]?.indices).toEqual(new Uint32Array([0, 1, 2]));
    const gone = new ModelAssets(session, respond(new Response("no", { status: 404 })));
    expect(await gone.whenLoaded(ID)).toBeNull();
  });
});
