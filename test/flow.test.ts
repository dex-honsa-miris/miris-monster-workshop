import { describe, expect, it } from "vitest";
import { flowPhase } from "../src/app/flow";
import type { WorkshopStatus } from "../server/status";

const status = (over: Partial<WorkshopStatus>): WorkshopStatus => ({
  monsters: [],
  currentMonsterId: null,
  keys: { fal: { present: true, valid: true, detail: "" } },
  concept: { count: 0, approved: false },
  model: { status: "none", glbPath: null, error: null },
  lore: { ready: false, status: "none", error: null },
  discoveries: [],
  upload: { glbSha: null, assetId: null, state: "none", error: null },
  deployment: { url: null },
  ...over,
});

describe("flowPhase", () => {
  it("is setup with no status or invalid keys", () => {
    expect(flowPhase(null)).toBe("setup");
    expect(flowPhase(status({ keys: { fal: { present: false, valid: null, detail: "" } } }))).toBe("setup");
  });
  it("moves to create once keys validate", () => {
    expect(flowPhase(status({}))).toBe("create");
  });
  it("is summoning while the model runs, reveal when done", () => {
    expect(flowPhase(status({ model: { status: "running", glbPath: null, error: null } }))).toBe("summoning");
    expect(flowPhase(status({ model: { status: "done", glbPath: "x", error: null } }))).toBe("reveal");
  });
  it("a failed model returns to create (with the error shown there)", () => {
    expect(flowPhase(status({ model: { status: "failed", glbPath: null, error: "e" } }))).toBe("create");
  });
});
