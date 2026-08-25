import { describe, expect, it } from "vitest";
import { smoothGlb } from "../server/mesh-smooth";

/** Builds a minimal valid GLB: one indexed triangle-strip "staircase" ribbon
 * whose y alternates 0 / STEP -- the 1D version of the voxel stair-steps the
 * smoother exists to remove. Two vertices per x share a position ("UV seam"
 * clones) to exercise the welding path. */
const STEP = 0.2;
const COLS = 12;
function staircaseGlb(): { glb: ArrayBuffer; posOffset: number; count: number } {
  const positions: number[] = [];
  const normals: number[] = [];
  const indices: number[] = [];
  for (let x = 0; x < COLS; x++) {
    const y = x % 2 === 0 ? 0 : STEP;
    // Two clones of the same position, as a UV seam would produce.
    positions.push(x, y, 0, x, y, 0);
    normals.push(0, 1, 0, 0, 1, 0);
    positions.push(x, y, 1, x, y, 1);
    normals.push(0, 1, 0, 0, 1, 0);
  }
  for (let x = 0; x < COLS - 1; x++) {
    const a = x * 4, b = x * 4 + 2, c = (x + 1) * 4, d = (x + 1) * 4 + 2;
    indices.push(a, b, c, b, d, c);
  }
  const pos = new Float32Array(positions);
  const nrm = new Float32Array(normals);
  const idx = new Uint16Array(indices);
  const idxPadded = new Uint8Array(Math.ceil(idx.byteLength / 4) * 4);
  idxPadded.set(new Uint8Array(idx.buffer));

  const json = JSON.stringify({
    asset: { version: "2.0" },
    accessors: [
      { bufferView: 0, componentType: 5126, count: pos.length / 3, type: "VEC3" },
      { bufferView: 1, componentType: 5126, count: nrm.length / 3, type: "VEC3" },
      { bufferView: 2, componentType: 5123, count: idx.length, type: "SCALAR" },
    ],
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: pos.byteLength },
      { buffer: 0, byteOffset: pos.byteLength, byteLength: nrm.byteLength },
      { buffer: 0, byteOffset: pos.byteLength + nrm.byteLength, byteLength: idx.byteLength },
    ],
    buffers: [{ byteLength: pos.byteLength + nrm.byteLength + idxPadded.byteLength }],
    meshes: [{ primitives: [{ attributes: { POSITION: 0, NORMAL: 1 }, indices: 2 }] }],
  });
  const jsonBytes = new TextEncoder().encode(json.padEnd(Math.ceil(json.length / 4) * 4, " "));
  const binLen = pos.byteLength + nrm.byteLength + idxPadded.byteLength;
  const total = 12 + 8 + jsonBytes.length + 8 + binLen;
  const glb = new ArrayBuffer(total);
  const dv = new DataView(glb);
  const u8 = new Uint8Array(glb);
  dv.setUint32(0, 0x46546c67, true); // glTF
  dv.setUint32(4, 2, true);
  dv.setUint32(8, total, true);
  dv.setUint32(12, jsonBytes.length, true);
  dv.setUint32(16, 0x4e4f534a, true); // JSON
  u8.set(jsonBytes, 20);
  const binStart = 20 + jsonBytes.length;
  dv.setUint32(binStart, binLen, true);
  dv.setUint32(binStart + 4, 0x004e4942, true); // BIN
  u8.set(new Uint8Array(pos.buffer), binStart + 8);
  u8.set(new Uint8Array(nrm.buffer), binStart + 8 + pos.byteLength);
  u8.set(idxPadded, binStart + 8 + pos.byteLength + nrm.byteLength);
  return { glb, posOffset: binStart + 8, count: pos.length / 3 };
}

const ys = (glb: ArrayBuffer, posOffset: number, count: number): number[] => {
  const pos = new Float32Array(glb, posOffset, count * 3);
  const out: number[] = [];
  for (let v = 0; v < count; v++) out.push(pos[v * 3 + 1]!);
  return out;
};

const stepAmplitude = (y: number[]): number => {
  // Interior columns only: boundary vertices have fewer neighbours and are
  // legitimately less smoothed.
  const cols: number[] = [];
  for (let x = 2; x < COLS - 2; x++) cols.push(y[x * 4]!);
  let amp = 0;
  for (let i = 1; i < cols.length; i++) amp = Math.max(amp, Math.abs(cols[i]! - cols[i - 1]!));
  return amp;
};

describe("smoothGlb", () => {
  it("flattens stair-steps to a fraction of their original amplitude", () => {
    const { glb, posOffset, count } = staircaseGlb();
    expect(stepAmplitude(ys(glb, posOffset, count))).toBeCloseTo(STEP, 5);
    smoothGlb(glb);
    expect(stepAmplitude(ys(glb, posOffset, count))).toBeLessThan(STEP * 0.15);
  });

  it("keeps welded UV-seam clones at identical positions (no cracks)", () => {
    const { glb, posOffset, count } = staircaseGlb();
    smoothGlb(glb);
    const pos = new Float32Array(glb, posOffset, count * 3);
    for (let v = 0; v < count; v += 2) {
      expect(pos[v * 3 + 1]).toBe(pos[(v + 1) * 3 + 1]);
    }
  });

  it("rewrites normals as unit vectors", () => {
    const { glb, posOffset, count } = staircaseGlb();
    smoothGlb(glb);
    const nrm = new Float32Array(glb, posOffset + count * 3 * 4, count * 3);
    for (let v = 0; v < count; v++) {
      const l = Math.hypot(nrm[v * 3]!, nrm[v * 3 + 1]!, nrm[v * 3 + 2]!);
      expect(l).toBeGreaterThan(0.999);
      expect(l).toBeLessThan(1.001);
    }
  });

  it("leaves the byte length untouched (in-place contract)", () => {
    const { glb } = staircaseGlb();
    const before = glb.byteLength;
    expect(smoothGlb(glb).byteLength).toBe(before);
  });

  it("returns garbage input unchanged instead of throwing", () => {
    const junk = new TextEncoder().encode("not a glb at all").buffer as ArrayBuffer;
    const copy = junk.slice(0);
    expect(() => smoothGlb(junk)).not.toThrow();
    expect(new Uint8Array(junk)).toEqual(new Uint8Array(copy));
  });
});
