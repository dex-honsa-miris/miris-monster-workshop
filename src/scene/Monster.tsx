// The creature on its pedestal, its hotspots, and its annotation cards.
//
// The imperative director is gone: hotspots are meshes with R3F pointer
// handlers (no manual raycaster), and reveal state lives in refs so opening a
// card animates without a single React re-render.
import { useFrame, useThree } from "@react-three/fiber";
import { Billboard, useGLTF } from "@react-three/drei";
import { Select } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { paintAnnotation, type CanvasCard } from "./cards";
import { Card } from "./Card";
import { fitOnPedestal } from "./pedestal";
import { FLASH_GAIN } from "./spell/reveal";
import { useDragGuard } from "./useDragGuard";

const ACCENT = "#ff3500";
const LEADER = "#82838a";
const HOTSPOT_SIZE = 0.042;
const REVEAL_SPEED = 7.5;

/** Camera distance the annotations were sized against: the scene's opening
 * framing. Markers and cards are world-space objects, so without this they
 * grow as you dolly in and the card text balloons. Scaling by distance over
 * this reference cancels the perspective divide, which pins them to a
 * constant size on screen while leaving them anchored in the world. The
 * card's offset from its marker is scaled by the same factor: a world-fixed
 * offset flings the card away from the feature it labels as you dolly in. */
const ANNOTATION_REF_DISTANCE = 4.2;

/** Normal-map strength, scaled to how dense the mesh is.
 *
 * The map and the geometry describe the SAME surface. On a light mesh the map
 * is the only thing carrying the fine detail, so it should push at full
 * strength. On a very dense mesh the geometry already has that detail and the
 * map lays a second copy on top -- which does not read as twice the detail,
 * it reads as grit crawling along every seam. Measured on a ~300k-triangle
 * generation: the scale relief survives intact with the map switched off,
 * while the crunch along the seams goes with it. */
const NORMAL_FULL_BELOW = 60_000;
const NORMAL_MIN_ABOVE = 250_000;
const NORMAL_MIN = 0.3;

export function normalStrengthFor(triangles: number): number {
  if (triangles <= NORMAL_FULL_BELOW) return 1;
  if (triangles >= NORMAL_MIN_ABOVE) return NORMAL_MIN;
  const t = (triangles - NORMAL_FULL_BELOW) / (NORMAL_MIN_ABOVE - NORMAL_FULL_BELOW);
  return 1 - t * (1 - NORMAL_MIN);
}

/** How much of the environment the creature reflects. The generated
 * metallic-roughness map comes back around 0.48 roughness -- half gloss --
 * which under a bright HDRI turns a matte game asset into wet plastic. */
const MONSTER_ENV_INTENSITY = 0.35;

/**
 * Make a generated asset render cleanly.
 *
 * Meshy returns a normal map but no TANGENT attribute. Without one, three
 * derives the tangent frame from screen-space derivatives, which is unstable
 * across the tiny triangles of a dense mesh -- that instability is what shows
 * up as crunchy, crawling seams. Computing real tangents once, at load, fixes
 * the shading rather than hiding it.
 */
function tuneGeneratedMaterials(root: THREE.Object3D): void {
  const tangentsDone = new Set<THREE.BufferGeometry>();

  let triangles = 0;
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const g = mesh.geometry;
    triangles += (g.index ? g.index.count : (g.attributes.position?.count ?? 0)) / 3;
  });
  const normalStrength = normalStrengthFor(triangles);

  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const geo = mesh.geometry;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const raw of mats) {
      const mat = raw as THREE.MeshStandardMaterial;
      if (!mat || !("isMeshStandardMaterial" in mat)) continue;

      if (mat.normalMap) {
        if (!tangentsDone.has(geo) && geo.index && geo.attributes.normal && geo.attributes.uv && !geo.attributes.tangent) {
          geo.computeTangents();
          tangentsDone.add(geo);
        }
        mat.normalScale.set(normalStrength, normalStrength);
      }

      // The environment is here to light the creature, not to be mirrored by
      // it. Metalness is forced off: glTF defaults metallicFactor to 1, so a
      // model whose map happens to omit the channel would come back chrome.
      // Roughness likewise: new files are matted server-side, but banked
      // monsters from before that pass still carry a ~0.48 roughness map,
      // which under the key reads as wet plastic.
      mat.envMapIntensity = MONSTER_ENV_INTENSITY;
      mat.metalness = 0;
      mat.roughnessMap = null;
      mat.roughness = 0.9;

      for (const map of [mat.map, mat.normalMap, mat.roughnessMap]) {
        if (map) { map.anisotropy = 8; map.needsUpdate = true; }
      }
      mat.needsUpdate = true;
    }
  });
}

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
  const card = useRef<THREE.Group>(null);
  const line = useRef<THREE.Line>(null);
  const [hovered, setHovered] = useState(false);
  const camera = useThree((s) => s.camera);
  const anchorWorld = useMemo(() => new THREE.Vector3(), []);
  const offset = useMemo(() => spec.card.clone().sub(spec.anchor), [spec.card, spec.anchor]);

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

    // Distance compensation. Perspective divides projected size by depth, so
    // multiplying by depth cancels it exactly.
    let k = 1;
    if (hotspot.current) {
      hotspot.current.getWorldPosition(anchorWorld);
      k = anchorWorld.distanceTo(camera.position) / ANNOTATION_REF_DISTANCE;
    }

    scale.current = (0.82 + eased * 0.18) * k;
    if (hotspot.current) {
      // circleGeometry already carries HOTSPOT_SIZE, so this is a multiplier,
      // not an absolute size (scaling by the size again made them invisible).
      hotspot.current.scale.setScalar((1 + eased * 0.5) * k);
      (hotspot.current.material as THREE.MeshBasicMaterial).opacity = 0.55 + eased * 0.45;
    }
    if (card.current) {
      card.current.position.copy(spec.anchor).addScaledVector(offset, k);
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

      {/* The card rides a group so its position can be driven per frame
          without Card needing to forward a ref. */}
      <group ref={card} position={spec.card}>
        <Card
          paint={paint}
          repaintKey={spec.id}
          worldWidth={0.62}
          worldHeight={0.34}
          px={384}
          opacityRef={opacity}
          scaleRef={scale}
          visible={shown}
          renderOrder={5}
          alwaysOnTop
        />
      </group>
    </group>
  );
}

