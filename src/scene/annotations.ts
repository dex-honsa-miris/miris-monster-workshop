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

/** Per-slot direction so two cards opened at once do not sit on the same
 * spot. Offsets are small: annotations now open one at a time from a hotspot,
 * so a card belongs NEXT TO the feature it describes, not pushed out to the
 * edge of the scene. */
const SLOT_SPREAD: Record<AnnotationSlot, { push: number; lift: number }> = {
  crown: { push: 0.55, lift: 0.22 },
  face: { push: 0.7, lift: 0.06 },
  left: { push: 0.75, lift: -0.04 },
  right: { push: 0.75, lift: 0.12 },
  core: { push: 0.65, lift: -0.12 },
  base: { push: 0.6, lift: -0.18 },
  aura: { push: 0.7, lift: 0.28 },
};

export function cardPositionFor(
  anchor: THREE.Vector3,
  outward: THREE.Vector3,
  bboxRadius: number,
  slot: AnnotationSlot = "core",
): THREE.Vector3 {
  const { push, lift } = SLOT_SPREAD[slot];
  const p = anchor.clone().addScaledVector(outward, Math.max(0.22, bboxRadius * 0.34) * push);
  p.y = Math.max(0.05, p.y + lift);
  return p;
}

const CARD_MIN_Y = 0.62;     // just above the pedestal rim (top at y = 0.5)
const CARD_MAX_Y = 2.15;     // below the top of the default camera frustum
const CARD_MIN_RADIUS = 0.55; // clear of the pedestal centre only

/**
 * Keeps an annotation card in view. A downward slot (base, or anything low on
 * a squat monster) would otherwise sit inside the pedestal where it cannot be
 * seen, and a crown slot on a tall monster would ride off the top of the
 * frame. Clamp both ends; the leader line still points at the surface.
 *
 * The radial push is deliberately small: cards used to be forced outside the
 * pedestal radius because every annotation was visible at once and they had
 * to avoid each other. Now that one opens at a time from its hotspot, a card
 * should sit NEXT TO its feature, overlapping the creature if need be.
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
