import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { anchorFor, cardPositionFor } from "./annotations";
import { CanvasCard, paintAnnotation, paintChecklist, paintConcept, paintMessage, paintStats } from "./cards";
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

const ACCENT = 0xc9954a;
const MESSAGE_BODY_MAX = 240;

const CARD_MIN_Y = 0.62;     // just above the pedestal rim (top at y = 0.5)
const CARD_MAX_Y = 2.15;     // below the top of the default camera frustum
const CARD_MIN_RADIUS = 1.2; // outside the pedestal body (radius ~1.0)

/**
 * Keeps an annotation card in view. A downward slot (base, or anything low on
 * a squat monster) would otherwise sit inside the pedestal where it cannot be
 * seen, and a crown slot on a tall monster would ride off the top of the
 * frame. Clamp both ends; the leader line still points at the surface.
 */
function placeAnnotationCard(p: THREE.Vector3): THREE.Vector3 {
  p.y = Math.min(p.y, CARD_MAX_Y);
  if (p.y >= CARD_MIN_Y) return p;
  p.y = CARD_MIN_Y;
  const flat = Math.hypot(p.x, p.z);
  if (flat < 1e-4) {
    p.z = CARD_MIN_RADIUS;
  } else if (flat < CARD_MIN_RADIUS) {
    const k = CARD_MIN_RADIUS / flat;
    p.x *= k;
    p.z *= k;
  }
  return p;
}

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

  #monster: THREE.Object3D | null = null;
  #modelUrl: string | null = null;
  #loading: Promise<boolean> | null = null;
  #appliedLore: MonsterLore | null = null;
  #annotations: Array<{ card: CanvasCard; line: THREE.Line }> = [];
  #conceptToken = 0;

  readonly #scratch = new THREE.Quaternion();

  constructor(container: HTMLElement) {
    this.#stage = new SceneStage(container);
    this.#stage.scene.add(this.#ritual.group, this.#pedestal.group);

    this.#concept.mesh.position.set(0, 1.3, 0.55);
    this.#message.mesh.position.set(0, 1.75, 1.5);
    this.#stage.scene.add(this.#checklist.mesh, this.#concept.mesh, this.#stats.mesh, this.#message.mesh);

    paintChecklist(this.#checklist, []);
    this.#applyVisibility();

    this.#stage.onFrame.push((dt, t) => {
      this.#ritual.update(dt, t);
      this.#pedestal.update(dt);
      this.#edgeAlign(this.#checklist.mesh, -1, 1.25, 0.9);
      this.#edgeAlign(this.#stats.mesh, 1, 1.2, 0.9);
      this.#billboard(this.#checklist.mesh);
      this.#billboard(this.#concept.mesh);
      this.#billboard(this.#stats.mesh);
      this.#billboard(this.#message.mesh);
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
    paintChecklist(this.#checklist, phases);
  }

  showConcept(c: ConceptView): void {
    // Paint the text-only state first so the card never flashes empty while
    // the preview image downloads.
    paintConcept(this.#concept, { imageBitmap: null, prompt: c.prompt, rerolls: c.rerolls });
    this.#hasConcept = true;
    this.#applyVisibility();
    const token = ++this.#conceptToken;
    void this.#loadConceptImage(c, token);
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

  applyOrbitDelta(dx: number): void {
    this.#pedestal.mount.rotation.y += dx * 0.006;
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

  /** Keeps a side card just inside the frustum edge at its own depth. */
  #edgeAlign(mesh: THREE.Mesh, side: -1 | 1, y: number, z: number): void {
    const cam = this.#stage.camera;
    const dist = Math.max(0.5, cam.position.z - z);
    const halfView = Math.tan(THREE.MathUtils.degToRad(cam.fov / 2)) * dist * cam.aspect;
    const geo = mesh.geometry as THREE.PlaneGeometry;
    const halfCard = (geo.parameters.width ?? 1) / 2;
    mesh.position.set(side * Math.max(halfCard + 0.15, halfView - halfCard - 0.08), y, z);
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

    const mount = this.#pedestal.mount;
    const box = new THREE.Box3().setFromObject(monster);
    const radius = box.getSize(new THREE.Vector3()).length() / 2;

    for (const a of lore.annotations) {
      const { point, outward } = anchorFor(monster, a.slot);
      const cardWorld = placeAnnotationCard(cardPositionFor(point, outward, radius));
      // Annotation cards ride the turntable so their leader lines stay welded
      // to the surface point they describe.
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
