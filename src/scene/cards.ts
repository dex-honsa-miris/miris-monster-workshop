import * as THREE from "three";
import { annotationMarkup, statsMarkup } from "./card-html";
import type { MonsterLore } from "../../server/lore-schema";

export function wrapText(text: string, maxChars: number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let line = "";
  for (let w of words) {
    while (w.length > maxChars) {
      if (line) { lines.push(line); line = ""; }
      lines.push(w.slice(0, maxChars));
      w = w.slice(maxChars);
    }
    if (!w) continue;
    const candidate = line ? `${line} ${w}` : w;
    if (candidate.length <= maxChars) line = candidate;
    else { lines.push(line); line = w; }
  }
  if (line) lines.push(line);
  return lines;
}

// Miris brand (miris.com): cool near-black, white ink, Geist. Only the
// annotation card is painted here now -- the screen-pinned panels are DOM
// (src/app/panels.tsx), so the palette this file needs is small.
const INK = "#ffffff";
const PANEL = "#111215";
const MUTED = "#9e9d9f";
const LINE = "#26272c";
const SANS = '"Geist", system-ui, sans-serif';

// --- WICG html-in-canvas (chrome://flags/#canvas-draw-element) ---------------
// When the API exists, cards rasterize LIVE HTML elements into their textures
// (drawElementImage); otherwise the fillText painters below draw the same
// content. Detection is a real prototype check, not a UA sniff.
interface ElementDrawingContext extends CanvasRenderingContext2D {
  drawElementImage(element: Element, dx: number, dy: number, dw?: number, dh?: number): void;
}

export const htmlInCanvasSupported =
  typeof CanvasRenderingContext2D !== "undefined" &&
  "drawElementImage" in CanvasRenderingContext2D.prototype;

/** Host for the live card DOM the html path rasterizes from. Chromium only
 * keeps a paint record for elements that actually PAINT: offscreen positions
 * and opacity:0 both cull them (measured), which makes drawElementImage throw
 * "No cached paint record". A scale(0.001) ancestor keeps the subtree painted
 * while rendering it a fraction of a pixel tall in the corner. */
let domHost: HTMLDivElement | null = null;
function cardDomHost(): HTMLDivElement {
  if (!domHost) {
    domHost = document.createElement("div");
    domHost.id = "card-dom-host";
    domHost.style.cssText =
      "position:fixed;left:0;top:0;transform:scale(0.001);transform-origin:top left;pointer-events:none;z-index:0";
    document.body.append(domHost);
  }
  return domHost;
}

/** Card canvases render at 2x their logical resolution: at typical card
 * distance a 512-logical card covers 1000+ device pixels on a DPR-2 screen,
 * and a 1:1 texture reads visibly soft. Painters and hit-testing stay in
 * LOGICAL pixels; the context transform hides the supersample. */
const SUPERSAMPLE = 2;

