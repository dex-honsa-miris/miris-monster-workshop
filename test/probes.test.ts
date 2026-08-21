import { describe, expect, it } from "vitest";
import { probeFal } from "../server/probes";

const fake = (status: number) => (async () => new Response("{}", { status })) as unknown as typeof fetch;
const boom = (async () => { throw new Error("offline"); }) as unknown as typeof fetch;

describe("probeFal", () => {
  it("401 and 403 mean a bad key, anything else means authenticated", async () => {
    expect((await probeFal("k", fake(401))).ok).toBe(false);
    expect((await probeFal("k", fake(403))).ok).toBe(false);
    expect((await probeFal("k", fake(404))).ok).toBe(true);
  });
  it("sends the fal auth header", async () => {
    let auth = "";
    const spy = (async (_u: RequestInfo | URL, init?: RequestInit) => {
      auth = (init?.headers as Record<string, string>).Authorization ?? "";
      return new Response("{}", { status: 404 });
    }) as unknown as typeof fetch;
    await probeFal("mykey", spy);
    expect(auth).toBe("Key mykey");
  });
  it("network failure is not ok and says why", async () => {
    const r = await probeFal("k", boom);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("network");
  });
});
