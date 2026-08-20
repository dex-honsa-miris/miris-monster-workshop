import * as THREE from "three";
import type { ChecklistItem, Phase } from "../app/checklist-model";
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

const INK = "#ece2d0";
const PANEL = "#18130e";
const ACCENT = "#c9954a";
const ACCENT_BRIGHT = "#e8c284";
const MUTED = "#a3947e";
const STATE_COLOR = { todo: "#6f6353", doing: ACCENT, done: "#7da06f", error: "#c96a4f" } as const;
const SERIF = '"Cormorant Garamond", Georgia, serif';
const SANS = '"Instrument Sans", system-ui, sans-serif';

/** Tracked uppercase, the brand's kicker register. Canvas letterSpacing is
 * Chromium 99+; elsewhere the text just renders untracked, which is fine. */
function kicker(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.font = `600 ${px}px ${SANS}`;
  try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "3px"; } catch { /* untracked */ }
}
function resetTracking(ctx: CanvasRenderingContext2D): void {
  try { (ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = "0px"; } catch { /* noop */ }
}

export class CanvasCard {
  readonly mesh: THREE.Mesh;
  readonly texture: THREE.CanvasTexture;
  readonly #canvas: HTMLCanvasElement;
  constructor(worldW: number, worldH: number, px = 512) {
    this.#canvas = document.createElement("canvas");
    this.#canvas.width = px;
    this.#canvas.height = Math.round((px * worldH) / worldW);
    this.texture = new THREE.CanvasTexture(this.#canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.MeshBasicMaterial({ map: this.texture, transparent: true });
    mat.toneMapped = false;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(worldW, worldH), mat);
  }
  get pxWidth(): number { return this.#canvas.width; }
  get pxHeight(): number { return this.#canvas.height; }
  paint(draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void): void {
    const ctx = this.#canvas.getContext("2d")!;
    ctx.clearRect(0, 0, this.#canvas.width, this.#canvas.height);
    draw(ctx, this.#canvas.width, this.#canvas.height);
    this.texture.needsUpdate = true;
  }
  dispose(): void {
    this.texture.dispose();
    (this.mesh.material as THREE.Material).dispose();
    this.mesh.geometry.dispose();
  }
}

function panel(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  ctx.fillStyle = PANEL;
  ctx.globalAlpha = 0.92;
  ctx.beginPath();
  ctx.roundRect(1, 1, w - 2, h - 2, 18);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#3d3427";
  ctx.lineWidth = 1.5;
  ctx.stroke();
  // Hairline brass rule at the top edge, the pedestal rim echoed.
  const grad = ctx.createLinearGradient(w * 0.2, 0, w * 0.8, 0);
  grad.addColorStop(0, "rgba(201,149,74,0)");
  grad.addColorStop(0.5, ACCENT);
  grad.addColorStop(1, "rgba(201,149,74,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(w * 0.2, 1, w * 0.6, 1.5);
}

// --- checklist layout -------------------------------------------------------
// The layout is a pure function so the director can hit-test pointer events
// against the SAME row positions the painter draws, and so tests can cover it
// without a canvas. Painter and hit-test must never compute geometry twice.

export interface ChecklistRow { id: string; href?: string; y0: number; y1: number }
interface ChecklistEntry {
  kind: "phase" | "item";
  y: number;
  title?: string;
  item?: ChecklistItem;
  detailLines?: string[];
}

export function layoutChecklist(phases: Phase[]): { entries: ChecklistEntry[]; rows: ChecklistRow[] } {
  const entries: ChecklistEntry[] = [];
  const rows: ChecklistRow[] = [];
  let y = 52;
  for (const phase of phases) {
    entries.push({ kind: "phase", y, title: phase.title });
    y += 30;
    for (const item of phase.items) {
      const detailLines = item.detail && item.state === "error" ? wrapText(item.detail, 52) : [];
      entries.push({ kind: "item", y, item, detailLines });
      rows.push({ id: item.id, href: item.href, y0: y - 20, y1: y + 8 });
      y += 26 + detailLines.length * 19;
    }
    y += 14;
  }
  return { entries, rows };
}

/** The row under a canvas-space point, or null. x only needs to be on the card body. */
export function checklistRowAt(rows: ChecklistRow[], xPx: number, yPx: number, cardWidth: number): ChecklistRow | null {
  if (xPx < 16 || xPx > cardWidth - 16) return null;
  return rows.find((r) => yPx >= r.y0 && yPx <= r.y1) ?? null;
}

export function paintChecklist(card: CanvasCard, phases: Phase[], hoverId: string | null = null): void {
  const { entries } = layoutChecklist(phases);
  card.paint((ctx, w, h) => {
    panel(ctx, w, h);
    for (const e of entries) {
      if (e.kind === "phase") {
        ctx.fillStyle = ACCENT;
        kicker(ctx, 15);
        ctx.fillText(e.title!.toUpperCase(), 28, e.y);
        resetTracking(ctx);
        continue;
      }
      const item = e.item!;
      const hovered = hoverId !== null && item.id === hoverId;
      if (hovered) {
        ctx.fillStyle = "#221b13";
        ctx.beginPath();
        ctx.roundRect(20, e.y - 20, w - 40, 28, 8);
        ctx.fill();
      }
      ctx.font = `20px $${SANS}`;
      ctx.fillStyle = STATE_COLOR[item.state];
      ctx.fillText(item.state === "done" ? "✓" : item.state === "error" ? "✗" : item.state === "doing" ? "◌" : "·", 28, e.y);
      ctx.fillStyle = hovered ? ACCENT_BRIGHT : item.state === "done" ? MUTED : INK;
      ctx.fillText(item.label, 54, e.y);
      if (item.href) {
        // A quiet affordance: linked rows carry a small arrow, brighter on hover.
        ctx.fillStyle = hovered ? ACCENT : "#6f6353";
        ctx.fillText("→", w - 44, e.y);
      }
      if (e.detailLines!.length) {
        ctx.fillStyle = STATE_COLOR.error;
        ctx.font = `15px ${SANS}`;
        let dy = e.y + 19;
        for (const line of e.detailLines!) { ctx.fillText(line, 54, dy); dy += 19; }
      }
    }
  });
}

export function paintAnnotation(card: CanvasCard, a: { label: string; blurb: string }): void {
  card.paint((ctx, w, h) => {
    panel(ctx, w, h);
    ctx.fillStyle = ACCENT_BRIGHT;
    ctx.font = `600 27px ${SERIF}`;
    ctx.fillText(a.label, 24, 44);
    ctx.fillStyle = INK;
    ctx.font = `18px ${SANS}`;
    let y = 76;
    for (const line of wrapText(a.blurb, 34)) { ctx.fillText(line, 24, y); y += 24; }
  });
}

export function paintStats(card: CanvasCard, lore: MonsterLore): void {
  card.paint((ctx, w, h) => {
    panel(ctx, w, h);
    ctx.fillStyle = INK;
    ctx.font = `600 34px ${SERIF}`;
    ctx.fillText(lore.name, 28, 54);
    ctx.fillStyle = ACCENT_BRIGHT;
    ctx.font = `italic 21px ${SERIF}`;
    ctx.fillText(lore.epithet, 28, 82);
    ctx.fillStyle = MUTED;
    kicker(ctx, 12);
    ctx.fillText(`ELEMENT · ${lore.element.toUpperCase()}`, 28, 108);
    resetTracking(ctx);
    let y = 142;
    ctx.font = `17px ${SANS}`;
    for (const [k, v] of Object.entries(lore.stats)) {
      ctx.fillStyle = INK;
      ctx.fillText(k, 28, y);
      ctx.fillStyle = "#241d14";
      ctx.fillRect(130, y - 12, 200, 12);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(130, y - 12, 20 * (v as number), 12);
      y += 28;
    }
    ctx.fillStyle = MUTED;
    ctx.font = `italic 17px ${SERIF}`;
    y += 10;
    for (const line of wrapText(lore.lore, 46)) { ctx.fillText(line, 28, y); y += 21; }
  });
}

export function paintConcept(card: CanvasCard, opts: { imageBitmap: ImageBitmap | null; prompt: string; rerolls: number }): void {
  card.paint((ctx, w, h) => {
    panel(ctx, w, h);
    if (opts.imageBitmap) ctx.drawImage(opts.imageBitmap, 24, 24, w - 48, w - 48);
    ctx.fillStyle = INK;
    ctx.font = `italic 18px ${SERIF}`;
    let y = w;
    for (const line of wrapText(opts.prompt, 44)) { ctx.fillText(line, 24, y); y += 22; }
    if (opts.rerolls > 1) {
      ctx.fillStyle = MUTED;
      kicker(ctx, 11);
      ctx.fillText(`TAKE ${opts.rerolls}`, 24, h - 20);
      resetTracking(ctx);
    }
  });
}

export function paintMessage(card: CanvasCard, opts: { title: string; body: string }): void {
  card.paint((ctx, w, h) => {
    panel(ctx, w, h);
    ctx.fillStyle = ACCENT_BRIGHT;
    ctx.font = `600 26px ${SERIF}`;
    ctx.fillText(opts.title, 24, 46);
    ctx.fillStyle = INK;
    ctx.font = `17px ${SANS}`;
    let y = 82;
    for (const line of wrapText(opts.body, 42)) { ctx.fillText(line, 24, y); y += 24; }
  });
}
