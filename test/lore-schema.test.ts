import { describe, expect, it } from "vitest";
import { parseLore } from "../server/lore-schema";

const VALID = {
  name: "Gloamroot",
  epithet: "the Lantern-Eyed",
  lore: "Grown from a forgotten forest shrine, Gloamroot wanders at dusk collecting lost lights.",
  element: "bloom",
  stats: { might: 6, agility: 3, arcana: 8, mischief: 5, resolve: 7 },
  annotations: [
    { slot: "crown", label: "Moss Crest", blurb: "Blooms when the monster is happy" },
    { slot: "face", label: "Lantern Eyes", blurb: "Store a century of fireflies" },
    { slot: "base", label: "Root Feet", blurb: "Anchor it against any storm" },
  ],
};

describe("parseLore", () => {
  it("accepts a valid document", () => {
    expect(parseLore(VALID).name).toBe("Gloamroot");
  });
  it("rejects stats outside 1-10", () => {
    expect(() => parseLore({ ...VALID, stats: { ...VALID.stats, might: 11 } })).toThrow();
  });
  it("rejects unknown slots and wrong annotation counts", () => {
    expect(() => parseLore({ ...VALID, annotations: [{ slot: "tail", label: "x", blurb: "y" }] })).toThrow();
    expect(() => parseLore({ ...VALID, annotations: VALID.annotations.slice(0, 2) })).toThrow();
  });
  it("rejects an element outside the fixed set", () => {
    expect(() => parseLore({ ...VALID, element: "plasma" })).toThrow();
  });
});