export class CanvasCard {
  readonly mesh: THREE.Mesh;
  readonly texture: THREE.CanvasTexture;
  readonly #canvas: HTMLCanvasElement;
  readonly #logicalW: number;
  readonly #logicalH: number;
  constructor(worldW: number, worldH: number, px = 512) {
    this.#logicalW = px;
    this.#logicalH = Math.round((px * worldH) / worldW);
    this.#canvas = document.createElement("canvas");
    this.#canvas.width = this.#logicalW * SUPERSAMPLE;
    this.#canvas.height = this.#logicalH * SUPERSAMPLE;
    this.texture = new THREE.CanvasTexture(this.#canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true });
    mat.toneMapped = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), mat);
  }
  #htmlRoot: HTMLDivElement | null = null;
  #fontsHooked = false;

  /** LOGICAL pixel size: what painters and hit-tests reason in. */
  get pxWidth(): number { return this.#logicalW; }
  get pxHeight(): number { return this.#logicalH; }

  /** html-in-canvas path: mount the markup as a LIVE child of this card's
   * canvas (which needs layout, so the canvas lives in the hidden DOM host)
   * and rasterize it with drawElementImage. Layout runs asynchronously after
   * a DOM mutation, so the draw lands on the next frame; images and late
   * webfonts trigger their own redraws. */
  paintHtml(html: string): void {
    if (!this.#htmlRoot) {
      this.#canvas.setAttribute("layoutsubtree", "");
      this.#htmlRoot = document.createElement("div");
      this.#htmlRoot.style.cssText = `width:${this.#logicalW}px;height:${this.#logicalH}px`;
      this.#canvas.append(this.#htmlRoot);
      cardDomHost().append(this.#canvas);
    }
    this.#htmlRoot.innerHTML = html;
    for (const img of this.#htmlRoot.querySelectorAll("img")) {
      if (!img.complete) img.addEventListener("load", () => this.#drawElement(), { once: true });
    }
    if (!this.#fontsHooked) {
      this.#fontsHooked = true;
      document.fonts?.ready.then(() => this.#drawElement()).catch(() => undefined);
    }
    // A fresh subtree has no paint record until the NEXT frame has painted;
    // rAF callbacks run pre-paint, so a single rAF still sees the old record
    // state. Double-rAF lands after that paint.
    requestAnimationFrame(() => requestAnimationFrame(() => this.#drawElement()));
  }

  #drawElement(retries = 8): void {
    const root = this.#htmlRoot;
    if (!root || !root.isConnected) return;
    const ctx = this.#canvas.getContext("2d") as ElementDrawingContext;
    ctx.setTransform(SUPERSAMPLE, 0, 0, SUPERSAMPLE, 0, 0);
    ctx.clearRect(0, 0, this.#logicalW, this.#logicalH);
    try {
      ctx.drawElementImage(root, 0, 0, this.#logicalW, this.#logicalH);
      this.texture.needsUpdate = true;
    } catch (e) {
      // "No cached paint record" simply means the compositor has not painted
      // the new subtree yet; try again next frame, bounded.
      if (retries > 0) requestAnimationFrame(() => this.#drawElement(retries - 1));
      else console.warn("[workshop] drawElementImage kept failing; card left as-is:", e);
    }
  }
  paint(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    const ctx = this.#canvas.getContext("2d")!;
    ctx.setTransform(SUPERSAMPLE, 0, 0, SUPERSAMPLE, 0, 0);
    ctx.clearRect(0, 0, this.#logicalW, this.#logicalH);
    draw(ctx, this.#logicalW, this.#logicalH);
    this.texture.needsUpdate = true;
  }
  dispose(): void {
    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
    this.#canvas.remove(); // detaches from the DOM host on the html path
  }
}

function panel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = PANEL;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, 12);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();
}

export function paintAnnotation(card: CanvasCard, a: { label: string; blurb: string }): void {
  if (htmlInCanvasSupported) { card.paintHtml(annotationMarkup(a)); return; }
  card.paint((ctx, w, h) => {
    panel(ctx, w, h);
    ctx.fillStyle = INK;
    ctx.font = `600 26px ${SANS}`;
    ctx.fillText(a.label, 24, 44);
    ctx.fillStyle = MUTED;
    ctx.font = `20px ${SANS}`;
    let y = 80;
    for (const line of wrapText(a.blurb, 30)) { ctx.fillText(line, 24, y); y += 27; }
  });
}

/** Viewer-only. The published page (viewer/stage.ts) is a pure 3D scene with
 * no DOM chrome, so its lore card stays a card. The workshop app renders the
 * same fields as real DOM; see src/app/panels.tsx. */
export function paintStats(card: CanvasCard, lore: MonsterLore, icon: ImageBitmap | null = null, iconUrl: string | null = null): void {
  if (htmlInCanvasSupported) { card.paintHtml(statsMarkup(lore, iconUrl)); return; }
  card.paint((ctx, w, h) => {
    panel(ctx, w, h);
    ctx.fillStyle = INK;
    ctx.font = `600 38px ${SANS}`;
    ctx.fillText(lore.name, 28, 54);
    ctx.fillStyle = MUTED;
    ctx.font = `italic 400 23px ${SANS}`;
    ctx.fillText(lore.epithet, 28, 82);
    if (icon) {
      ctx.drawImage(icon, w - 96, 24, 72, 72);
      ctx.strokeStyle = LINE;
      ctx.strokeRect(w - 96, 24, 72, 72);
    }
    let y = 144;
    ctx.font = `19px ${SANS}`;
    for (const [k, v] of Object.entries(lore.stats)) {
      ctx.fillStyle = MUTED;
      ctx.fillText(k, 28, y);
      ctx.fillStyle = "#1a1b1f";
      ctx.fillRect(130, y - 11, 200, 10);
      ctx.fillStyle = INK;
      ctx.fillRect(130, y - 11, 20 * (v as number), 10);
      y += 31;
    }
    y += 32;
    for (const a of lore.abilities) {
      ctx.fillStyle = INK;
      ctx.font = `600 18px ${SANS}`;
      ctx.fillText(a.name, 28, y);
      y += 21;
      ctx.fillStyle = MUTED;
      ctx.font = `16px ${SANS}`;
      for (const line of wrapText(a.blurb, 42)) { ctx.fillText(line, 28, y); y += 19; }
      y += 7;
    }
    ctx.fillStyle = MUTED;
    ctx.font = `400 18px ${SANS}`;
    y += 10;
    // Fixed card height, variable lore length: draw what fits and mark a trim.
    const lines = wrapText(lore.lore, 40);
    for (let i = 0; i < lines.length; i++) {
      const last = y + 24 > h - 22;
      ctx.fillText(last && i < lines.length - 1 ? `${lines[i]!.slice(0, 37)}...` : lines[i]!, 28, y);
      y += 24;
      if (last) break;
    }
  });
}
