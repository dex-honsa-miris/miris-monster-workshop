import { describe, expect, it } from "vitest";
import { loadConfig } from "../viewer/config";

const LORE = {
  name: "Gloamroot", epithet: "the Lantern-Eyed", lore: "x", element: "bloom",
  stats: { might: 1, agility: 1, arcana: 1, mischief: 1, resolve: 1 },
  annotations: [
    { slot: "crown", label: "a", blurb: "b" },
    { slot: "face", label: "c", blurb: "d" },
    { slot: "base", label: "e", blurb: "f" },
  ],
};

describe("viewer loadConfig", () => {
  it("accepts a valid config", () => {
    expect(loadConfig({ assetId: "a-1", lore: LORE }).assetId).toBe("a-1");
  });
  it("rejects a missing assetId or invalid lore", () => {
    expect(() => loadConfig({ assetId: "", lore: LORE })).toThrow();
    expect(() => loadConfig({ assetId: "a", lore: { nope: 1 } })).toThrow();
  });
});
