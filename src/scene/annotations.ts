import * as THREE from "three";
import type { AnnotationSlot } from "../../server/lore-schema";

const DIRS: Record<AnnotationSlot, THREE.Vector3> = {
  crown: new THREE.Vector3(0, 1, 0),
  face: new THREE.Vector3(0, 0.15, 1).normalize(),
  left: new THREE.Vector3(-1, 0.25, 0).normalize(),
  right: new THREE.Vector3(1, 0.25, 0).normalize(),
  core: new THREE.Vector3(0, 0, 1),
  base: new THREE.Vector3(0, -1, 0.15).normalize(),
  aura: new THREE.Vector3(0.55, 0.8, -0.25).normalize(),
};

export const slotDirection = (slot: AnnotationSlot): THREE.Vector3 => DIRS[slot].clone();

export function anchorFor(object: THREE.Object3D, slot: AnnotationSlot): { point: THREE.Vector3; outward: THREE.Vector3 } {
  const box = new THREE.Box3().setFromObject(object);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const dir = slotDirection(slot);
  const origin = center.clone().addScaledVector(dir, radius * 1.6);
  const ray = new THREE.Raycaster(origin, center.clone().sub(origin).normalize(), 0, radius * 3.2);
  const hit = ray.intersectObject(object, true)[0];
  const point = hit ? hit.point.clone() : center.clone().addScaledVector(dir, radius); // bbox-ish fallback
  if (!hit) box.clampPoint(point, point); // pin the fallback to the bbox surface
  return { point, outward: dir };
}

export function cardPositionFor(anchor: THREE.Vector3, outward: THREE.Vector3, bboxRadius: number): THREE.Vector3 {
  const p = anchor.clone().addScaledVector(outward, Math.max(0.35, bboxRadius * 0.55));
  p.y = Math.max(0.05, p.y);
  return p;
}

const CARD_MIN_Y = 0.62;     // just above the pedestal rim (top at y = 0.5)
const CARD_MAX_Y = 2.15;     // below the top of the default camera frustum
const CARD_MIN_RADIUS = 1.2; // outside the pedestal body (radius ~1.0)

/**
 * Keeps an annotation card in view. A downward slot (base, or anything low on
 * a squat monster) would otherwise sit inside the pedestal where it cannot be
 * seen, and a crown slot on a tall monster would ride off the top of the
 * frame. Clamp both ends; the leader line still points at the surface.
 */
export function placeAnnotationCard(p: THREE.Vector3): THREE.Vector3 {
  p.y = Math.min(p.y, CARD_MAX_Y);
  if (p.y >= CARD_MIN_Y) return p;
  p.y = CARD_MIN_Y;
  const flat = Math.hypot(p.x, p.z);
  if (flat < 1e-4) {
    p.z = CARD_MIN_RADIUS;
  } else if (flat < CARD_MIN_RADIUS) {
    const k = CARD_MIN_RADIUS / flat;
    p.x *= k;
    p.z *= k;
  }
  return p;
}
