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

const INK = "#e8e2d6";
const PANEL = "#141018";
const ACCENT = "#c9954a";
const STATE_COLOR = { todo: "#5c5566", doing: ACCENT, done: "#7da06f", error: "#c96a4f" } as const;

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
  ctx.roundRect(0, 0, w, h, 18);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = ACCENT;
  ctx.lineWidth = 2;
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
        ctx.fillStyle = ACCENT;
        ctx.font = "600 22px system-ui";
        ctx.fillText(e.title!.toUpperCase(), 28, e.y);
        continue;
      }
      const item = e.item!;
      const hovered = hoverId !== null && item.id === hoverId;
      if (hovered) {
        ctx.fillStyle = "#241d2c";
        ctx.beginPath();
        ctx.roundRect(20, e.y - 20, w - 40, 28, 8);
        ctx.fill();
      }
      ctx.font = "20px system-ui";
      ctx.fillStyle = STATE_COLOR[item.state];
      ctx.fillText(item.state === "done" ? "✓" : item.state === "error" ? "✗" : item.state === "doing" ? "◌" : "·", 28, e.y);
      ctx.fillStyle = hovered ? "#f4efe4" : item.state === "done" ? "#8f8798" : INK;
      ctx.fillText(item.label, 54, e.y);
      if (item.href) {
        // A quiet affordance: linked rows carry a small arrow, brighter on hover.
        ctx.fillStyle = hovered ? ACCENT : "#5c5566";
        ctx.fillText("→", w - 44, e.y);
      }
      if (e.detailLines!.length) {
        ctx.fillStyle = STATE_COLOR.error;
        ctx.font = "15px system-ui";
        let dy = e.y + 19;
        for (const line of e.detailLines!) { ctx.fillText(line, 54, dy); dy += 19; }
      }
    }
  });
}

export function paintAnnotation(card: CanvasCard, a: { label: string; blurb: string }): void {
  card.paint((ctx, w, h) => {
    panel(ctx, w, h);
    ctx.fillStyle = ACCENT;
    ctx.font = "600 26px system-ui";
    ctx.fillText(a.label, 24, 44);
    ctx.fillStyle = INK;
    ctx.font = "19px system-ui";
    let y = 76;
    for (const line of wrapText(a.blurb, 34)) { ctx.fillText(line, 24, y); y += 24; }
  });
}

export function paintStats(card: CanvasCard, lore: MonsterLore): void {
  card.paint((ctx, w, h) => {
    panel(ctx, w, h);
    ctx.fillStyle = INK;
    ctx.font = "600 30px Georgia, serif";
    ctx.fillText(lore.name, 28, 52);
    ctx.fillStyle = ACCENT;
    ctx.font = "italic 20px Georgia, serif";
    ctx.fillText(lore.epithet, 28, 80);
    ctx.fillStyle = "#8f8798";
    ctx.font = "16px system-ui";
    ctx.fillText(`element · ${lore.element}`, 28, 106);
    let y = 140;
    ctx.font = "18px system-ui";
    for (const [k, v] of Object.entries(lore.stats)) {
      ctx.fillStyle = INK;
      ctx.fillText(k, 28, y);
      ctx.fillStyle = "#2a2433";
      ctx.fillRect(130, y - 12, 200, 12);
      ctx.fillStyle = ACCENT;
      ctx.fillRect(130, y - 12, 20 * (v as number), 12);
      y += 28;
    }
    ctx.fillStyle = INK;
    ctx.font = "16px Georgia, serif";
    y += 8;
    for (const line of wrapText(lore.lore, 46)) { ctx.fillText(line, 28, y); y += 21; }
  });
}

export function paintConcept(card: CanvasCard, opts: { imageBitmap: ImageBitmap | null; prompt: string; rerolls: number }): void {
  card.paint((ctx, w, h) => {
    panel(ctx, w, h);
    if (opts.imageBitmap) ctx.drawImage(opts.imageBitmap, 24, 24, w - 48, w - 48);
    ctx.fillStyle = INK;
    ctx.font = "17px system-ui";
    let y = w;
    for (const line of wrapText(opts.prompt, 44)) { ctx.fillText(line, 24, y); y += 22; }
    if (opts.rerolls > 1) {
      ctx.fillStyle = "#8f8798";
      ctx.fillText(`take ${opts.rerolls}`, 24, h - 20);
    }
  });
}

export function paintMessage(card: CanvasCard, opts: { title: string; body: string }): void {
  card.paint((ctx, w, h) => {
    panel(ctx, w, h);
    ctx.fillStyle = ACCENT;
    ctx.font = "600 24px system-ui";
    ctx.fillText(opts.title, 24, 46);
    ctx.fillStyle = INK;
    ctx.font = "18px system-ui";
    let y = 82;
    for (const line of wrapText(opts.body, 42)) { ctx.fillText(line, 24, y); y += 24; }
  });
}
