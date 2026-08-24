// R3F wrapper: owns one SpellLoader, feeds it progress and delta time.
// Progress is a prop, so React drives it while the animation itself stays
// entirely inside the class (nothing per-frame crosses the React boundary).
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { SpellLoader, type SpellLoaderOptions } from "./SpellLoader";

export interface SpellLoaderViewProps extends SpellLoaderOptions {
  /** Progress as a prop. Convenient, but re-renders on every change --
   * prefer progressSource when something drives it every frame. */
  progress?: number;
  /** Polled once per frame instead of `progress`. Nothing crosses the React
   * boundary, so a continuously advancing loader costs no re-renders. */
  progressSource?: () => number;
  onComplete?: () => void;
  /** Handed the loader once built, for tooling that drives it directly. */
  onReady?: (loader: SpellLoader) => void;
  position?: [number, number, number];
}

export function SpellLoaderView({ progress, progressSource, onComplete, onReady, position, ...opts }: SpellLoaderViewProps): React.ReactElement {
  const loader = useMemo(() => new SpellLoader(opts), [
    // Rebuild only on structural changes; colours and speeds are read live.
    opts.radius, opts.height, opts.bandCount, opts.particleCount, opts.dustCount,
  ]);

  useEffect(() => () => loader.dispose(), [loader]);
  useEffect(() => { if (onComplete) loader.onComplete(onComplete); }, [loader, onComplete]);
  useEffect(() => {
    if (progressSource === undefined && progress !== undefined) loader.setProgress(progress);
  }, [loader, progress, progressSource]);
  useEffect(() => { onReady?.(loader); }, [loader, onReady]);

  useFrame((_, dt) => {
    if (progressSource) loader.setProgress(progressSource());
    loader.update(dt);
  });

  return <primitive object={loader.group} position={position ?? [0, 0, 0]} />;
}
