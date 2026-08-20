import { describe, expect, it } from "vitest";

describe("toolchain", () => {
  it("runs TypeScript tests", () => {
    const x: number = 2 + 2;
    expect(x).toBe(4);
  });
});
