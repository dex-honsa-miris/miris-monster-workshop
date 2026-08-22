import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { anchorFor, cardPositionFor, placeAnnotationCard } from "./annotations";
import { CanvasCard, checklistRowAt, htmlInCanvasSupported, layoutChecklist, paintAnnotation, paintChecklist, paintConcept, paintMessage, paintStats } from "./cards";
import { Pedestal } from "./pedestal";
import { RitualCircle } from "./ritual";
import { SceneStage } from "./stage";
import type { Phase } from "../app/checklist-model";
import type { FlowPhase } from "../app/flow";
import type { MonsterLore } from "../../server/lore-schema";

export interface ConceptView {
  imageUrl: string;
  prompt: string;
  rerolls: number;
}

const LEADER = 0x82838a;
const CARD_DEPTH = 4.2; // how far in front of the camera the HUD cards sit
const EDGE_CARD_MAX = 0.78; // keeps side cards from crowding the creature
const DISCOVERED = 0xff3500; // player-found annotations get the accent leader
const MESSAGE_BODY_MAX = 240;

/**
 * The one place that knows three.js in the app layer. React holds a single
 * SceneDirector and drives it with imperative calls; nothing in `src/app`
 * touches the scene graph directly.
 */
export class SceneDirector {
  readonly #stage: SceneStage;
  readonly #ritual = new RitualCircle();
  readonly #pedestal = new Pedestal();
  readonly #checklist = new CanvasCard(1.35, 1.6);
  readonly #concept = new CanvasCard(1.1, 1.4); // taller than wide: paintConcept lays out below a square image
  readonly #stats = new CanvasCard(1.25, 1.35);
  readonly #message = new CanvasCard(1.5, 0.75);

  #phase: FlowPhase = "setup";
  #hasConcept = false;
  #hasStats = false;
  #hasMessage = false;
  #disposed = false;

  #checklistPhases: Phase[] = [];
  #checklistHover: string | null = null;
  readonly #raycaster = new THREE.Raycaster();
  readonly #ndc = new THREE.Vector2();

  #monster: THREE.Object3D | null = null;
  #modelUrl: string | null = null;
  #loading: Promise<boolean> | null = null;
  #appliedLore: MonsterLore | null = null;
  #annotations: Array<{ card: CanvasCard; line: THREE.Line }> = [];
  #conceptToken = 0;

  readonly #scratch = new THREE.Quaternion();
  #probeTarget: THREE.WebGLRenderTarget | null = null;
  #probeCamera = new THREE.PerspectiveCamera(32, 1, 0.01, 40);
  #probing = false;

