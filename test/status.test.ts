import { describe, expect, it } from "vitest";
import { buildStatus } from "../server/status";
import { defaultState } from "../server/state";

const deps = (over: Partial<Parameters<typeof buildStatus>[0]> = {}) => ({
  env: { FAL_KEY: "k", AI_GATEWAY_API_KEY: "g", MIRIS_API_TOKEN: "" },
  probes: {
    fal: async () => ({ ok: true, detail: "ok" }),
    gateway: async () => ({ ok: false, detail: "gateway said 401" }),
    miris: async () => ({ ok: true, detail: "ok" }),
  },
  artifacts: { conceptCount: async () => 2, glbExists: async () => false, loreExists: async () => false },
  deployment: async () => null,
  state: async () => ({ ...defaultState(), approvedConceptId: "c1" }),
  ...over,
});

describe("buildStatus", () => {
  it("never probes a missing key and reports it as not set", async () => {
    let probed = false;
    const s = await buildStatus(deps({ probes: { fal: async () => ({ ok: true, detail: "" }), gateway: async () => ({ ok: true, detail: "" }), miris: async () => { probed = true; return { ok: true, detail: "" }; } } }));
    expect(s.keys.miris).toEqual({ present: false, valid: null, detail: "not set" });
    expect(probed).toBe(false);
  });
  it("carries probe outcomes for present keys", async () => {
    const s = await buildStatus(deps());
    expect(s.keys.fal.valid).toBe(true);
    expect(s.keys.gateway.valid).toBe(false);
    expect(s.keys.gateway.detail).toContain("401");
  });
  it("reflects artifacts and approval", async () => {
    const s = await buildStatus(deps());
    expect(s.concept).toEqual({ count: 2, approved: true });
    expect(s.model.status).toBe("none");
    expect(s.deployment.url).toBeNull();
  });

  it("carries loreStatus into the lore status/error fields, independent of file readiness", async () => {
    const failed = await buildStatus(deps({ state: async () => ({ ...defaultState(), approvedConceptId: "c1", loreStatus: { status: "failed", error: "boom" } }) }));
    expect(failed.lore).toEqual({ ready: false, status: "failed", error: "boom" });
    const done = await buildStatus(deps({ artifacts: { conceptCount: async () => 2, glbExists: async () => false, loreExists: async () => true }, state: async () => ({ ...defaultState(), approvedConceptId: "c1", loreStatus: { status: "done", error: null } }) }));
    expect(done.lore).toEqual({ ready: true, status: "done", error: null });
  });
});
