import { describe, expect, it } from "vitest";
import { buildStatus } from "../server/status";
import { defaultState } from "../server/state";

const deps = (over: Partial<Parameters<typeof buildStatus>[0]> = {}) => ({
  env: { FAL_KEY: "k" } as Record<string, string | undefined>,
  probes: { fal: async () => ({ ok: true, detail: "ok" }) },
  artifacts: { conceptCount: async () => 2, glbExists: async () => false, loreExists: async () => false },
  deployment: async () => null,
  state: async () => ({ ...defaultState(), approvedConceptId: "c1" }),
  ...over,
});

describe("buildStatus", () => {
  it("never probes a missing key and reports it as not set", async () => {
    let probed = false;
    const s = await buildStatus(deps({
      env: {},
      probes: { fal: async () => { probed = true; return { ok: true, detail: "" }; } },
    }));
    expect(s.keys.fal).toEqual({ present: false, valid: null, detail: "not set" });
    expect(probed).toBe(false);
  });
  it("carries the probe outcome for a present key", async () => {
    const bad = await buildStatus(deps({ probes: { fal: async () => ({ ok: false, detail: "fal rejected the key" }) }, env: { FAL_KEY: "other" } }));
    expect(bad.keys.fal.valid).toBe(false);
    expect(bad.keys.fal.detail).toContain("rejected");
  });
  it("reflects artifacts, approval, and lore status", async () => {
    const s = await buildStatus(deps());
    expect(s.concept).toEqual({ count: 2, approved: true });
    expect(s.model.status).toBe("none");
    expect(s.lore.status).toBe("none");
    expect(s.deployment.url).toBeNull();
  });
});
