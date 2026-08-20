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

// Miris brand (miris.com): cool near-black, white ink, Geist + Geist Mono,
// vermilion #ff3500 spent only on live activity and attention.
const INK = "#ffffff";
const PANEL = "#111215";
const ACCENT = "#ff3500";
const MUTED = "#9e9d9f";
const DIM = "#55565b";
const LINE = "#26272c";
const STATE_COLOR = { todo: DIM, doing: ACCENT, done: "#6da583", error: ACCENT } as const;
const SANS = '"Geist", system-ui, sans-serif';
const MONO = '"Geist Mono", ui-monospace, Menlo, monospace';

/** Tracked uppercase mono, the brand's eyebrow register (miris.com section
 * labels). Canvas letterSpacing is Chromium 99+; elsewhere it renders
 * untracked, which is fine. */
function kicker(ctx: CanvasRenderingContext2D, px: number): void {
  ctx.font = `500 ${px}px ${MONO}`;
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
  ctx.roundRect(1, 1, w - 2, h - 2, 12);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1.5;
  ctx.stroke();
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
        ctx.fillStyle = MUTED;
        kicker(ctx, 14);
        ctx.fillText(e.title!.toUpperCase(), 28, e.y);
        resetTracking(ctx);
        continue;
      }
      const item = e.item!;
      const hovered = hoverId !== null && item.id === hoverId;
      if (hovered) {
        ctx.fillStyle = "#1a1b1f";
        ctx.beginPath();
        ctx.roundRect(20, e.y - 20, w - 40, 28, 8);
        ctx.fill();
      }
      ctx.font = `20px $${SANS}`;
      ctx.fillStyle = STATE_COLOR[item.state];
      ctx.fillText(item.state === "done" ? "✓" : item.state === "error" ? "✗" : item.state === "doing" ? "◌" : "·", 28, e.y);
      ctx.fillStyle = hovered ? INK : item.state === "done" ? "#828386" : INK;
      ctx.fillText(item.label, 54, e.y);
      if (item.href) {
        // A quiet affordance: linked rows carry a small arrow, brighter on hover.
        ctx.fillStyle = hovered ? ACCENT : DIM;
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
    ctx.fillStyle = INK;
    ctx.font = `600 22px ${SANS}`;
    ctx.fillText(a.label, 24, 42);
    ctx.fillStyle = MUTED;
    ctx.font = `17px ${SANS}`;
    let y = 76;
    for (const line of wrapText(a.blurb, 34)) { ctx.fillText(line, 24, y); y += 24; }
  });
}

export function paintStats(card: CanvasCard, lore: MonsterLore): void {
  card.paint((ctx, w, h) => {
    panel(ctx, w, h);
    ctx.fillStyle = INK;
    ctx.font = `600 32px ${SANS}`;
    ctx.fillText(lore.name, 28, 54);
    ctx.fillStyle = MUTED;
    ctx.font = `italic 400 19px ${SANS}`;
    ctx.fillText(lore.epithet, 28, 82);
    ctx.fillStyle = ACCENT;
    kicker(ctx, 12);
    ctx.fillText(`ELEMENT / ${lore.element.toUpperCase()}`, 28, 110);
    resetTracking(ctx);
    let y = 144;
    ctx.font = `16px ${SANS}`;
    for (const [k, v] of Object.entries(lore.stats)) {
      ctx.fillStyle = MUTED;
      ctx.fillText(k, 28, y);
      ctx.fillStyle = "#1a1b1f";
      ctx.fillRect(130, y - 11, 200, 10);
      ctx.fillStyle = INK;
      ctx.fillRect(130, y - 11, 20 * (v as number), 10);
      y += 28;
    }
    ctx.fillStyle = MUTED;
    ctx.font = `400 16px ${SANS}`;
    y += 10;
    for (const line of wrapText(lore.lore, 46)) { ctx.fillText(line, 28, y); y += 21; }
  });
}

export function paintConcept(card: CanvasCard, opts: { imageBitmap: ImageBitmap | null; prompt: string; rerolls: number }): void {
  card.paint((ctx, w, h) => {
    panel(ctx, w, h);
    if (opts.imageBitmap) ctx.drawImage(opts.imageBitmap, 24, 24, w - 48, w - 48);
    ctx.fillStyle = MUTED;
    ctx.font = `italic 400 17px ${SANS}`;
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
    ctx.fillStyle = INK;
    ctx.font = `600 22px ${SANS}`;
    ctx.fillText(opts.title, 24, 44);
    ctx.fillStyle = MUTED;
    ctx.font = `16px ${SANS}`;
    let y = 82;
    for (const line of wrapText(opts.body, 42)) { ctx.fillText(line, 24, y); y += 24; }
  });
}
