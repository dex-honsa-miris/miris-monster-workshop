import { describe, expect, it } from "vitest";
import { appendSpark, dealSparks, redealOne } from "../src/app/sparks";
import { PATH_IDS, PATHS } from "../server/paths";
import { parseSparksOutput } from "../server/sparks";

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

describe("parseSparksOutput (LLM batch)", () => {
  const batch = (groups: unknown) => ({ sparks: JSON.stringify({ groups }) });
  const good = [
    { label: "object", options: ["a small ceramic jug", "an ornate brooch", "a carved figurine", "a coin hoard", "a bone comb"] },
    { label: "origin", options: ["from Roman Gaul", "from an Egyptian tomb", "from Mayan lowlands", "from ancient Greece"] },
    { label: "detail", options: ["with traces of pigment", "covered in runes", "chipped on the rim", "smelling of cedar"] },
  ];

  it("parses a stringified batch off the workflow's sparks field", () => {
    const groups = parseSparksOutput(batch(good));
    expect(groups).toHaveLength(3);
    expect(groups[0]!.options).toContain("a small ceramic jug");
  });

  it("strips markdown fences the model sometimes adds", () => {
    const fenced = { sparks: "```json\n" + JSON.stringify({ groups: good }) + "\n```" };
    expect(parseSparksOutput(fenced)).toHaveLength(3);
  });

  it("lowercases first characters and drops duplicates and trailing periods", () => {
    const messy = [
      { label: "object", options: ["A ceremonial mask.", "a ceremonial mask", "a drum", "a ring", "a comb"] },
      good[1], good[2],
    ];
    const groups = parseSparksOutput(batch(messy));
    expect(groups[0]!.options).toEqual(["a ceremonial mask", "a drum", "a ring", "a comb"]);
  });

  it("rejects a batch that is not exactly three groups", () => {
    expect(() => parseSparksOutput(batch(good.slice(0, 2)))).toThrow();
  });
});
