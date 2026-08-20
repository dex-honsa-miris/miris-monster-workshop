import { describe, expect, it } from "vitest";
import { falQueue, generateConcept, generateModel } from "../server/fal";

// A scripted fetch: each call shifts the next response off the list.
function scripted(responses: Array<{ status?: number; json?: unknown; buf?: ArrayBuffer }>): typeof fetch {
  return (async () => {
    const next = responses.shift()!;
    if (next.buf) return new Response(next.buf, { status: 200 });
    return new Response(JSON.stringify(next.json ?? {}), { status: next.status ?? 200 });
  }) as unknown as typeof fetch;
}
const now = { sleep: async () => {} };

describe("falQueue", () => {
  it("submits, polls until COMPLETED, then fetches the result", async () => {
    const f = scripted([
      { json: { request_id: "r1", status_url: "s", response_url: "res" } },
      { json: { status: "IN_PROGRESS" } },
      { json: { status: "COMPLETED" } },
      { json: { images: [{ url: "http://img" }] } },
    ]);
    const out = (await falQueue("fal-ai/flux/schnell", { prompt: "p" }, { key: "k", fetch: f, ...now })) as { images: Array<{ url: string }> };
    expect(out.images[0]!.url).toBe("http://img");
  });
  it("times out with a clear error", async () => {
    const forever = (async (url: RequestInfo | URL) =>
      new Response(JSON.stringify(String(url).includes("status") ? { status: "IN_PROGRESS" } : { request_id: "r", status_url: "s/status", response_url: "res" }), { status: 200 })) as unknown as typeof fetch;
    let t = 0;
    const clock = { sleep: async () => { t += 100_000; } }; // fast-forward past the 6 min budget
    await expect(falQueue("m", {}, { key: "k", fetch: forever, ...clock })).rejects.toThrow(/timed out/);
  });
});

describe("generateConcept / generateModel", () => {
  it("returns the image url", async () => {
    const f = scripted([
      { json: { request_id: "r", status_url: "s", response_url: "res" } },
      { json: { status: "COMPLETED" } },
      { json: { images: [{ url: "http://concept.png" }] } },
    ]);
    expect((await generateConcept("blob", { key: "k", fetch: f, ...now })).imageUrl).toBe("http://concept.png");
  });
  it("downloads the GLB bytes and reports progress", async () => {
    const glb = new TextEncoder().encode("glTF-bytes").buffer as ArrayBuffer;
    const f = scripted([
      { json: { request_id: "r", status_url: "s", response_url: "res" } },
      { json: { status: "IN_PROGRESS" } },
      { json: { status: "COMPLETED" } },
      { json: { model_mesh: { url: "http://mesh.glb" } } },
      { buf: glb },
    ]);
    const seen: string[] = [];
    const out = await generateModel("http://concept.png", { key: "k", fetch: f, ...now }, (p) => seen.push(p.status));
    expect(new TextDecoder().decode(out.glb)).toBe("glTF-bytes");
    expect(seen).toContain("IN_PROGRESS");
  });
});
