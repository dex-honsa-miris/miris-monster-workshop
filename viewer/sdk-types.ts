import type * as THREE from "three";

// ---------------------------------------------------------------------------
// Minimal local declarations for the @miris-inc SDK surface this viewer uses.
//
// The published three.d.ts cannot be consumed directly: it declares
// `Miris extends Miris_2` where `Miris_2` comes from the subpath
// `@miris-inc/core/index.ts`, and core's package.json "exports" map has no
// entry for that subpath, so the import fails to resolve, `Miris_2` degrades
// to implicit any, and every inherited member loses its type. On top of that
// `_setSplatCountBudgetOverride` is stamped "Excluded from this release type"
// in the compiled core.d.ts. Every member declared here is present and
// callable at runtime in this SDK build (0.0.8-dc2d7ec), proven by the
// sibling boutique demo running on it in production.
// ---------------------------------------------------------------------------

export interface StreamBounds {
  size: [number, number, number];
  center: [number, number, number];
  min: [number, number, number];
  max: [number, number, number];
}

export interface MirisBackendLike {
  /** The whole frame: draws ordinary three content AND the splat composite.
   *  Never call renderer.render() alongside it. */
  doRendering(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.PerspectiveCamera): void;
}

export interface MirisInstance {
  /** The working perf lever on the public SDK: a seed the heuristic
   *  controller scales from, not a hard cap. */
  _setSplatCountBudgetOverride(maxSplats: number): void;
  backend?: MirisBackendLike;
  initializeBackend(): Promise<MirisBackendLike>;
  /** Core per-frame update: streaming, fades, ordering. */
  update?: () => unknown;
}

/** `new MirisScene(init)` is a real THREE.Scene subclass; `ready` resolves
 *  once the core WASM engine is initialized. */
export interface MirisSceneObject extends THREE.Scene {
  readonly ready: Promise<unknown>;
  readonly miris: MirisInstance;
  dispose(): void;
}

/** `new MirisStream(init)` is a real THREE.Group: position / rotation / scale
 *  are plain Object3D transforms. `getBounds()` reports the local box, and is
 *  only meaningful before the group has been transformed, hence the
 *  measure-at-identity fit in stage.ts. */
export interface MirisStreamObject extends THREE.Group {
  getBounds(): StreamBounds | undefined;
}

export interface MirisSceneInit {
  viewerKey?: string;
}

export interface MirisStreamInit {
  uuid: string;
  viewerKey?: string;
}
