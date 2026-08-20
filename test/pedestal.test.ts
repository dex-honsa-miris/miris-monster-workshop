import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { fitOnPedestal } from "../src/scene/pedestal";

describe("fitOnPedestal", () => {
  it("scales the largest dimension to maxDim", () => {
    const r = fitOnPedestal(
      { size: new THREE.Vector3(2, 4, 1), min: new THREE.Vector3(-1, -2, -0.5), center: new THREE.Vector3(0, 0, 0) },
      { maxDim: 1.6, topY: 0.5 },
    );
    expect(r.scale).toBeCloseTo(0.4);
  });
  it("seats the bbox bottom-center exactly on the pedestal top", () => {
    const bbox = { size: new THREE.Vector3(1, 1, 1), min: new THREE.Vector3(2, 5, -3), center: new THREE.Vector3(2.5, 5.5, -2.5) };
    const { scale, position } = fitOnPedestal(bbox, { maxDim: 1.6, topY: 0.5 });
    // world bottom = position.y + min.y * scale must equal topY
    expect(position.y + bbox.min.y * scale).toBeCloseTo(0.5);
    // world x/z center = position + center*scale must be 0
    expect(position.x + bbox.center.x * scale).toBeCloseTo(0);
    expect(position.z + bbox.center.z * scale).toBeCloseTo(0);
  });
});