  constructor(container: HTMLElement) {
    this.#stage = new SceneStage(container);
    this.#stage.scene.add(this.#ritual.group, this.#pedestal.group);

    this.#concept.mesh.position.set(0, 1.3, 0.55);
    // Below the DOM masthead (which overlays the canvas top-center): a
    // message at y~1.75 rendered exactly behind the title and was unreadable.
    this.#message.mesh.position.set(0, 1.35, 1.3);
    this.#stage.scene.add(this.#checklist.mesh, this.#concept.mesh, this.#stats.mesh, this.#message.mesh);

    paintChecklist(this.#checklist, []);
    this.#applyVisibility();
    // Card text is painted into canvases, and canvas fillText does NOT
    // trigger @font-face loads the way DOM text does -- request the faces the
    // painters use explicitly, then repaint once they are really in.
    void (async () => {
      try {
        await Promise.all([
          document.fonts.load('400 20px "Geist"'),
          document.fonts.load('600 22px "Geist"'),
          document.fonts.load('italic 400 17px "Geist"'),
          document.fonts.load('500 14px "Geist Mono"'),
        ]);
      } catch { /* fallback stacks are fine */ }
      if (!this.#disposed) paintChecklist(this.#checklist, this.#checklistPhases, this.#checklistHover);
    })();

    this.#stage.onFrame.push((dt, t) => {
      this.#ritual.update(dt, t);
      this.#pedestal.update(dt);
      this.#placeHud(this.#checklist.mesh, -1, 0.1);
      this.#placeHud(this.#stats.mesh, 1, 0.06);
      this.#placeHud(this.#concept.mesh, 0, 0.08);
      this.#placeHud(this.#message.mesh, 0, 0.5);
      for (const a of this.#annotations) this.#billboard(a.card.mesh);
    });
    this.#stage.start();
  }

  // --- imperative API the React layer calls ------------------------------

  showPhase(phase: FlowPhase): void {
    this.#phase = phase;
    this.#applyVisibility();
  }

  showChecklist(phases: Phase[]): void {
    this.#checklistPhases = phases;
    paintChecklist(this.#checklist, phases, this.#checklistHover);
  }

  /** Hover feedback for the checklist card; safe to call every pointermove. */
  pointerMove(clientX: number, clientY: number): void {
    const row = this.#checklistRowAt(clientX, clientY);
    const hover = row?.href ? row.id : null;
    if (hover !== this.#checklistHover) {
      this.#checklistHover = hover;
      paintChecklist(this.#checklist, this.#checklistPhases, hover);
      this.#stage.renderer.domElement.style.cursor = hover ? "pointer" : "";
    }
  }

  /** A click that was not a drag. Returns true when the scene consumed it. */
  tap(clientX: number, clientY: number): boolean {
    const row = this.#checklistRowAt(clientX, clientY);
    if (!row?.href) return false;
    window.open(row.href, "_blank", "noopener");
    return true;
  }

  showConcept(c: ConceptView): void {
    // Paint the text-only state first so the card never flashes empty while
    // the preview image downloads. On the html-in-canvas path the template's
    // live <img> handles its own loading and redraw.
    paintConcept(this.#concept, { imageBitmap: null, imageUrl: c.imageUrl, prompt: c.prompt, rerolls: c.rerolls });
    this.#hasConcept = true;
    this.#applyVisibility();
    if (!htmlInCanvasSupported) {
      const token = ++this.#conceptToken;
      void this.#loadConceptImage(c, token);
    }
  }

  setRitualBusy(busy: boolean): void {
    this.#ritual.setIntensity(busy ? 1 : 0.2);
  }

  showMessage(msg: { title: string; body: string } | null): void {
    if (!msg) {
      this.#hasMessage = false;
      this.#applyVisibility();
      return;
    }
    paintMessage(this.#message, { title: msg.title, body: msg.body.slice(0, MESSAGE_BODY_MAX) });
    this.#hasMessage = true;
    this.#applyVisibility();
  }

  /** Resolves once a monster mesh is on the pedestal (or immediately if it
   * already is). Lets the app restore saved discoveries without racing the
   * GLB load. */
  async whenRevealed(): Promise<void> {
    if (this.#monster) return;
    if (this.#loading) { await this.#loading; return; }
    for (let i = 0; i < 200 && !this.#monster && !this.#disposed; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
  }

  /** Raycast the monster under the pointer. Returns the world hit point, or
   * null when the pointer is not on the monster. */
  monsterPointAt(clientX: number, clientY: number): THREE.Vector3 | null {
    const monster = this.#monster;
    if (!monster || this.#phase !== "reveal") return null;
    const el = this.#stage.renderer.domElement;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    this.#ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.#raycaster.setFromCamera(this.#ndc, this.#stage.camera);
    return this.#raycaster.intersectObject(monster, true)[0]?.point.clone() ?? null;
  }

  /** Renders the two images the annotate call needs: a closeup framed on the
   * clicked point (the model identifies whatever fills the center) and a
   * full-body context shot. Cards, lines and the ritual are hidden for both
   * renders so only the creature is in frame. */
  captureProbe(point: THREE.Vector3): { closeup: string; context: string } | null {
    const monster = this.#monster;
    const renderer = this.#stage.renderer;
    if (!monster || this.#probing) return null;
    this.#probing = true;
    const hidden: THREE.Object3D[] = [this.#ritual.group, this.#checklist.mesh, this.#stats.mesh, this.#concept.mesh, this.#message.mesh];
    for (const a of this.#annotations) hidden.push(a.card.mesh, a.line);
    const wasVisible = hidden.map((o) => o.visible);
    hidden.forEach((o) => { o.visible = false; });
    const prevTarget = renderer.getRenderTarget();
    try {
      this.#probeTarget ??= new THREE.WebGLRenderTarget(512, 512);
      const box = new THREE.Box3().setFromObject(monster);
      const radius = Math.max(0.001, box.getSize(new THREE.Vector3()).length() / 2);
      const center = box.getCenter(new THREE.Vector3());
      const cam = this.#probeCamera;

      // Closeup: sit off the clicked point along the direction away from the
      // monster's center, so the clicked surface faces the camera.
      const outward = point.clone().sub(center).normalize();
      if (!Number.isFinite(outward.x) || outward.lengthSq() < 1e-6) outward.set(0, 0, 1);
      cam.position.copy(point).addScaledVector(outward, radius * 0.85);
      cam.lookAt(point);
      cam.updateProjectionMatrix();
      const closeup = this.#renderProbe();

      // Context: the whole creature from the app camera's side.
      const dir = this.#stage.camera.position.clone().sub(center).normalize();
      cam.position.copy(center).addScaledVector(dir, radius * 3.4);
      cam.lookAt(center);
      cam.updateProjectionMatrix();
      const context = this.#renderProbe();
      return { closeup, context };
    } catch (e) {
      console.warn("[workshop] probe capture failed:", e);
      return null;
    } finally {
      renderer.setRenderTarget(prevTarget);
      hidden.forEach((o, i) => { o.visible = wasVisible[i] ?? true; });
      this.#probing = false;
    }
  }

  #renderProbe(): string {
    const renderer = this.#stage.renderer;
    const target = this.#probeTarget!;
    renderer.setRenderTarget(target);
    renderer.render(this.#stage.scene, this.#probeCamera);
    const pixels = new Uint8Array(target.width * target.height * 4);
    renderer.readRenderTargetPixels(target, 0, 0, target.width, target.height, pixels);
    const canvas = document.createElement("canvas");
    canvas.width = target.width;
    canvas.height = target.height;
    const ctx = canvas.getContext("2d")!;
    const img = ctx.createImageData(target.width, target.height);
    // GL reads bottom-up; flip into image order.
    for (let y = 0; y < target.height; y++) {
      const src = (target.height - 1 - y) * target.width * 4;
      img.data.set(pixels.subarray(src, src + target.width * 4), y * target.width * 4);
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  /** Adds a discovered annotation card at an exact world point. */
  addDiscovery(d: { label: string; blurb: string }, worldPoint: THREE.Vector3): void {
    const monster = this.#monster;
    if (!monster) return;
    const mount = this.#pedestal.mount;
    const box = new THREE.Box3().setFromObject(monster);
    const radius = box.getSize(new THREE.Vector3()).length() / 2;
    const outward = worldPoint.clone().sub(box.getCenter(new THREE.Vector3())).normalize();
    if (outward.lengthSq() < 1e-6) outward.set(0, 0, 1);
    const cardWorld = placeAnnotationCard(worldPoint.clone().addScaledVector(outward, Math.max(0.4, radius * 0.5)));
    const anchorLocal = mount.worldToLocal(worldPoint.clone());
    const cardLocal = mount.worldToLocal(cardWorld);
    const card = new CanvasCard(0.62, 0.34, 384);
    paintAnnotation(card, d);
    card.mesh.position.copy(cardLocal);
    const tip = cardLocal.clone().lerp(anchorLocal, 0.22);
    const line = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([anchorLocal, tip]),
      new THREE.LineBasicMaterial({ color: DISCOVERED, transparent: true, opacity: 0.85 }),
    );
    mount.add(card.mesh, line);
    this.#annotations.push({ card, line });
    this.#applyVisibility();
  }

  /** Drag orbits the CAMERA around the whole scene: ring, embers, pedestal
   * and monster all hold together while the viewpoint moves. */
  applyOrbitDelta(dx: number, dy = 0): void {
    this.#stage.orbitBy(dx * -0.006, dy * -0.004);
  }

  /** Wheel / pinch: pull in or back out. */
  applyZoom(factor: number): void {
    this.#stage.zoomBy(factor);
  }

  /**
   * Loads the GLB once per URL and (re)builds the lore cards when the lore
   * document arrives, which can be after the model. Safe to call repeatedly:
   * React effect re-runs and strict-mode double invocation both land here.
   */
  async revealMonster(glbUrl: string, lore: MonsterLore | null): Promise<void> {
    if (this.#modelUrl !== glbUrl) {
      this.#modelUrl = glbUrl;
      this.#loading = this.#loadModel(glbUrl);
    }
    const ok = this.#loading ? await this.#loading : false;
    if (!ok || this.#disposed) return;
    if (lore && lore !== this.#appliedLore) this.#applyLore(lore);
  }

  dispose(): void {
    this.#disposed = true;
    this.#clearAnnotations();
    this.#disposeMonster();
    for (const card of [this.#checklist, this.#concept, this.#stats, this.#message]) card.dispose();
    this.#probeTarget?.dispose();
    this.#ritual.dispose();
    this.#pedestal.dispose();
    this.#stage.dispose();
  }

  // --- internals ---------------------------------------------------------

  #applyVisibility(): void {
    this.#concept.mesh.visible = this.#hasConcept && (this.#phase === "create" || this.#phase === "summoning");
    this.#stats.mesh.visible = this.#hasStats && this.#phase === "reveal";
    this.#message.mesh.visible = this.#hasMessage;
    for (const a of this.#annotations) {
      a.card.mesh.visible = this.#phase === "reveal";
      a.line.visible = this.#phase === "reveal";
    }
  }

  /** Places a card in world space as if it were pinned to the screen: at
   * CARD_DEPTH in front of the camera, offset along the camera's right and up
   * axes, and rotated to face the camera. `side` -1/1 parks it against the
   * left/right frustum edge, 0 centers it; the card also scales down when the
   * viewport is too narrow to hold it. */
  #placeHud(mesh: THREE.Mesh, side: -1 | 0 | 1, up: number): void {
    const cam = this.#stage.camera;
    const depth = CARD_DEPTH;
    const halfView = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * depth * cam.aspect;
    const width = (mesh.geometry as THREE.PlaneGeometry).parameters.width ?? 1;
    const limit = side === 0 ? 2 * halfView * 0.62 : 2 * halfView - 0.16;
    mesh.scale.setScalar(Math.max(0.05, Math.min(side === 0 ? 0.8 : EDGE_CARD_MAX, limit / width)));
    const halfCard = (width * mesh.scale.x) / 2;
    const x = side === 0 ? 0 : side * Math.max(0, halfView - halfCard - 0.06);

    cam.updateMatrixWorld();
    const basis = cam.matrixWorld;
    const right = new THREE.Vector3().setFromMatrixColumn(basis, 0);
    const upVec = new THREE.Vector3().setFromMatrixColumn(basis, 1);
    const forward = new THREE.Vector3().setFromMatrixColumn(basis, 2).negate();
    mesh.position.copy(cam.position)
      .addScaledVector(forward, depth)
      .addScaledVector(right, x)
      .addScaledVector(upVec, up);
    mesh.quaternion.copy(cam.quaternion);
  }

  #checklistRowAt(clientX: number, clientY: number): ReturnType<typeof checklistRowAt> {
    if (!this.#checklist.mesh.visible || this.#checklistPhases.length === 0) return null;
    const el = this.#stage.renderer.domElement;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return null;
    this.#ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.#raycaster.setFromCamera(this.#ndc, this.#stage.camera);
    this.#checklist.mesh.updateMatrixWorld(true); // camera child: keep world matrix fresh for the ray
    const hit = this.#raycaster.intersectObject(this.#checklist.mesh, false)[0];
    if (!hit?.uv) return null;
    // CanvasTexture default flipY: uv v=1 is the TOP of the canvas.
    const xPx = hit.uv.x * this.#checklist.pxWidth;
    const yPx = (1 - hit.uv.y) * this.#checklist.pxHeight;
    return checklistRowAt(layoutChecklist(this.#checklistPhases).rows, xPx, yPx, this.#checklist.pxWidth);
  }

  /** Faces the camera, correcting for a rotating parent (the turntable). */
  #billboard(obj: THREE.Object3D): void {
    const cam = this.#stage.camera;
    const parent = obj.parent;
    if (!parent || parent === this.#stage.scene) {
      obj.quaternion.copy(cam.quaternion);
      return;
    }
    parent.getWorldQuaternion(this.#scratch).invert();
    obj.quaternion.copy(this.#scratch).multiply(cam.quaternion);
  }

  async #loadConceptImage(c: ConceptView, token: number): Promise<void> {
    try {
      const res = await fetch(c.imageUrl);
      if (!res.ok) throw new Error(`concept image ${res.status}`);
      const bitmap = await createImageBitmap(await res.blob());
      if (this.#disposed || token !== this.#conceptToken) {
        bitmap.close();
        return;
      }
      paintConcept(this.#concept, { imageBitmap: bitmap, prompt: c.prompt, rerolls: c.rerolls });
      bitmap.close();
    } catch (e) {
      // The prompt-only card stays up; the preview is decoration, not the run.
      console.warn("[workshop] concept preview did not load:", e);
    }
  }

  async #loadModel(url: string): Promise<boolean> {
    try {
      const gltf = await new GLTFLoader().loadAsync(url);
      if (this.#disposed) return false;
      this.#clearAnnotations();
      this.#disposeMonster();
      this.#appliedLore = null;
      this.#hasStats = false;
      this.#monster = gltf.scene;
      this.#pedestal.setMonster(gltf.scene);
      this.#applyVisibility();
      return true;
    } catch (e) {
      this.#modelUrl = null; // let a later call retry
      this.#loading = null;
      this.showMessage({
        title: "The monster did not arrive",
        body: `Could not load ${url}. ${e instanceof Error ? e.message : String(e)}`,
      });
      return false;
    }
  }

  #applyLore(lore: MonsterLore): void {
    const monster = this.#monster;
    if (!monster) return;
    this.#appliedLore = lore;
    this.#clearAnnotations();

    paintStats(this.#stats, lore);
    this.#hasStats = true;
    // The emblem icon is optional and arrives with the manifest stage; fetch
    // it lazily and repaint the stats card when it lands (404 = no icon).
    void (async () => {
      try {
        const res = await fetch("/generated/icon.png");
        if (!res.ok) return;
        if (htmlInCanvasSupported) { paintStats(this.#stats, lore, null, "/generated/icon.png"); return; }
        const bitmap = await createImageBitmap(await res.blob());
        if (this.#appliedLore === lore && !this.#disposed) paintStats(this.#stats, lore, bitmap);
        bitmap.close();
      } catch { /* icon is decoration */ }
    })();

    const mount = this.#pedestal.mount;
    const box = new THREE.Box3().setFromObject(monster);
    const radius = box.getSize(new THREE.Vector3()).length() / 2;

    for (const a of lore.annotations) {
      const { point, outward } = anchorFor(monster, a.slot);
      const cardWorld = placeAnnotationCard(cardPositionFor(point, outward, radius, a.slot));
      // Annotation cards ride the turntable so their leader lines stay welded
      // to the surface point they describe.
      const anchorLocal = mount.worldToLocal(point.clone());
      const cardLocal = mount.worldToLocal(cardWorld.clone());

      const card = new CanvasCard(0.62, 0.34, 384);
      paintAnnotation(card, { label: a.label, blurb: a.blurb });
      card.mesh.position.copy(cardLocal);

      const tip = cardLocal.clone().lerp(anchorLocal, 0.22); // stop short of the card face
      const line = new THREE.Line(
        new THREE.BufferGeometry().setFromPoints([anchorLocal, tip]),
        new THREE.LineBasicMaterial({ color: LEADER, transparent: true, opacity: 0.6 }),
      );
      mount.add(card.mesh, line);
      this.#annotations.push({ card, line });
    }
    this.#applyVisibility();
  }

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

  #disposeMonster(): void {
    const monster = this.#monster;
    if (!monster) return;
    monster.removeFromParent();
    monster.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const mat of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(mat)) if (value instanceof THREE.Texture) value.dispose();
        mat.dispose();
      }
    });
    this.#monster = null;
  }
}
