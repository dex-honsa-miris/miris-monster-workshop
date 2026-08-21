import { describe, expect, it } from "vitest";
import { annotationMarkup, checklistMarkup, conceptMarkup, esc, messageMarkup, statsMarkup } from "../src/scene/card-html";
import { layoutChecklist } from "../src/scene/cards";
import type { Phase } from "../src/app/checklist-model";
import type { MonsterLore } from "../server/lore-schema";

const PHASES: Phase[] = [
  {
    title: "Get set up",
    items: [
      { id: "stackblitz", label: "Sign into StackBlitz, then fork", state: "done" },
      { id: "key-fal", label: "fal.ai key in .env", state: "error", detail: "fal rejected the key", href: "https://fal.ai/dashboard/keys" },
    ],
  },
];

const LORE: MonsterLore = {
  name: "Gloamroot",
  epithet: "the Lantern-Eyed",
  lore: "Grown from a forgotten shrine.",
  element: "bloom",
  stats: { might: 6, agility: 3, arcana: 8, mischief: 5, resolve: 7 },
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

describe("checklistMarkup", () => {
  it("renders every item at the SAME y the painter/hit-test layout uses", () => {
    const { rows } = layoutChecklist(PHASES);
    const html = checklistMarkup(PHASES, null);
    for (const row of rows) {
      expect(html).toContain(`top:${row.y0}px`);
    }
    expect(html).toContain("Sign into StackBlitz, then fork");
  });
  it("marks the hovered row and shows error detail", () => {
    const html = checklistMarkup(PHASES, "key-fal");
    expect(html).toContain('class="row state-error hover"');
    expect(html).toContain("fal rejected the key");
    expect(checklistMarkup(PHASES, null)).not.toContain('hover"');
  });
  it("escapes labels and details", () => {
    const evil: Phase[] = [{ title: "<b>", items: [{ id: "x", label: "<script>", state: "error", detail: "<i>" }] }];
    const html = checklistMarkup(evil, null);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("stats / annotation / concept / message markup", () => {
  it("stats carries name, epithet, element, and bar widths from the 1-10 scale", () => {
    const html = statsMarkup(LORE);
    expect(html).toContain("Gloamroot");
    expect(html).toContain("the Lantern-Eyed");
    expect(html).toContain("ELEMENT / BLOOM");
    expect(html).toContain("width:60%"); // might 6
    expect(html).toContain("width:80%"); // arcana 8
  });
  it("annotation and message escape their fields", () => {
    expect(annotationMarkup({ label: "<x>", blurb: "&" })).toContain("&lt;x&gt;");
    expect(messageMarkup({ title: "<t>", body: "<b>" })).toContain("&lt;t&gt;");
  });
  it("concept renders the prompt, a take counter past the first, and a CORS-safe img only when a url exists", () => {
    const none = conceptMarkup({ imageUrl: null, prompt: "a moss golem", rerolls: 1 });
    expect(none).not.toContain("<img");
    expect(none).toContain("a moss golem");
    const withImg = conceptMarkup({ imageUrl: "https://cdn.fal.ai/x.png", prompt: "p", rerolls: 3 });
    expect(withImg).toContain('crossorigin="anonymous"');
    expect(withImg).toContain("TAKE 3");
  });
});
