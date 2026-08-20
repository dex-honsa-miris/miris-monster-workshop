import { describe, expect, it } from "vitest";
import { checklistFrom } from "../src/app/checklist-model";
import type { WorkshopStatus } from "../server/status";

const BASE: WorkshopStatus = {
  keys: {
    fal: { present: true, valid: true, detail: "ok" },
    gateway: { present: true, valid: false, detail: "gateway said 401" },
    miris: { present: false, valid: null, detail: "not set" },
  },
  concept: { count: 0, approved: false },
  model: { status: "none", glbPath: null, error: null },
  lore: { ready: false },
  upload: { glbSha: null, assetId: null, state: "none", error: null },
  deployment: { url: null },
};

describe("checklistFrom", () => {
  it("maps key states to done/error/todo", () => {
    const setup = checklistFrom(BASE)[0]!;
    const byId = Object.fromEntries(setup.items.map((i) => [i.id, i]));
    expect(byId["key-fal"]!.state).toBe("done");
    expect(byId["key-gateway"]!.state).toBe("error");
    expect(byId["key-gateway"]!.detail).toContain("401");
    expect(byId["key-miris"]!.state).toBe("todo");
  });
  it("shows the model as doing while running and error on failure", () => {
    const doing = checklistFrom({ ...BASE, model: { status: "running", glbPath: null, error: null } });
    expect(doing[1]!.items.find((i) => i.id === "model")!.state).toBe("doing");
    const failed = checklistFrom({ ...BASE, model: { status: "failed", glbPath: null, error: "boom" } });
    expect(failed[1]!.items.find((i) => i.id === "model")!.state).toBe("error");
  });
  it("null status renders an all-todo checklist (app booting)", () => {
    const phases = checklistFrom(null);
    expect(phases.length).toBe(4);
    expect(phases.every((p) => p.items.every((i) => i.state === "todo"))).toBe(true);
  });
  it("deployment url completes the final phase", () => {
    const done = checklistFrom({ ...BASE, deployment: { url: "https://x.vercel.app" } });
    expect(done[3]!.items[0]!.state).toBe("done");
    expect(done[3]!.items[0]!.detail).toBe("https://x.vercel.app");
  });
});
