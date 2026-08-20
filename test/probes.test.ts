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

  // Auth-header assertions
  it("fal: sends Authorization: Key header", async () => {
    let capturedHeaders: HeadersInit | undefined;
    const spy = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await probeFal("mykey", spy);
    const headers = capturedHeaders as Record<string, string>;
    expect(headers.Authorization).toBe("Key mykey");
  });

  it("gateway: sends Authorization: Bearer header", async () => {
    let capturedHeaders: HeadersInit | undefined;
    const spy = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await probeGateway("mykey", spy);
    const headers = capturedHeaders as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer mykey");
  });

  it("miris: sends Authorization: Bearer header", async () => {
    let capturedHeaders: HeadersInit | undefined;
    const spy = (async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers;
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await probeMiris("mytoken", "https://api.example", spy);
    const headers = capturedHeaders as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer mytoken");
  });

  // URL assertions
  it("gateway: uses exact gateway URL", async () => {
    let capturedUrl = "";
    const spy = (async (url: RequestInfo | URL) => {
      capturedUrl = String(url);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await probeGateway("k", spy);
    expect(capturedUrl).toBe("https://ai-gateway.vercel.sh/v1/models");
  });

  it("miris: constructs full URL with /v1/me path", async () => {
    let capturedUrl = "";
    const spy = (async (url: RequestInfo | URL) => {
      capturedUrl = String(url);
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    await probeMiris("t", "https://api.example", spy);
    expect(capturedUrl).toBe("https://api.example/v1/me");
  });

  // Error-path coverage for all probes
  it("fal: 403 is also rejected", async () => {
    const r = await probeFal("k", fake(403));
    expect(r.ok).toBe(false);
  });

  it("gateway: network failure is not ok and says why", async () => {
    const r = await probeGateway("k", boom);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("network");
  });

  it("miris: network failure is not ok and says why", async () => {
    const r = await probeMiris("t", "https://api.example", boom);
    expect(r.ok).toBe(false);
    expect(r.detail).toContain("network");
  });
});
