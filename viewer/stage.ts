// The deployable viewer's own stage: the @miris-inc/three port of everything
// `<miris-scene>` would otherwise own (renderer, scene, camera, resize, the
// per-frame splat render), plus the workshop's pedestal, stats card and
// annotation cards on top of it.
//
// Renderer parameters are not a style choice: alpha ON so the page's gradient
// backdrop shows through, antialias OFF, and output color space LINEAR because
// the SDK's splat compositor expects a linear target. Changing any of them
// shifts or breaks the splat composite (boutique lesson, measured 2026-08-20).
import * as THREE from "three";
import { MirisScene } from "@miris-inc/three";
import { anchorFor, cardPositionFor, placeAnnotationCard } from "../src/scene/annotations";
import { CanvasCard, paintAnnotation, paintStats } from "../src/scene/cards";
import { fitOnPedestal, Pedestal } from "../src/scene/pedestal";
import type { MonsterLore } from "../server/lore-schema";
import type { MirisBackendLike, MirisSceneInit, MirisSceneObject, MirisStreamObject, StreamBounds } from "./sdk-types";

const CAM_FOV = 45;
const ACCENT = 0xc9954a;
const SPLAT_BUDGET_SEED = 250_000;

// Measure-at-identity fit, the same stability loop the boutique uses: a
// streaming asset's bounds grow as LODs arrive, so poll until the
// characteristic size stops moving before committing to a placement.
const FIT_TRIES = 80;
const FIT_INTERVAL_MS = 500;
const FIT_STABLE_RATIO = 0.03;
// Commit anyway after this many reads: a slow stream can keep creeping past
// the 3% window forever, and a slightly-off fit beats an empty pedestal.
const FIT_FORCE_AFTER_TRIES = 20;

const sceneCtor = MirisScene as unknown as new (init: MirisSceneInit) => MirisSceneObject;

export class ViewerStage {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: MirisSceneObject;
  readonly camera: THREE.PerspectiveCamera;
  readonly #backend: MirisBackendLike;
  readonly #pedestal = new Pedestal();
  readonly #stats = new CanvasCard(1.25, 1.35);
  readonly #scratch = new THREE.Quaternion();
  #annotations: Array<{ card: CanvasCard; line: THREE.Line }> = [];
  #proxy: THREE.Mesh | null = null;
  #raf = 0;
  #dragging = false;
  #lastX = 0;

  constructor(renderer: THREE.WebGLRenderer, scene: MirisSceneObject, camera: THREE.PerspectiveCamera, backend: MirisBackendLike) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    this.#backend = backend;

