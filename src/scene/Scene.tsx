// The summoning chamber as R3F. Everything the old SceneDirector/SceneStage
// pair did imperatively now lives here as components: lights, the pedestal,
// the ember ring, the HUD cards, and orbit controls from drei.
import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { EffectComposer, Select, Selection, SelectiveBloom, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { SelectiveBloomEffect } from "postprocessing";
import * as THREE from "three";
import type { WorkshopStatus } from "../../server/status";
import type { FlowPhase } from "../app/flow";
import { Monster } from "./Monster";
import { PedestalMesh } from "./PedestalMesh";
import type { SpellLoader } from "./spell/SpellLoader";
import { SpellLoaderView } from "./spell/SpellLoaderView";
import { FLASH_IN, revealFlash } from "./spell/reveal";

/** Roughly how long a Meshy generation takes. The backend reports running or
 * done and nothing in between, so the bar is an estimate, not a measurement:
 * it eases toward -- but never reaches -- SUMMON_CEILING, and only the real
 * "done" signal takes it to 1. That way a slow generation keeps moving
 * without ever lying that it has finished. */
const SUMMON_SECONDS = 75;
const SUMMON_CEILING = 0.94;
/** A deliberate replay is not waiting on anything, so it fills at a watchable
 * pace instead of the real generation's crawl. */
const REPLAY_SECONDS = 2.6;

/** Image-based lighting for the creature. A white chapel: broad soft fill
 * with directional windows, which flatters a matte game asset far more than
 * the analytic lights alone did. */
const ENV_FILE = "/env/white-chapel.hdr";
const ENV_INTENSITY = 0.62;

/** Bloom while the cage is merely burning. */
const BLOOM_BASE = 1.6;
/** ...and at the peak of the reveal flash, where the white creature is meant
 * to blow out rather than merely glow. */
const BLOOM_FLASH = 4.5;
/** Held constant through the flash. Ramping it down was an attempt to pull
 * the creature into the bloom, but at FLASH_GAIN the creature sits far above
 * any threshold already; all a lower cut-off does is drag every dim thing in
 * the frame into the glow, which floods the whole stage white. */
const BLOOM_THRESHOLD = 0.3;

export interface SceneProps {
  phase: FlowPhase;
  /** Increment to replay the summoning. 0 or undefined never replays. */
  replayNonce?: number;
  status: WorkshopStatus | null;
  monsterUrl: string | null;
  pinned: Set<string>;
  onPickPoint: (world: THREE.Vector3, local: THREE.Vector3) => void;
  onHotspotClick: (id: string) => void;
  onCanvasReady?: (gl: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera) => void;
}

interface SummonSpellProps {
  done: boolean;
  /** Replay: fill quickly rather than tracking a real generation. */
  fast: boolean;
  onFinished: () => void;
  /** Written every frame with the white-overlay amount for the creature. */
  flashRef: { current: number };
  /** Fired once, when the flash begins and the creature should be mounted. */
  onFlash: () => void;
}

/** The summoning effect, driven from the render loop rather than from state. */
function SummonSpell({ done, fast, onFinished, flashRef, onFlash }: SummonSpellProps): React.ReactElement {
  const elapsed = useRef(0);
  const loader = useRef<SpellLoader | null>(null);
  const announced = useRef(false);
  const doneRef = useRef(done);
  doneRef.current = done;

  useFrame((_, dt) => {
    elapsed.current += Math.min(0.05, dt);
    const burst = loader.current?.burst ?? null;
    flashRef.current = revealFlash(burst);
    // Mount the creature at the snap, one beat before the white peaks, so it
    // is already in the frame when the light burns off it.
    if (!announced.current && burst !== null && burst >= FLASH_IN) {
      announced.current = true;
      onFlash();
    }
  });
  const source = useCallback(() => {
    // A replay drives the bar itself and finishes on its own clock; a real
    // summon only reaches 1 when the backend says the model is done.
    if (fast) return Math.min(1, elapsed.current / REPLAY_SECONDS);
    if (doneRef.current) return 1;
    return SUMMON_CEILING * (1 - Math.exp(-elapsed.current / SUMMON_SECONDS));
  }, [fast]);

  return (
    <Select enabled>
      <SpellLoaderView
        progressSource={source}
        onComplete={onFinished}
        onReady={(l) => { loader.current = l; }}
        // Sized to the space the monster will occupy: the base sigil sits on
        // the pedestal top (y 0.5) and the cage encloses the creature.
        radius={0.78}
        height={1.45}
        position={[0, 0.5, 0]}
      />
    </Select>
  );
}

/** Selective bloom, mounted only while the spell is on screen: a global bloom
 * would set the HUD cards' white text glowing, and once the summon is over the
 * scene should render exactly as it did before this effect existed.
 *
 * Intensity and threshold are pushed straight onto the effect each frame
 * rather than passed as props, so the flash ramp costs no React renders. */
function SummonBloom({ flashRef }: { flashRef: { current: number } }): React.ReactElement {
  const bloom = useRef<SelectiveBloomEffect | null>(null);

  useFrame(() => {
    const b = bloom.current;
    if (!b) return;
    const f = flashRef.current;
    b.intensity = BLOOM_BASE + (BLOOM_FLASH - BLOOM_BASE) * f;
  });

  return (
    <EffectComposer autoClear={false} multisampling={4}>
      <SelectiveBloom
        ref={bloom}
        intensity={BLOOM_BASE}
        luminanceThreshold={BLOOM_THRESHOLD}
        luminanceSmoothing={0.24}
        mipmapBlur
        radius={0.85}
      />
      {/* Mounting a composer switches the renderer to NoToneMapping, because
          postprocessing expects to tone map as a pass. Without this the scene
          rendered without ACES for the whole summon and snapped back to it the
          instant the composer unmounted -- a visible step in brightness and
          colour exactly at the hand-off. Matching the canvas's own tone
          mapping here makes mounting and unmounting invisible. */}
      <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
    </EffectComposer>
  );
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

  // A session that opens straight into reveal has nothing to summon, so the
  // effect is skipped rather than replayed on every refresh.
  // One "run" per summoning, whether that is the first monster, a regenerate
  // from the reveal, or a deliberate replay. A finished loader hides itself
  // for good, so starting another means building a new one: the key does that.
  const runSeq = useRef(0);
  const [run, setRun] = useState<{ key: number; fast: boolean } | null>(null);
  const [summonFinished, setSummonFinished] = useState(false);
  const [flashing, setFlashing] = useState(false);
  const onFinished = useCallback(() => setSummonFinished(true), []);
  const onFlash = useCallback(() => setFlashing(true), []);
  // Read every frame by the monster's white overlay and by the bloom ramp;
  // a ref rather than state, because it changes on every one of them.
  const flashRef = useRef(0);

  const beginRun = useCallback((fast: boolean) => {
    flashRef.current = 0;
    setSummonFinished(false);
    setFlashing(false);
    runSeq.current += 1;
    setRun({ key: runSeq.current, fast });
  }, []);

  // Entering the summoning phase always starts a run -- the first monster and
  // every regenerate alike. Opening a session straight into reveal does not:
  // a finished monster should not re-run its own summoning on every refresh,
  // so replaying that is something you ask for.
  const summoning = props.phase === "summoning";
  useEffect(() => { if (summoning) beginRun(false); }, [summoning, beginRun]);

  const nonce = props.replayNonce ?? 0;
  useEffect(() => { if (nonce > 0) beginRun(true); }, [nonce, beginRun]);

  const showSpell = run !== null && !summonFinished;
  // The creature arrives ON the flash, not after it: the spell keeps
  // dissipating over a monster that is already there, which is what makes the
  // hand-off read as a reveal instead of a swap.
  const showMonster = props.phase === "reveal" && (run === null || flashing || summonFinished);

  return (
    <>
      {/* Image-based lighting. Not shown as a background: the chamber's ground
          is the brand's near-black, and the chapel is here to light the
          creature, not to become the room. */}
      <Suspense fallback={null}>
        <Environment files={ENV_FILE} environmentIntensity={ENV_INTENSITY} />
      </Suspense>

      {/* The environment now does the ambient fill the hemisphere light used
          to fake, so the analytic lights are back to doing only what image
          based lighting cannot: a key with a falloff that pools on the
          pedestal, and two rims for shape. Left at their old strengths they
          simply added to the IBL and washed the chamber grey. */}
      <spotLight position={[2.5, 4.5, 2.5]} color={0xf4f5f8} intensity={42} distance={14} angle={0.8} penumbra={0.5} />
      <directionalLight position={[-2.5, 2.2, 3.2]} color={0xdfe4ef} intensity={0.45} />
      <directionalLight position={[0, 2.5, -3.5]} color={0xaab2c4} intensity={0.3} />

      <PedestalMesh />
      {showSpell && (
        <SummonSpell
          key={run?.key ?? 0}
          fast={run?.fast ?? false}
          done={props.phase === "reveal"}
          onFinished={onFinished}
          onFlash={onFlash}
          flashRef={flashRef}
        />
      )}

      {props.monsterUrl && showMonster && (
        <Suspense fallback={null}>
          <Monster
            url={props.monsterUrl}
            discoveries={props.status?.discoveries ?? []}
            pinned={props.pinned}
            onPickPoint={props.onPickPoint}
            onHotspotClick={props.onHotspotClick}
            flashRef={run === null ? undefined : flashRef}
          />
        </Suspense>
      )}

      {/* Selective, and mounted only while the spell is on screen: a global
          bloom would set the HUD cards' white text glowing, and the reveal
          should render exactly as it did before this effect existed. */}
      {showSpell && <SummonBloom flashRef={flashRef} />}

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
      <Selection>
        <Contents {...props} />
      </Selection>
    </Canvas>
  );
}
