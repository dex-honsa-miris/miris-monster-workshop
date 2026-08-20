import { describe, expect, it } from "vitest";
import { checklistRowAt, layoutChecklist, wrapText } from "../src/scene/cards";
import type { Phase } from "../src/app/checklist-model";

describe("wrapText", () => {
  it("wraps on word boundaries within the budget", () => {
    expect(wrapText("the quick brown fox jumps", 11)).toEqual(["the quick", "brown fox", "jumps"]);
  });
  it("hard-breaks a single overlong word", () => {
    expect(wrapText("supercalifragilistic", 8)).toEqual(["supercal", "ifragili", "stic"]);
  });
  it("returns [] for empty input", () => {
    expect(wrapText("  ", 10)).toEqual([]);
  });
});

describe("layoutChecklist / checklistRowAt", () => {
  const PHASES: Phase[] = [
    {
      title: "Get set up",
      items: [
        { id: "stackblitz", label: "Sign in", state: "done" },
        { id: "key-fal", label: "fal key", state: "todo", href: "https://fal.ai/dashboard/keys" },
        { id: "key-bad", label: "bad key", state: "error", detail: "a detail line that wraps onto more than one line for sure, absolutely certain", href: "https://x" },
      ],
    },
    { title: "Summon", items: [{ id: "concept", label: "Generate", state: "todo" }] },
  ];

  it("emits one row per item, in order, carrying hrefs", () => {
    const { rows } = layoutChecklist(PHASES);
    expect(rows.map((r) => r.id)).toEqual(["stackblitz", "key-fal", "key-bad", "concept"]);
    expect(rows[1]!.href).toContain("fal.ai");
    expect(rows[0]!.href).toBeUndefined();
  });

  it("rows below an error detail shift down by the wrapped lines", () => {
    const { rows } = layoutChecklist(PHASES);
    const gapAfterPlain = rows[1]!.y0 - rows[0]!.y0;
    const gapAfterDetail = rows[3]!.y0 - rows[2]!.y0;
    expect(gapAfterDetail).toBeGreaterThan(gapAfterPlain);
  });

  it("hit-tests the row band and misses padding and gaps", () => {
    const { rows } = layoutChecklist(PHASES);
    const r = rows[1]!;
    const midY = (r.y0 + r.y1) / 2;
    expect(checklistRowAt(rows, 100, midY, 512)?.id).toBe("key-fal");
    expect(checklistRowAt(rows, 4, midY, 512)).toBeNull(); // left padding
    expect(checklistRowAt(rows, 100, r.y1 + 200, 512)?.id).not.toBe("key-fal");
  });
});
