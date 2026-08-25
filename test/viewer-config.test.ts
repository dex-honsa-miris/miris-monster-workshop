import { describe, expect, it } from "vitest";
import { loadConfig } from "../viewer/config";

const LORE = {
  name: "Gloamroot", epithet: "the Lantern-Eyed", lore: "x", element: "bloom",
  stats: { might: 1, agility: 1, arcana: 1, mischief: 1, resolve: 1 }, abilities: [{ name: "a", blurb: "b" }, { name: "c", blurb: "d" }],
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
  it("rejects a missing assetId", () => {
    expect(() => loadConfig({ assetId: "", lore: LORE })).toThrow();
  });

  it("degrades non-monster or invalid lore to null instead of breaking the viewer", () => {
    // Product/artifact documents (and garbage) have no codex card here; the
    // model must still stream in.
    expect(loadConfig({ assetId: "a", lore: { nope: 1 } }).lore).toBeNull();
    expect(loadConfig({ assetId: "a", lore: { kind: "product", name: "Kettle" } }).lore).toBeNull();
  });
});
