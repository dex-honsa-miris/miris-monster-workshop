import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { anchorFor, cardPositionFor, slotDirection } from "../src/scene/annotations";

const sphere = (r = 1) => new THREE.Mesh(new THREE.SphereGeometry(r, 32, 16), new THREE.MeshBasicMaterial());

describe("slotDirection", () => {
  it("crown is straight up and all directions are unit length", () => {
    expect(slotDirection("crown").y).toBeCloseTo(1);
    for (const s of ["crown", "face", "left", "right", "core", "base", "aura"] as const) {
      expect(slotDirection(s).length()).toBeCloseTo(1, 5);
    }
  });
  it("returns a fresh clone each call so mutations don't persist", () => {
    const d1 = slotDirection("crown");
    d1.x = 999;
    const d2 = slotDirection("crown");
    expect(d2.x).toBeCloseTo(0);
  });
});

describe("anchorFor", () => {
  it("lands on the surface of a sphere for every slot", () => {
    const m = sphere(1);
    m.updateMatrixWorld(true);
    for (const s of ["crown", "face", "left", "right", "base"] as const) {
      const { point } = anchorFor(m, s);
      expect(point.length()).toBeCloseTo(1, 1); // on the unit sphere surface
    }
  });
  it("falls back to the bbox surface when the ray misses", () => {
    // Use layers to force a miss: Box3.setFromObject still computes the bbox,
    // but the default-layer raycaster (which only checks layer 0) cannot hit
    // the mesh on layer 1. This tests the fallback path without relying on
    // invisible (which raycaster ignores). Since fallback = center + dir*radius clamped
    // to bbox, and crown dir is (0,1,0), the clamped point for a 2×2×2 box
    // centered at origin is exactly (0, 1, 0). A raycast hit would also land
    // at (0, 1, 0), so we translate the box +0.5 in x to make fallback ≠ hit.
    const group = new THREE.Group();
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    box.position.x = 0.5;
    box.layers.set(1); // on layer 1; raycaster only checks layer 0 by default
    group.add(box);
    group.updateMatrixWorld(true);
    const { point } = anchorFor(group, "crown");
    // Fallback computes center (0.5, 0, 0) + (0, 1, 0)*radius, clamped to bbox.
    // Bbox is [-1.5, -1, -1] to [2.5, 1, 1], so clamped point.y = 1.
    // If ray hit (fallback never ran), point would be inside the box or on a different face.
    expect(point.y).toBeCloseTo(1, 5);
    expect(point.x).toBeCloseTo(0.5, 5); // fallback goes up from center, so x unchanged
  });
  it("outward matches the slot direction", () => {
    const m = sphere(1);
    m.updateMatrixWorld(true);
    for (const s of ["crown", "face", "left", "right", "core", "base", "aura"] as const) {
      const { outward } = anchorFor(m, s);
      const expected = slotDirection(s);
      expect(outward.x).toBeCloseTo(expected.x, 5);
      expect(outward.y).toBeCloseTo(expected.y, 5);
      expect(outward.z).toBeCloseTo(expected.z, 5);
    }
  });
});

describe("cardPositionFor", () => {
  it("offsets along outward and never sinks below the pedestal", () => {
    const p = cardPositionFor(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0), 1);
    expect(p.y).toBeGreaterThanOrEqual(0.05);
  });
});
