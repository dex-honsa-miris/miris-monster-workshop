// The annotation card as a real HTML template -- the single source for both
// render paths. When the browser implements the WICG html-in-canvas API
// (chrome://flags/#canvas-draw-element), CanvasCard rasterizes this live
// element straight into the card texture with drawElementImage; otherwise the
// painted-canvas fallback in cards.ts draws the same content.
//
// Annotations are the one card that genuinely lives in world space, anchored
// to a point on the monster, so this is where html-in-canvas earns its keep.
// The screen-pinned panels are ordinary DOM in src/app/panels.tsx.
//
// The label and blurb are model-written and untrusted: both go through esc().

import type { MonsterLore } from "../../server/lore-schema";

export function esc(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Miris tokens, kept in lockstep with cards.ts and style.css.
const CARD_CSS = `
  .card {
    box-sizing: border-box; position: relative; width: 100%; height: 100%;
    background: rgba(17, 18, 21, 0.92);
    border: 1.5px solid #26272c; border-radius: 12px;
    color: #ffffff; font-family: "Geist", system-ui, sans-serif;
    overflow: hidden;
  }
  .card * { box-sizing: border-box; margin: 0; }
`;

const shell = (body: string): string => `<style>${CARD_CSS}</style><div class="card">${body}</div>`;

export function annotationMarkup(a: { label: string; blurb: string }): string {
  return shell(
    `<div style="padding:20px 24px">` +
      `<div style="font:600 26px 'Geist',system-ui,sans-serif">${esc(a.label)}</div>` +
      `<div style="font:20px 'Geist',system-ui,sans-serif;color:#9e9d9f;margin-top:8px;line-height:1.35">${esc(a.blurb)}</div>` +
    `</div>`,
  );
}

/** The stats card, used ONLY by the standalone published viewer
 * (viewer/stage.ts), which is a pure 3D page with no DOM chrome of its own.
 * The workshop app renders the same information as real DOM in
 * src/app/panels.tsx. */
export function statsMarkup(lore: MonsterLore, iconUrl: string | null = null): string {
  const bars = Object.entries(lore.stats)
    .map(
      ([k, v]) =>
        `<div style="display:flex;align-items:center;gap:14px;margin-top:12px">` +
          `<span style="width:90px;font:19px 'Geist',system-ui,sans-serif;color:#9e9d9f">${esc(k)}</span>` +
          `<span style="flex:1;height:10px;background:#1a1b1f;border-radius:2px;overflow:hidden">` +
            `<span style="display:block;height:100%;background:#ffffff;width:${(v as number) * 10}%"></span>` +
          `</span>` +
        `</div>`,
    )
    .join("");
  const abilities = lore.abilities
    .map(
      (a) =>
        `<div style="margin-top:8px"><span style="font:600 18px 'Geist',system-ui,sans-serif;color:#ffffff">${esc(a.name)}</span>` +
        `<span style="font:17px 'Geist',system-ui,sans-serif;color:#9e9d9f"> \u00b7 ${esc(a.blurb)}</span></div>`,
    )
    .join("");
  const icon = iconUrl
    ? `<img src="${esc(iconUrl)}" style="position:absolute;top:22px;right:24px;width:64px;height:64px;border-radius:8px;border:1px solid #26272c" />`
    : "";
  return shell(
    `<div style="padding:24px 28px">${icon}` +
      `<div style="font:600 38px 'Geist',system-ui,sans-serif">${esc(lore.name)}</div>` +
      `<div style="font:italic 400 23px 'Geist',system-ui,sans-serif;color:#9e9d9f;margin-top:4px">${esc(lore.epithet)}</div>` +
      `<div style="font:500 14px 'Geist Mono',ui-monospace,monospace;letter-spacing:3.4px;text-transform:uppercase;color:#ff3500;margin-top:16px">ELEMENT / ${esc(lore.element.toUpperCase())}</div>` +
      `<div style="margin-top:10px">${bars}</div>` +
      `<div style="font:500 11px 'Geist Mono',ui-monospace,monospace;letter-spacing:3.4px;text-transform:uppercase;color:#9e9d9f;margin-top:16px">ABILITIES</div>${abilities}` +
      `<div style="font:400 18px 'Geist',system-ui,sans-serif;color:#9e9d9f;margin-top:14px;line-height:1.4">${esc(lore.lore)}</div>` +
    `</div>`,
  );
}
