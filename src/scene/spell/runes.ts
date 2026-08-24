// Procedural glyph strip + magic-circle textures. Drawn to a canvas once at
// construction so the effect ships with no image assets and any hue can be
// tinted in the shader (the textures are white-on-black masks).
import * as THREE from "three";

/** Deterministic RNG so a given seed always draws the same alphabet. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * One glyph: 2-5 strokes on a small grid, mixing straight segments, arcs and
 * dots. Real runic alphabets read as angular strokes with occasional round
 * accents, and that is enough at the size these are seen.
 */
function drawGlyph(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, rand: () => number): void {
  const strokes = 2 + Math.floor(rand() * 4);
  ctx.lineWidth = Math.max(1.2, h * 0.075);
  ctx.lineCap = "round";
  for (let i = 0; i < strokes; i++) {
    const kind = rand();
    ctx.beginPath();
    if (kind < 0.62) {
      // Straight stroke snapped to a 3x3 lattice: gives glyphs a family look.
      const gx = () => x + w * (0.22 + Math.round(rand() * 2) * 0.28);
      const gy = () => y + h * (0.18 + Math.round(rand() * 2) * 0.32);
      ctx.moveTo(gx(), gy());
      ctx.lineTo(gx(), gy());
    } else if (kind < 0.88) {
      const cx = x + w * (0.35 + rand() * 0.3);
      const cy = y + h * (0.35 + rand() * 0.3);
      const r = h * (0.12 + rand() * 0.16);
      const a0 = rand() * Math.PI * 2;
      ctx.arc(cx, cy, r, a0, a0 + Math.PI * (0.6 + rand() * 1.2));
    } else {
      const cx = x + w * (0.3 + rand() * 0.4);
      const cy = y + h * (0.3 + rand() * 0.4);
      ctx.arc(cx, cy, Math.max(1, h * 0.045), 0, Math.PI * 2);
      ctx.fillStyle = "#fff";
      ctx.fill();
      continue;
    }
    ctx.stroke();
  }
}

/** A long horizontal strip of glyphs, tiling seamlessly in U. */
export function makeRuneStrip(seed = 7, glyphs = 48): THREE.CanvasTexture {
  const cellW = 64;
  const c = document.createElement("canvas");
  c.width = cellW * glyphs;
  c.height = 96;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, c.width, c.height);
  ctx.strokeStyle = "#fff";
  const rand = rng(seed);
  for (let i = 0; i < glyphs; i++) {
    drawGlyph(ctx, i * cellW + cellW * 0.16, c.height * 0.2, cellW * 0.68, c.height * 0.6, rand);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = THREE.RepeatWrapping;
  tex.wrapT = THREE.ClampToEdgeWrapping;
  tex.anisotropy = 4;
  return tex;
}

/**
 * The floor sigil: concentric rules, a tick ring, a glyph ring and a
 * compass rosette. One texture serves both the base circle and the smaller
 * mid-height rosette (sampled at a different radius).
 */
export function makeSigil(seed = 3, size = 1024): THREE.CanvasTexture {
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const R = size / 2;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, size, size);
  ctx.translate(R, R);
  ctx.strokeStyle = "#fff";
  ctx.fillStyle = "#fff";
  const rand = rng(seed);

  const ring = (r: number, w: number) => {
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
  };

  ring(R * 0.97, 3);
  ring(R * 0.93, 1.5);
  ring(R * 0.7, 2);
  ring(R * 0.66, 1);
  ring(R * 0.34, 1.5);
  ring(R * 0.3, 1);

  // Tick marks between the outer rules.
  ctx.lineWidth = 2;
  for (let i = 0; i < 120; i++) {
    const a = (i / 120) * Math.PI * 2;
    const inner = i % 5 === 0 ? R * 0.86 : R * 0.9;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * inner, Math.sin(a) * inner);
    ctx.lineTo(Math.cos(a) * R * 0.93, Math.sin(a) * R * 0.93);
    ctx.stroke();
  }

  // Glyph ring between the middle rules.
  const glyphR = R * 0.78;
  const count = 32;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    ctx.save();
    ctx.rotate(a);
    ctx.translate(0, -glyphR);
    ctx.rotate(Math.PI);
    drawGlyph(ctx, -R * 0.035, -R * 0.045, R * 0.07, R * 0.09, rand);
    ctx.restore();
  }

  // Compass rosette: long spokes plus an interlocking star polygon.
  ctx.lineWidth = 1.6;
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    const len = i % 4 === 0 ? R * 0.66 : R * 0.5;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * len, Math.sin(a) * len);
    ctx.stroke();
  }
  const star = (points: number, step: number, r: number) => {
    ctx.beginPath();
    for (let i = 0; i <= points; i++) {
      const a = ((i * step) / points) * Math.PI * 2 - Math.PI / 2;
      const x = Math.cos(a) * r;
      const y = Math.sin(a) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  };
  ctx.lineWidth = 2;
  star(7, 3, R * 0.3);
  star(5, 2, R * 0.22);
  ring(R * 0.1, 2);

  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 4;
  return tex;
}
