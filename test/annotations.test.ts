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
    const empty = new THREE.Group(); // nothing to hit
    const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), new THREE.MeshBasicMaterial());
    box.visible = false; // raycaster skips invisible -> forces fallback
    empty.add(box);
    empty.updateMatrixWorld(true);
    const { point } = anchorFor(empty, "crown");
    expect(point.y).toBeGreaterThan(0.9); // bbox top, not the center
  });
});

describe("cardPositionFor", () => {
  it("offsets along outward and never sinks below the pedestal", () => {
    const p = cardPositionFor(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, -1, 0), 1);
    expect(p.y).toBeGreaterThanOrEqual(0.05);
  });
});
