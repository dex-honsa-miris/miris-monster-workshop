import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { assetStatus, uploadGlb } from "../server/miris";

beforeEach(() => { process.env.WORKSHOP_DIR = mkdtempSync(join(tmpdir(), "ws-")); });

const GLB = new TextEncoder().encode("glTF fake bytes").buffer as ArrayBuffer;
const deps = (impl: (url: string, init?: RequestInit) => Promise<Response>) =>
  ({ token: "t", base: "https://api.example", fetch: impl as unknown as typeof fetch });

describe("uploadGlb", () => {
  it("uploads once and returns the asset id", async () => {
    let posted = "";
    const r = await uploadGlb(GLB, "Gloamroot", deps(async (url) => {
      posted = url;
      return new Response(JSON.stringify({ asset_id: "a-123" }), { status: 200 });
    }));
    expect(r).toEqual({ assetId: "a-123", reused: false });
    expect(posted).toBe("https://api.example/v1/assets");
  });
  it("is idempotent per GLB hash: same bytes never upload twice", async () => {
    let calls = 0;
    const d = deps(async () => { calls += 1; return new Response(JSON.stringify({ asset_id: "a-1" }), { status: 200 }); });
    await uploadGlb(GLB, "m", d);
    const again = await uploadGlb(GLB, "m", d);
    expect(again).toEqual({ assetId: "a-1", reused: true });
    expect(calls).toBe(1);
  });
  it("surfaces API failures with the status code", async () => {
    await expect(uploadGlb(GLB, "m", deps(async () => new Response("no", { status: 402 })))).rejects.toThrow(/402/);
  });
});

describe("assetStatus", () => {
  it("maps the vocabulary", async () => {
    const mk = (status: string) => deps(async () => new Response(JSON.stringify({ status }), { status: 200 }));
    expect(await assetStatus("a", mk("complete"))).toBe("ready");
    expect(await assetStatus("a", mk("failed"))).toBe("failed");
    expect(await assetStatus("a", mk("ingesting"))).toBe("processing");
  });
});
