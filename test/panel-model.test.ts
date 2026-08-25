import { describe, expect, it } from "vitest";
import { STATE_ICON, statBars } from "../src/app/panel-model";
import type { MonsterLore } from "../server/lore-schema";

const lore = (stats: Record<string, number>): MonsterLore =>
  ({
    kind: "monster",
    name: "Gloamroot",
    epithet: "the Lantern-Eyed",
    lore: "Grown from a forgotten shrine.",
    element: "bloom",
    stats,
    abilities: [{ name: "Zap Tickle", blurb: "A playful jolt" }],
    annotations: [],
  }) as unknown as MonsterLore;

describe("statBars", () => {
  it("maps the authored 1-10 scale onto percentages, in order", () => {
    const bars = statBars(lore({ might: 6, agility: 3, arcana: 10 }));
    expect(bars.map((b) => b.label)).toEqual(["might", "agility", "arcana"]);
    expect(bars.map((b) => b.pct)).toEqual([60, 30, 100]);
  });

  it("keeps the raw value alongside the bar width", () => {
    expect(statBars(lore({ might: 7 }))[0]).toEqual({ label: "might", value: 7, pct: 70 });
  });

  it("clamps out-of-scale values so a bar cannot overflow its track", () => {
    // The numbers are model-written, so 0 and 40 both turn up in practice.
    const bars = statBars(lore({ low: -4, high: 40 }));
    expect(bars.map((b) => b.pct)).toEqual([0, 100]);
  });

  it("treats a non-numeric stat as zero rather than emitting NaN%", () => {
    const bars = statBars(lore({ odd: "eight" as unknown as number }));
    expect(bars[0]!.pct).toBe(0);
    expect(bars[0]!.value).toBe(0);
  });
});

describe("STATE_ICON", () => {
  it("gives every checklist state its own glyph, so state does not rest on colour alone", () => {
    const glyphs = Object.values(STATE_ICON);
    expect(glyphs).toHaveLength(4);
    expect(new Set(glyphs).size).toBe(4);
  });
});
