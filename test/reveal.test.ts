import { describe, expect, it } from "vitest";
import { FLASH_IN, revealFlash } from "../src/scene/spell/reveal";

describe("revealFlash", () => {
  it("is dark before the completion beat is armed", () => {
    expect(revealFlash(null)).toBe(0);
  });

  it("stays dark through the charge, so nothing leaks before the snap", () => {
    expect(revealFlash(0)).toBe(0);
    expect(revealFlash(FLASH_IN)).toBe(0);
  });

  it("reaches full white shortly after the snap and holds there", () => {
    expect(revealFlash(0.3)).toBe(1);
    expect(revealFlash(0.35)).toBe(1);
    expect(revealFlash(0.4)).toBe(1);
  });

  it("burns off completely before the spell finishes", () => {
    // If any white survived to the end it would freeze onto the creature,
    // because the overlay unmounts with the effect rather than fading further.
    expect(revealFlash(0.9)).toBe(0);
    expect(revealFlash(1)).toBe(0);
  });

  it("decays monotonically across the tail", () => {
    const tail = [0.45, 0.55, 0.65, 0.75, 0.85].map(revealFlash);
    for (let i = 1; i < tail.length; i++) expect(tail[i]!).toBeLessThan(tail[i - 1]!);
  });

  it("never leaves the 0..1 range an opacity can use", () => {
    for (let t = 0; t <= 1.0001; t += 0.02) {
      const v = revealFlash(t);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
  });
});
