import { describe, expect, it } from "vitest";
import { normalStrengthFor } from "../src/scene/Monster";

describe("normalStrengthFor", () => {
  it("lets the map do all the work on a light mesh", () => {
    expect(normalStrengthFor(20_000)).toBe(1);
    expect(normalStrengthFor(60_000)).toBe(1);
  });

  it("damps it hard once the geometry carries the same detail", () => {
    // ~300k is where a doubled-up normal map reads as grit on the seams.
    expect(normalStrengthFor(300_000)).toBe(0.3);
  });

  it("never inverts or exceeds the map's authored strength", () => {
    for (let t = 0; t <= 400_000; t += 10_000) {
      const v: number = normalStrengthFor(t);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });

  it("falls off monotonically between the two anchors", () => {
    const xs = [60_000, 100_000, 150_000, 200_000, 250_000].map((n) => normalStrengthFor(n));
    for (let i = 1; i < xs.length; i++) expect(xs[i]!).toBeLessThan(xs[i - 1]!);
  });
});
