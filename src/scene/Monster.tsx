// The creature on its pedestal, its hotspots, and its annotation cards.
//
// The imperative director is gone: hotspots are meshes with R3F pointer
// handlers (no manual raycaster), and reveal state lives in refs so opening a
// card animates without a single React re-render.
import { useFrame } from "@react-three/fiber";
import { Billboard, useGLTF } from "@react-three/drei";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { paintAnnotation, type CanvasCard } from "./cards";
import { Card } from "./Card";
import { fitOnPedestal } from "./pedestal";

const ACCENT = "#ff3500";
const LEADER = "#82838a";
const HOTSPOT_SIZE = 0.042;
const REVEAL_SPEED = 7.5;

export interface AnnotationSpec {
  id: string;
  label: string;
  blurb: string;
  /** Local-space point on the mount that the leader line touches. */
  anchor: THREE.Vector3;
  card: THREE.Vector3;
  discovered: boolean;
}

/** Builds the annotation specs for a loaded monster.
 *
 * ONLY discoveries produce markers. A freshly summoned monster wears nothing:
 * every annotation on it is one the player found by clicking, which makes the
 * creature worth exploring instead of arriving pre-labelled. (The lore
 * document still carries its own annotations; they are unused here and kept
 * for the codex text and for anything that later wants a hint system.) */
export function buildAnnotations(
  monster: THREE.Object3D,
  mount: THREE.Object3D,
  discoveries: Array<{ id: string; label: string; blurb: string; point: [number, number, number] }>,
): AnnotationSpec[] {
  const box = new THREE.Box3().setFromObject(monster);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const specs: AnnotationSpec[] = [];

  // Stored discovery points are MOUNT-LOCAL. They must be: the mount spins
  // continuously, so a world-space point would map to a different spot on the
  // creature every time it was restored.
  const localCenter = mount.worldToLocal(center.clone());
  for (const d of discoveries) {
    const local = new THREE.Vector3(...d.point);
    const outward = local.clone().sub(localCenter).normalize();
    if (outward.lengthSq() < 1e-6) outward.set(0, 0, 1);
    specs.push({
      id: d.id,
      label: d.label,
      blurb: d.blurb,
      anchor: local,
      card: local.clone().addScaledVector(outward, Math.max(0.22, radius * 0.34)),
      discovered: true,
    });
  }
  return specs;
}

