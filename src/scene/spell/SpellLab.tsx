// A standalone stage for the effect: open /?spell to see it on its own, with
// progress auto-cycling. Used to tune the VFX against the reference without
// running a real summon.
//
// Query params make it scriptable, which is how it gets compared to reference
// frames: `?spell&p=0.6` pins progress (no cycling, so a screenshot is
// reproducible), `&solo=core` shows one layer alone, `&nobloom` drops the
// composer, and `&t=2.5` fast-forwards the clock to a fixed time.
import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { Bloom, EffectComposer } from "@react-three/postprocessing";
import { useEffect, useRef, useState } from "react";
import { CubeLoaderView } from "./CubeLoaderView";
import { SpellLoader } from "./SpellLoader";
import { SpellLoaderView } from "./SpellLoaderView";

function params(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

function Cycle({ onProgress }: { onProgress: (p: number) => void }): null {
  const t = useRef(0);
  useFrame((_, dt) => {
    t.current += dt;
    // 6s fill, 2s hold at 1, then restart.
    const cycle = t.current % 8;
    onProgress(Math.min(1, cycle / 6));
    if (cycle > 7.9) t.current = 0;
  });
  return null;
}

/** Publishes the loader for the screenshot harness and applies ?solo / ?t. */
function Debug({ loader }: { loader: SpellLoader | null }): null {
  useEffect(() => {
    if (!loader) return;
    (window as unknown as { __spell?: SpellLoader }).__spell = loader;
    const solo = params().get("solo");
    if (solo) loader.solo(solo);
    const t = params().get("t");
    if (t) loader.seek(Number(t));
  }, [loader]);
  return null;
}

export function SpellLab(): React.ReactElement {
  const pinned = params().get("p");
  const [progress, setProgress] = useState(pinned ? Number(pinned) : 0);
  const [loader, setLoader] = useState<SpellLoader | null>(null);
  // A finished loader hides itself for good, so looping the lab means
  // building a new one: bumping the key remounts SpellLoaderView.
  const [key, setKey] = useState(0);
  const bloom = !params().has("nobloom");

  return (
    <Canvas
      // preserveDrawingBuffer lets the screenshot harness read pixels back
      // out of the canvas after presentation; the lab is a dev tool, so the
      // small cost is worth the measurability.
      gl={{ alpha: false, antialias: true, preserveDrawingBuffer: true }}
      dpr={[1, 2]}
      camera={{ fov: 40, position: [0, 1.3, 5.4], near: 0.1, far: 60 }}
      style={{ position: "fixed", inset: 0, background: "#04060a" }}
    >
      {pinned === null && (
        <Cycle onProgress={(p) => { if (p === 0) setKey((k) => k + 1); setProgress(p); }} />
      )}
      {params().get("spell") === "cube" ? (
        <CubeLoaderView key={key} progress={progress} radius={1} height={2.2} onReady={setLoader as never} />
      ) : (
        <SpellLoaderView key={key} progress={progress} radius={1} height={2.2} onReady={setLoader} />
      )}
      <Debug loader={loader} />
      <OrbitControls target={[0, 1.1, 0]} enablePan={false} />
      {bloom && (
        <EffectComposer>
          <Bloom intensity={1.7} luminanceThreshold={0.30} luminanceSmoothing={0.24} mipmapBlur radius={0.64} />
        </EffectComposer>
      )}
    </Canvas>
  );
}
