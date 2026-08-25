import { describe, expect, it } from "vitest";
import { appendSpark, dealSparks, redealOne } from "../src/app/sparks";
import { PATH_IDS, PATHS } from "../server/paths";

const GROUPS = [
  { label: "object", options: ["a mask", "a ring", "a drum"] },
  { label: "origin", options: ["from Crete", "from Kyoto"] },
];

/** Deterministic "RNG": returns queued values in order. */
const seq = (...vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length]!;
};

describe("dealSparks", () => {
  it("deals exactly one option per group, in group order", () => {
    const dealt = dealSparks(GROUPS, seq(0, 0.9));
    expect(dealt).toEqual([
      { group: "object", text: "a mask" },
      { group: "origin", text: "from Kyoto" },
    ]);
  });
});

describe("redealOne", () => {
  it("never redeals the chip that was just used", () => {
    // With 'a mask' excluded the pool is [ring, drum]; any rand must land there.
    for (const r of [0, 0.4, 0.99]) {
      const next = redealOne(GROUPS, { group: "object", text: "a mask" }, seq(r));
      expect(next.text).not.toBe("a mask");
    }
  });

  it("returns the same chip when the group has a single option", () => {
    const solo = [{ label: "only", options: ["one"] }];
    expect(redealOne(solo, { group: "only", text: "one" }, seq(0))).toEqual({ group: "only", text: "one" });
  });
});

describe("appendSpark", () => {
  it("starts an empty prompt verbatim", () => {
    expect(appendSpark("", "a ceremonial mask")).toBe("a ceremonial mask");
  });

  it("comma-joins mid-sentence and respects typed punctuation", () => {
    expect(appendSpark("a ceremonial mask", "from Crete")).toBe("a ceremonial mask, from Crete");
    expect(appendSpark("a ceremonial mask, ", "from Crete")).toBe("a ceremonial mask, from Crete");
  });
});

describe("path word banks", () => {
  it("every path has 3 groups with enough variety to reroll", () => {
    for (const id of PATH_IDS) {
      const sparks = PATHS[id].sparks;
      expect(sparks).toHaveLength(3);
      for (const g of sparks) {
        expect(g.options.length).toBeGreaterThanOrEqual(8);
        expect(new Set(g.options).size).toBe(g.options.length); // no dupes
      }
    }
  });

  it("fragments are lowercase-start so they read naturally mid-sentence", () => {
    for (const id of PATH_IDS) {
      for (const g of PATHS[id].sparks) {
        for (const o of g.options) expect(o[0]).toBe(o[0]!.toLowerCase());
      }
    }
  });
});
