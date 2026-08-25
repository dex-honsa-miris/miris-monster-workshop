// R3F wrapper for CubeLoader: identical contract to SpellLoaderView, so the
// scene can swap loaders per creation path without learning anything new.
import { useFrame } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import { CubeLoader, type CubeLoaderOptions } from "./CubeLoader";

export interface CubeLoaderViewProps extends CubeLoaderOptions {
  progress?: number;
  progressSource?: () => number;
  onComplete?: () => void;
  onReady?: (loader: CubeLoader) => void;
  position?: [number, number, number];
}

export function CubeLoaderView({ progress, progressSource, onComplete, onReady, position, ...opts }: CubeLoaderViewProps): React.ReactElement {
  const loader = useMemo(() => new CubeLoader(opts), [
    // Rebuild only on structural changes; colours and speeds are read live.
    opts.radius, opts.height, opts.rainCount,
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
