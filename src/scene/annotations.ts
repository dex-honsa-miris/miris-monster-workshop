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