export interface MonsterProps {
  url: string;
  /** 0..1 white-overlay amount, read every frame. Driven by the summoning
   * flash, so the creature emerges out of the light. */
  flashRef?: { current: number };
  discoveries: Array<{ id: string; label: string; blurb: string; point: [number, number, number] }>;
  pinned: Set<string>;
  onPickPoint: (world: THREE.Vector3, local: THREE.Vector3) => void;
  onHotspotClick: (id: string) => void;
}

export function Monster({ url, discoveries, pinned, onPickPoint, onHotspotClick, flashRef }: MonsterProps): React.ReactElement {
  const { scene } = useGLTF(url);
  const mount = useRef<THREE.Group>(null);
  const wasDrag = useDragGuard();
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
    tuneGeneratedMaterials(clone);
    return clone;
  }, [scene]);

  // A white stand-in for the model, drawn over it. Cloning and overriding is
  // what keeps this safe: useGLTF caches one scene and clone(true) SHARES
  // materials with it, so tinting the real materials would leak the flash
  // into every later mount of the same monster.
  const flash = useMemo(() => {
    if (!flashRef) return null;
    const mat = new THREE.MeshBasicMaterial({
      color: 0xffffff, // driven into HDR per frame; see FLASH_GAIN
      transparent: true,
      opacity: 0,
      depthWrite: false,
      toneMapped: false,
    });
    const clone = model.clone(true);
    clone.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh) mesh.material = mat;
    });
    clone.visible = false;
    return { clone, mat };
  }, [model, flashRef]);

  useEffect(() => () => flash?.mat.dispose(), [flash]);

  const markers = useRef<THREE.Group>(null);

  useFrame(() => {
    if (!flash || !flashRef) return;
    const v = flashRef.current;
    flash.clone.visible = v > 0.004;
    // Coverage reaches full quickly, then the HDR gain carries the fade, so
    // the creature burns down from blazing rather than dissolving away.
    flash.mat.opacity = Math.min(1, v * 1.6);
    flash.mat.color.setScalar(Math.max(0.001, FLASH_GAIN * v * v));
    // Discovery markers belong to the creature, not to the summoning.
    if (markers.current) markers.current.visible = v < 0.02;
  });

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
          // Releasing an orbit over the model is not a request to inspect it.
          if (wasDrag()) return;
          const world = e.point.clone();
          const local = mount.current ? mount.current.worldToLocal(world.clone()) : world.clone();
          onPickPoint(world, local);
        }}
      />
      {/* Selected, so the summoning bloom catches the white creature and not
          just the cage around it: an unselected overlay reads as flat paint. */}
      {flash && (
        <Select enabled>
          <primitive object={flash.clone} renderOrder={2} userData={{ hideInProbe: true }} />
        </Select>
      )}
      <group ref={markers}>
        {specs.map((spec) => (
          <group key={spec.id} onClick={(e) => { e.stopPropagation(); if (!wasDrag()) onHotspotClick(spec.id); }}>
            <Annotation spec={spec} open={pinned.has(spec.id)} />
          </group>
        ))}
      </group>
    </group>
  );
}
