import { describe, expect, it } from "vitest";
import { parseLore } from "../server/lore-schema";

const VALID = {
  name: "Gloamroot",
  epithet: "the Lantern-Eyed",
  lore: "Grown from a forgotten forest shrine, Gloamroot wanders at dusk collecting lost lights.",
  element: "bloom",
  stats: { might: 6, agility: 3, arcana: 8, mischief: 5, resolve: 7 },
  abilities: [
    { name: "Zap Tickle", blurb: "A playful jolt that leaves you giggling" },
    { name: "Cloud Dash", blurb: "Swiftly moves within its misty form" },
  ],
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

describe("prose normalization", () => {
  it("replaces em and en dashes in every model-written field", () => {
    const doc = parseLore({
      ...VALID,
      name: "Brew\u2014steeple",
      lore: "A stance\u2014gains resolve\u2013always",
      abilities: [
        { name: "Steep\u2014Patience", blurb: "Defensive stance\u2014gains resolve" },
        { name: "Fog", blurb: "Mist\u2013thick and warm" },
      ],
      annotations: [
        { slot: "crown", label: "Tea\u2014Lid", blurb: "Simmering\u2014just right" },
        { slot: "face", label: "Frown", blurb: "Displeased" },
        { slot: "base", label: "Shell", blurb: "Sturdy" },
      ],
    });
    const all = JSON.stringify(doc);
    expect(all).not.toMatch(/[\u2014\u2013]/);
    expect(doc.name).toBe("Brew - steeple");
    expect(doc.abilities[0]!.blurb).toContain(" - gains resolve");
  });
});
