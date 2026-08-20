import { describe, expect, it } from "vitest";
import { MockLanguageModelV2 } from "ai/test";
import { generateLore } from "../server/lore";

const DOC = {
  name: "Gloamroot", epithet: "the Lantern-Eyed",
  lore: "Grown from a forgotten shrine.", element: "bloom",
  stats: { might: 6, agility: 3, arcana: 8, mischief: 5, resolve: 7 },
  annotations: [
    { slot: "crown", label: "Moss Crest", blurb: "Blooms when happy" },
    { slot: "face", label: "Lantern Eyes", blurb: "Store fireflies" },
    { slot: "base", label: "Root Feet", blurb: "Anchor in storms" },
  ],
};

function mockModel(json: unknown) {
  return new MockLanguageModelV2({
    doGenerate: async () => ({
      finishReason: "stop",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      content: [{ type: "text", text: JSON.stringify(json) }],
      warnings: [],
    }),
  });
}

describe("generateLore", () => {
  it("returns schema-validated lore from the model", async () => {
    const lore = await generateLore("moss golem", { model: mockModel(DOC) });
    expect(lore.name).toBe("Gloamroot");
    expect(lore.annotations.length).toBe(3);
  });
  it("rejects malformed model output rather than passing it through", async () => {
    await expect(generateLore("x", { model: mockModel({ nope: true }) })).rejects.toThrow();
  });
});