    this.scene.add(this.#pedestal.group);
    this.scene.add(new THREE.HemisphereLight(0xcdc4ff, 0x120e18, 0.7));
    const key = new THREE.SpotLight(0xffe2b8, 60, 12, 0.7, 0.5);
    key.position.set(2.5, 4.5, 2.5);
    this.scene.add(key);

    this.#stats.mesh.visible = false;
    this.scene.add(this.#stats.mesh);

    renderer.domElement.addEventListener("pointerdown", this.#onDown);
    addEventListener("pointerup", this.#onUp);
    addEventListener("pointermove", this.#onMove);
  }

  start(): void {
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!this.#dragging) this.#pedestal.update(dt);
      this.#edgeAlign(this.#stats.mesh, 1, 1.2, 0.9);
      this.#billboard(this.#stats.mesh);
      for (const a of this.#annotations) this.#billboard(a.card.mesh);
      // One frame: core update (streaming, fades, ordering) then the SDK's
      // full render. doRendering IS the frame; renderer.render() must not
      // also run.
      this.scene.miris.update?.();
      this.#backend.doRendering(this.renderer, this.scene, this.camera);
      this.#raf = requestAnimationFrame(tick);
    };
    this.#raf = requestAnimationFrame(tick);
  }

  /**
   * Mounts a stream on the turntable and waits for its bounds to settle before
   * seating it. The stream stays hidden while measuring so the un-placed pile
   * at the origin is never on screen. Resolves false when the bounds never
   * become usable, which is how a bad or unreachable asset id surfaces.
   */
  seatStream(stream: MirisStreamObject): Promise<boolean> {
    stream.visible = false;
    this.#pedestal.mount.add(stream);
    return new Promise((resolve) => {
      let tries = 0;
      let lastSize = 0;
      const timer = setInterval(() => {
        tries += 1;
        if (tries > FIT_TRIES) {
          clearInterval(timer);
          stream.removeFromParent();
          resolve(false);
          return;
        }
        let bounds: StreamBounds | undefined;
        try {
          bounds = stream.getBounds();
        } catch {
          return;
        }
        const [sx = 0, sy = 0, sz = 0] = bounds?.size ?? [];
        if (!(sx > 0 && sy > 0 && sz > 0) || !Number.isFinite(sx + sy + sz)) return;
        const charSize = Math.cbrt(sx * sy * sz);
        const stable = lastSize > 0 && Math.abs(charSize - lastSize) / lastSize < FIT_STABLE_RATIO;
        lastSize = charSize;
        if (!stable && tries <= FIT_FORCE_AFTER_TRIES) return;
        clearInterval(timer);
        this.#seat(stream, bounds!);
        resolve(true);
      }, FIT_INTERVAL_MS);
    });
  }

  /** Paints the stats card and welds one annotation card per lore annotation
   *  to the monster's surface. Requires a seated stream. */
  applyLore(lore: MonsterLore): void {
    const proxy = this.#proxy;
    if (!proxy) return;
    this.#clearAnnotations();

    paintStats(this.#stats, lore);
    this.#stats.mesh.visible = true;

    const mount = this.#pedestal.mount;
    mount.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(proxy);
    const radius = box.getSize(new THREE.Vector3()).length() / 2;

    for (const a of lore.annotations) {
      const { point, outward } = anchorFor(proxy, a.slot);
      const cardWorld = placeAnnotationCard(cardPositionFor(point, outward, radius));
      // Cards ride the turntable so their leader lines stay welded to the
      // surface point they describe.
      const anchorLocal = mount.worldToLocal(point.clone());
      const cardLocal = mount.worldToLocal(cardWorld.clone());

      const card = new CanvasCard(0.7, 0.4, 384);
      paintAnnotation(card, { label: a.label, blurb: a.blurb });
      card.mesh.position.copy(cardLocal);

      const tip = cardLocal.clone().lerp(anchorLocal, 0.22); // stop short of the card face
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([anchorLocal, tip]),
        new THREE.LineBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.7 }),
      );
      mount.add(card.mesh, line);
      this.#annotations.push({ card, line });
    }
  }

  dispose(): void {
    cancelAnimationFrame(this.#raf);
    removeEventListener("pointerup", this.#onUp);
    removeEventListener("pointermove", this.#onMove);
    this.#clearAnnotations();
    this.#disposeProxy();
    this.#stats.dispose();
    this.#pedestal.dispose();
    this.scene.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // --- internals ---------------------------------------------------------

  /**
   * Seats the stream with the shared pedestal fit, then leaves behind an
   * invisible box the size of the placed monster. A splat stream carries no
   * raycastable geometry, so that box is what `anchorFor` measures and rays
   * against; the raycaster ignores `visible`, so it never costs a pixel.
   */
  #seat(stream: MirisStreamObject, bounds: StreamBounds): void {
    const size = new THREE.Vector3(...bounds.size);
    const center = new THREE.Vector3(...bounds.center);
    const fit = fitOnPedestal({ size, min: new THREE.Vector3(...bounds.min), center }, { maxDim: 1.6, topY: 0.5 });
    stream.scale.setScalar(fit.scale);
    stream.position.copy(fit.position);
    stream.visible = true;

    this.#disposeProxy();
    const proxy = new THREE.Mesh(
      new THREE.BoxGeometry(size.x * fit.scale, size.y * fit.scale, size.z * fit.scale),
      new THREE.MeshBasicMaterial(),
    );
    proxy.visible = false;
    proxy.position.copy(center).multiplyScalar(fit.scale).add(fit.position);
    this.#pedestal.mount.add(proxy);
    this.#pedestal.mount.updateMatrixWorld(true);
    this.#proxy = proxy;
  }

  /** Keeps the stats card just inside the frustum edge at its own depth. */
  #edgeAlign(mesh: THREE.Mesh, side: -1 | 1, y: number, z: number): void {
    const cam = this.camera;
    const dist = Math.max(0.5, cam.position.z - z);
    const halfView = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * dist * cam.aspect;
    const geo = mesh.geometry as THREE.PlaneGeometry;
    const halfCard = (geo.parameters.width ?? 1) / 2;
    mesh.position.set(side * Math.max(halfCard + 0.15, halfView - halfCard - 0.08), y, z);
  }

  /** Faces the camera, correcting for a rotating parent (the turntable). */
  #billboard(obj: THREE.Object3D): void {
    const parent = obj.parent;
    if (!parent || parent === (this.scene as THREE.Scene)) {
      obj.quaternion.copy(this.camera.quaternion);
      return;
    }
    parent.getWorldQuaternion(this.#scratch).invert();
    obj.quaternion.copy(this.#scratch).multiply(this.camera.quaternion);
  }

  #onDown = (e: PointerEvent): void => {
    this.#dragging = true;
    this.#lastX = e.clientX;
  };

  #onUp = (): void => {
    this.#dragging = false;
  };

  #onMove = (e: PointerEvent): void => {
    if (!this.#dragging) return;
    this.#pedestal.mount.rotation.y += (e.clientX - this.#lastX) * 0.006;
    this.#lastX = e.clientX;
  };

  #clearAnnotations(): void {
    for (const a of this.#annotations) {
      a.card.mesh.removeFromParent();
      a.card.dispose();
      a.line.removeFromParent();
      a.line.geometry.dispose();
      (a.line.material as THREE.Material).dispose();
    }
    this.#annotations = [];
  }

  #disposeProxy(): void {
    const proxy = this.#proxy;
    if (!proxy) return;
    proxy.removeFromParent();
    proxy.geometry.dispose();
    (proxy.material as THREE.Material).dispose();
    this.#proxy = null;
  }
}

export async function createViewerStage(viewerKey?: string): Promise<ViewerStage> {
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: false });
  renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
  // Linear output plus ACES tone mapping is the pairing the SDK's own
  // <miris-scene> element shipped, and the one the boutique demo runs in
  // production. Swapping either shifts every splat's tone.
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.1;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.domElement.id = "stage";
  document.body.append(renderer.domElement);

  // viewerKey is optional on purpose: whether a processed asset is readable by
  // uuid alone is an unconfirmed part of the Miris contract, so the field is
  // passed through when the baked config carries one and omitted otherwise.
  const scene = new sceneCtor(viewerKey ? { viewerKey } : {});
  await scene.ready;
  const backend = scene.miris.backend ?? (await scene.miris.initializeBackend());
  scene.miris._setSplatCountBudgetOverride(SPLAT_BUDGET_SEED);

  const camera = new THREE.PerspectiveCamera(CAM_FOV, innerWidth / innerHeight, 0.1, 50);
  camera.position.set(0, 1.4, 4.2);
  camera.lookAt(0, 1.0, 0);

  addEventListener("resize", () => {
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setSize(innerWidth, innerHeight);
  });

  return new ViewerStage(renderer, scene, camera, backend);
}
