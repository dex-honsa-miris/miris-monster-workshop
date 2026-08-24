// Pure shaping for the DOM HUD panels. Kept out of the components so the
// mappings that are easy to get quietly wrong -- the stat scale and the state
// glyphs -- are testable without rendering anything.
import type { ChecklistItem } from "./checklist-model";
import type { MonsterLore } from "../../server/lore-schema";

/** Row glyphs. A checklist reads faster with a shape per state than with
 * colour alone, which also keeps it legible to anyone who cannot separate the
 * green from the vermilion. */
export const STATE_ICON: Record<ChecklistItem["state"], string> = {
  done: "✓",
  error: "✗",
  doing: "◌",
  todo: "·",
};

export interface StatBar { label: string; value: number; pct: number }

/** Lore stats are authored on a 1-10 scale; the bars are percentages. Values
 * outside the scale are clamped rather than allowed to overflow the track,
 * because the numbers come from a language model. */
export function statBars(lore: MonsterLore): StatBar[] {
  return Object.entries(lore.stats).map(([label, raw]) => {
    const value = Number(raw);
    const safe = Number.isFinite(value) ? value : 0;
    return { label, value: safe, pct: Math.max(0, Math.min(100, safe * 10)) };
  });
}
