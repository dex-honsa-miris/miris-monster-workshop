// The summoning chamber as R3F. Everything the old SceneDirector/SceneStage
// pair did imperatively now lives here as components: lights, the pedestal,
// the ember ring, the HUD cards, and orbit controls from drei.
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useMemo, useRef } from "react";
import * as THREE from "three";
import type { WorkshopStatus } from "../../server/status";
import type { MonsterLore } from "../../server/lore-schema";
import type { Phase } from "../app/checklist-model";
import type { FlowPhase } from "../app/flow";
import { Card } from "./Card";
import { paintChecklist, paintConcept, paintMessage, paintStats, type CanvasCard } from "./cards";
import { Monster } from "./Monster";
import { PedestalMesh } from "./PedestalMesh";
import { RitualRing } from "./RitualRing";

const CARD_DEPTH = 3.9;
const EDGE_CARD_MAX = 0.95;

/** Pins a card to a screen edge: positioned from the camera's own basis every
 * frame, so orbiting never flings the HUD into the scene. */
function HudCard(props: {
  side: -1 | 0 | 1;
  up: number;
  worldWidth: number;
  worldHeight: number;
  paint: (c: CanvasCard) => void;
  repaintKey?: unknown;
  visible: boolean;
}): React.ReactElement {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera) as THREE.PerspectiveCamera;

  useFrame(() => {
    const g = group.current;
    if (!g || !props.visible) return;
    const halfView = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * CARD_DEPTH * camera.aspect;
    const limit = props.side === 0 ? 2 * halfView * 0.62 : 2 * halfView - 0.16;
    const s = Math.max(0.05, Math.min(props.side === 0 ? 0.8 : EDGE_CARD_MAX, limit / props.worldWidth));
    g.scale.setScalar(s);
    const halfCard = (props.worldWidth * s) / 2;
    const x = props.side === 0 ? 0 : props.side * Math.max(0, halfView - halfCard - 0.06);

    camera.updateMatrixWorld();
    const m = camera.matrixWorld;
    const right = new THREE.Vector3().setFromMatrixColumn(m, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(m, 1);
    const forward = new THREE.Vector3().setFromMatrixColumn(m, 2).negate();
    g.position.copy(camera.position)
      .addScaledVector(forward, CARD_DEPTH)
      .addScaledVector(right, x)
      .addScaledVector(up, props.up);
    g.quaternion.copy(camera.quaternion);
  });

  return (
    <group ref={group} visible={props.visible} userData={{ hideInProbe: true }}>
      <Card
        paint={props.paint}
        repaintKey={props.repaintKey}
        worldWidth={props.worldWidth}
        worldHeight={props.worldHeight}
        billboard={false}
      />
    </group>
  );
}

export interface SceneProps {
  phase: FlowPhase;
  phases: Phase[];
  status: WorkshopStatus | null;
  lore: MonsterLore | null;
  concept: { imageUrl: string; prompt: string; rerolls: number } | null;
  note: { title: string; body: string } | null;
  monsterUrl: string | null;
  pinned: Set<string>;
  onPickPoint: (world: THREE.Vector3, local: THREE.Vector3) => void;
  onHotspotClick: (id: string) => void;
  onCanvasReady?: (gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void;
}

function Contents(props: SceneProps): React.ReactElement {
  const { gl, scene, camera } = useThree();
  // Hand the renderer out once so the click-to-annotate probe can render its
  // offscreen closeups without owning the canvas.
  const handed = useRef(false);
  if (!handed.current && props.onCanvasReady) {
    handed.current = true;
    props.onCanvasReady(gl, scene, camera);
  }

  const paintChecklistCard = useMemo(() => (c: CanvasCard) => paintChecklist(c, props.phases), [props.phases]);
  const paintStatsCard = useMemo(() => (c: CanvasCard) => { if (props.lore) paintStats(c, props.lore); }, [props.lore]);
  const paintConceptCard = useMemo(
    () => (c: CanvasCard) => {
      if (props.concept) paintConcept(c, { imageBitmap: null, imageUrl: props.concept.imageUrl, prompt: props.concept.prompt, rerolls: props.concept.rerolls });
    },
    [props.concept],
  );
  const paintMessageCard = useMemo(() => (c: CanvasCard) => { if (props.note) paintMessage(c, props.note); }, [props.note]);

  return (
    <>
      <hemisphereLight args={[0xdfe2ea, 0x14161c, 1.5]} />
      <spotLight position={[2.5, 4.5, 2.5]} color={0xf4f5f8} intensity={90} distance={14} angle={0.8} penumbra={0.5} />
      <directionalLight position={[-2.5, 2.2, 3.2]} color={0xdfe4ef} intensity={1.4} />
      <directionalLight position={[0, 2.5, -3.5]} color={0xaab2c4} intensity={0.8} />

      <PedestalMesh />
      <RitualRing busy={props.phase === "summoning"} />

      {props.monsterUrl && props.phase === "reveal" && (
        <Suspense fallback={null}>
          <Monster
            url={props.monsterUrl}
            discoveries={props.status?.discoveries ?? []}
            pinned={props.pinned}
            onPickPoint={props.onPickPoint}
            onHotspotClick={props.onHotspotClick}
          />
        </Suspense>
      )}

      <HudCard side={-1} up={0.1} worldWidth={1.35} worldHeight={1.5} paint={paintChecklistCard} repaintKey={props.phases} visible />
      <HudCard side={1} up={0.06} worldWidth={1.3} worldHeight={1.62} paint={paintStatsCard} repaintKey={props.lore} visible={props.phase === "reveal" && !!props.lore} />
      <HudCard side={0} up={0.08} worldWidth={1.1} worldHeight={1.4} paint={paintConceptCard} repaintKey={props.concept} visible={!!props.concept && (props.phase === "create" || props.phase === "summoning")} />
      <HudCard side={0} up={0.5} worldWidth={1.5} worldHeight={0.75} paint={paintMessageCard} repaintKey={props.note} visible={!!props.note} />

      <OrbitControls
        target={[0, 1, 0]}
        enablePan={false}
        minDistance={2.2}
        maxDistance={9}
        minPolarAngle={0.5}
        maxPolarAngle={1.95}
        rotateSpeed={0.7}
        makeDefault
      />
    </>
  );
}

export function Scene(props: SceneProps): React.ReactElement {
  return (
    <Canvas
      // alpha so the CSS backdrop shows through; ACES + the same DPR cap the
      // imperative stage used.
      gl={{ alpha: true, antialias: true }}
      dpr={[1, 2]}
      camera={{ fov: 45, position: [0, 1.4, 4.2], near: 0.1, far: 50 }}
      onCreated={({ gl }) => { gl.toneMapping = THREE.ACESFilmicToneMapping; }}
      style={{ position: "fixed", inset: 0, touchAction: "none" }}
    >
      <Contents {...props} />
    </Canvas>
  );
}
