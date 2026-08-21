import { describe, expect, it } from "vitest";
import { checklistFrom } from "../src/app/checklist-model";
import type { WorkshopStatus } from "../server/status";

const BASE: WorkshopStatus = {
  keys: { fal: { present: true, valid: false, detail: "fal rejected the key" } },
  concept: { count: 0, approved: false },
  model: { status: "none", glbPath: null, error: null },
  lore: { ready: false, status: "none", error: null },
  loreStatus: undefined as never,
  upload: { glbSha: null, assetId: null, state: "none", error: null },
  deployment: { url: null },
} as unknown as WorkshopStatus;

describe("checklistFrom", () => {
  it("maps key states to done/error/todo", () => {
    const setup = checklistFrom(BASE)[0]!;
    const byId = Object.fromEntries(setup.items.map((i) => [i.id, i]));
    expect(byId["key-fal"]!.state).toBe("error");
    expect(byId["key-fal"]!.detail).toContain("rejected");
    const ok = checklistFrom({ ...BASE, keys: { fal: { present: true, valid: true, detail: "" } } });
    expect(ok[0]!.items.find((i) => i.id === "key-fal")!.state).toBe("done");
    const missing = checklistFrom({ ...BASE, keys: { fal: { present: false, valid: null, detail: "not set" } } });
    expect(missing[0]!.items.find((i) => i.id === "key-fal")!.state).toBe("todo");
  });
  it("shows the model as doing while running and error on failure", () => {
    const doing = checklistFrom({ ...BASE, model: { status: "running", glbPath: null, error: null } });
    expect(doing[1]!.items.find((i) => i.id === "model")!.state).toBe("doing");
    const failed = checklistFrom({ ...BASE, model: { status: "failed", glbPath: null, error: "boom" } });
    expect(failed[1]!.items.find((i) => i.id === "model")!.state).toBe("error");
  });
  it("shows lore as doing while running and error with detail on failure", () => {
    const doing = checklistFrom({ ...BASE, lore: { ready: false, status: "running", error: null } });
    expect(doing[1]!.items.find((i) => i.id === "lore")!.state).toBe("doing");
    const failed = checklistFrom({ ...BASE, lore: { ready: false, status: "failed", error: "lore boom" } });
    const loreItem = failed[1]!.items.find((i) => i.id === "lore")!;
    expect(loreItem.state).toBe("error");
    expect(loreItem.detail).toBe("lore boom");
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

describe("checklistFrom environment", () => {
  it("checks item zero when running inside StackBlitz", () => {
    const phases = checklistFrom(BASE, { inStackBlitz: true });
    expect(phases[0]!.items[0]!.state).toBe("done");
    const local = checklistFrom(BASE, { inStackBlitz: false });
    expect(local[0]!.items[0]!.state).toBe("todo");
  });
  it("the fal row links to its dashboard and publish links to the portal", () => {
    const phases = checklistFrom(BASE);
    const setup = Object.fromEntries(phases[0]!.items.map((i) => [i.id, i]));
    expect(setup["key-fal"]!.href).toContain("fal.ai");
    const publish = phases[2]!.items[0]!;
    expect(publish.id).toBe("asset-id");
    expect(publish.href).toContain("app.miris.com");
  });
  it("pasting an asset id completes the publish phase", () => {
    const done = checklistFrom({ ...BASE, upload: { glbSha: null, assetId: "a-1", state: "ready", error: null } });
    expect(done[2]!.items[0]!.state).toBe("done");
    expect(done[2]!.items[0]!.detail).toBe("a-1");
  });
});