function Annotation({ spec, open }: { spec: AnnotationSpec; open: boolean }): React.ReactElement {
  const reveal = useRef(0);
  const opacity = useRef(0);
  const scale = useRef(1);
  const hotspot = useRef<THREE.Mesh>(null);
  const line = useRef<THREE.Line>(null);
  const [hovered, setHovered] = useState(false);

  const linePoints = useMemo(
    () => [spec.anchor, spec.card.clone().lerp(spec.anchor, 0.22)],
    [spec.anchor, spec.card],
  );
  const geometry = useMemo(() => new THREE.BufferGeometry().setFromPoints(linePoints), [linePoints]);
  useEffect(() => () => geometry.dispose(), [geometry]);

  const paint = useMemo(() => (c: CanvasCard) => paintAnnotation(c, spec), [spec]);

  useFrame((_, dt) => {
    const target = open || hovered ? 1 : 0;
    reveal.current += (target - reveal.current) * Math.min(1, dt * REVEAL_SPEED);
    const eased = reveal.current * reveal.current * (3 - 2 * reveal.current);
    opacity.current = eased;
    scale.current = 0.82 + eased * 0.18;
    if (hotspot.current) {
      // ringGeometry already carries HOTSPOT_SIZE, so this is a multiplier,
      // not an absolute size (scaling by the size again made them invisible).
      hotspot.current.scale.setScalar(1 + eased * 0.5);
      (hotspot.current.material as THREE.MeshBasicMaterial).opacity = 0.55 + eased * 0.45;
    }
    if (line.current) (line.current.material as THREE.LineBasicMaterial).opacity = eased * (spec.discovered ? 0.85 : 0.6);
  });

  const shown = opacity.current > 0.01 || open || hovered;

  return (
    <group>
      {/* The marker. Billboard keeps the disc facing the camera (a flat circle
          is invisible edge-on), and depthTest off keeps a hotspot behind a leg
          both visible and clickable. */}
      <Billboard position={spec.anchor} userData={{ hideInProbe: true }}>
        <mesh
          ref={hotspot}
          renderOrder={3}
          onPointerOver={(e) => { e.stopPropagation(); setHovered(true); document.body.style.cursor = "pointer"; }}
          onPointerOut={() => { setHovered(false); document.body.style.cursor = ""; }}
        >
          {/* Solid, not a ring: a ring's hollow middle let the pointer pass
              straight through the marker's centre, which is exactly where
              people aim. */}
          <circleGeometry args={[HOTSPOT_SIZE, 28]} />
          <meshBasicMaterial
            color={spec.discovered ? ACCENT : "#ffffff"}
            transparent
            opacity={0.7}
            depthTest={false}
          />
        </mesh>
      </Billboard>

      <primitive object={new THREE.Line(geometry, new THREE.LineBasicMaterial({
        color: spec.discovered ? ACCENT : LEADER,
        transparent: true,
        opacity: 0,
      }))} ref={line} visible={shown} />

      <Card
        paint={paint}
        repaintKey={spec.id}
        worldWidth={0.62}
        worldHeight={0.34}
        px={384}
        position={spec.card}
        opacityRef={opacity}
        scaleRef={scale}
        visible={shown}
        renderOrder={5}
        alwaysOnTop
      />
    </group>
  );
}

export interface MonsterProps {
  url: string;
  discoveries: Array<{ id: string; label: string; blurb: string; point: [number, number, number] }>;
  pinned: Set<string>;
  onPickPoint: (world: THREE.Vector3, local: THREE.Vector3) => void;
  onHotspotClick: (id: string) => void;
}

export function Monster({ url, discoveries, pinned, onPickPoint, onHotspotClick }: MonsterProps): React.ReactElement {
  const { scene } = useGLTF(url);
  const mount = useRef<THREE.Group>(null);
  const [specs, setSpecs] = useState<AnnotationSpec[]>([]);

  // Measure at identity, then seat on the pedestal (the proven fit).
  const model = useMemo(() => {
    const clone = scene.clone(true);
    clone.position.set(0, 0, 0);
    clone.rotation.set(0, 0, 0);
    clone.scale.setScalar(1);
    clone.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(clone);
    const fit = fitOnPedestal(
      { size: box.getSize(new THREE.Vector3()), min: box.min.clone(), center: box.getCenter(new THREE.Vector3()) },
      { maxDim: 1.6, topY: 0.5 },
    );
    clone.scale.setScalar(fit.scale);
    clone.position.copy(fit.position);
    return clone;
  }, [scene]);

  // Anchors depend on the seated model, so compute after it mounts.
  useEffect(() => {
    if (!mount.current) return;
    mount.current.updateMatrixWorld(true);
    setSpecs(buildAnnotations(model, mount.current, discoveries));
  }, [model, discoveries]);

  // No turntable: the creature holds still and the viewer orbits instead.
  // Markers stay under the cursor, and a card pinned open does not drift.

  return (
    <group ref={mount}>
      <primitive
        object={model}
        name="monster-root"
        onClick={(e: { stopPropagation: () => void; point: THREE.Vector3 }) => {
          e.stopPropagation();
          const world = e.point.clone();
          const local = mount.current ? mount.current.worldToLocal(world.clone()) : world.clone();
          onPickPoint(world, local);
        }}
      />
      {specs.map((spec) => (
        <group key={spec.id} onClick={(e) => { e.stopPropagation(); onHotspotClick(spec.id); }}>
          <Annotation spec={spec} open={pinned.has(spec.id)} />
        </group>
      ))}
    </group>
  );
}
