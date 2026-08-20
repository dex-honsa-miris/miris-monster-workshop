import { describe, expect, it } from "vitest";
import { probeFal, probeGateway, probeMiris } from "../server/probes";

const fake = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
const boom = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;

describe("probes", () => {
  it("fal: 401 means bad key, 404 means authenticated", async () => {
    expect((await probeFal("k", fake(401))).ok).toBe(false);
    expect((await probeFal("k", fake(404))).ok).toBe(true);
  });
  it("gateway: only 200 is ok", async () => {
    expect((await probeGateway("k", fake(200))).ok).toBe(true);
    expect((await probeGateway("k", fake(401))).ok).toBe(false);
  });
  it("miris: 200 is ok, base url is respected", async () => {
    let seen = "";
    const spy = (async (url: RequestInfo | URL) => { seen = String(url); return new Response("{}", { status: 200 }); }) as unknown as typeof fetch;
    expect((await probeMiris("t", "https://api.example", spy)).ok).toBe(true);
    expect(seen.startsWith("https://api.example/")).toBe(true);
  });
  it("network failure is not ok and says why", async () => {
    const r = await probeFal("k", boom);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("network");
  });
});
