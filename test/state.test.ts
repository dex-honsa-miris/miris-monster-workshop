import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";

describe("state", () => {
  beforeEach(() => {
    process.env.WORKSHOP_DIR = mkdtempSync(join(tmpdir(), "ws-"));
  });

  it("returns the default state when no file exists", async () => {
    const { readState, defaultState } = await import("../server/state");
    expect(await readState()).toEqual(defaultState());
  });

  it("round-trips a patch and deep-merges model/upload", async () => {
    const { readState, patchState } = await import("../server/state");
    await patchState({ approvedConceptId: "c1" });
    await patchState({ model: { status: "running" } as never });
    const s = await readState();
    expect(s.approvedConceptId).toBe("c1");
    expect(s.model.status).toBe("running");
    expect(s.model.glbPath).toBeNull(); // deep merge preserved sibling
  });

  it("survives a corrupt state file", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { readState, defaultState, stateFile, workshopDir } = await import("../server/state");
    await mkdir(workshopDir(), { recursive: true });
    await writeFile(stateFile(), "{not json");
    expect(await readState()).toEqual(defaultState());
  });

  it("serializes concurrent patches so both land", async () => {
    const { readState, patchState } = await import("../server/state");
    await Promise.all([
      patchState({ model: { status: "running" } as never }),
      patchState({ approvedConceptId: "c1" }),
    ]);
    const s = await readState();
    expect(s.model.status).toBe("running");
    expect(s.approvedConceptId).toBe("c1");
  });
});
