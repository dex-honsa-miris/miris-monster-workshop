import { describe, expect, it } from "vitest";
import { wrapText } from "../src/scene/cards";

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
