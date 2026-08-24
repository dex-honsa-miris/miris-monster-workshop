import { describe, expect, it } from "vitest";
import { annotationMarkup, esc, statsMarkup } from "../src/scene/card-html";
import type { MonsterLore } from "../server/lore-schema";

const LORE: MonsterLore = {
  name: "Gloamroot",
  epithet: "the Lantern-Eyed",
  lore: "Grown from a forgotten shrine.",
  element: "bloom",
  stats: { might: 6, agility: 3, arcana: 8, mischief: 5, resolve: 7 },
  abilities: [
    { name: "Zap Tickle", blurb: "A playful jolt that leaves you giggling" },
    { name: "Cloud Dash", blurb: "Swiftly moves within its misty form" },
  ],
  annotations: [
    { slot: "crown", label: "Moss Crest", blurb: "Blooms when happy" },
    { slot: "face", label: "Lantern Eyes", blurb: "Store fireflies" },
    { slot: "base", label: "Root Feet", blurb: "Anchor in storms" },
  ],
};

describe("esc", () => {
  it("neutralizes markup in untrusted text", () => {
    expect(esc('<img src=x onerror=alert(1)> & "quotes"')).toBe("&lt;img src=x onerror=alert(1)&gt; &amp; &quot;quotes&quot;");
  });
});

describe("stats / annotation markup", () => {
  it("stats carries name, epithet, element, and bar widths from the 1-10 scale", () => {
    const html = statsMarkup(LORE);
    expect(html).toContain("Gloamroot");
    expect(html).toContain("the Lantern-Eyed");
    expect(html).toContain("ELEMENT / BLOOM");
    expect(html).toContain("width:60%"); // might 6
    expect(html).toContain("width:80%"); // arcana 8
  });
  it("annotation escapes its fields", () => {
    expect(annotationMarkup({ label: "<b>", blurb: "<i>" })).toContain("&lt;b&gt;");
    expect(annotationMarkup({ label: "<b>", blurb: "<i>" })).toContain("&lt;i&gt;");
  });
});
