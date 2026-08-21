// Card content as real HTML templates -- the single source for both render
// paths. When the browser implements the WICG html-in-canvas API
// (chrome://flags/#canvas-draw-element), CanvasCard rasterizes these live
// elements straight into the card texture with drawElementImage; otherwise
// the painted-canvas fallback in cards.ts draws the same content.
//
// GEOMETRY CONTRACT: the checklist template positions every row absolutely at
// the y coordinates layoutChecklist computes, so raycast hit-testing (which
// reads that same layout) is correct on BOTH render paths by construction.
//
// Everything interpolated here is untrusted (attendee prompts, AI lore):
// it all goes through esc().
import type { MonsterLore } from "../../server/lore-schema";
import type { Phase } from "../app/checklist-model";
import { layoutChecklist } from "./cards";

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
  .eyebrow {
    font: 500 14px "Geist Mono", ui-monospace, monospace;
    letter-spacing: 3px; text-transform: uppercase; color: #9e9d9f;
  }
  .row { position: absolute; left: 28px; right: 20px; display: flex; gap: 12px; align-items: baseline; font: 20px "Geist", system-ui, sans-serif; }
  .row.hover { background: #1a1b1f; border-radius: 8px; margin: -4px -8px; padding: 4px 8px; }
  .row .icon { width: 14px; }
  .row .arrow { margin-left: auto; color: #55565b; }
  .row.hover .arrow { color: #ff3500; }
  .row .label { color: #ffffff; }
  .state-done .label { color: #828386; }
  .state-done .icon { color: #6da583; }
  .state-doing .icon { color: #ff3500; }
  .state-error .icon { color: #ff3500; }
  .state-todo .icon { color: #55565b; }
  .detail { position: absolute; left: 54px; right: 20px; font: 15px "Geist", system-ui, sans-serif; color: #ff3500; }
  .phase-title { position: absolute; left: 28px; }
`;

const shell = (body: string): string => `<style>${CARD_CSS}</style><div class="card">${body}</div>`;

const ICON = { done: "✓", error: "✗", doing: "◌", todo: "·" } as const;

export function checklistMarkup(phases: Phase[], hoverId: string | null): string {
  const { entries } = layoutChecklist(phases);
  const parts: string[] = [];
  for (const e of entries) {
    if (e.kind === "phase") {
      // The painter draws text baselines; HTML positions boxes. top = baseline - ascent-ish.
      parts.push(`<div class="eyebrow phase-title" style="top:${e.y - 15}px">${esc(e.title!)}</div>`);
      continue;
    }
    const item = e.item!;
    const hovered = hoverId !== null && item.id === hoverId;
    parts.push(
      `<div class="row state-${item.state}${hovered ? " hover" : ""}" style="top:${e.y - 20}px">` +
        `<span class="icon">${ICON[item.state]}</span>` +
        `<span class="label">${esc(item.label)}</span>` +
        (item.href ? `<span class="arrow">→</span>` : "") +
      `</div>`,
    );
    if (e.detailLines!.length) {
      parts.push(`<div class="detail" style="top:${e.y + 6}px">${esc(item.detail ?? "")}</div>`);
    }
  }
  return shell(parts.join(""));
}

export function annotationMarkup(a: { label: string; blurb: string }): string {
  return shell(
    `<div style="padding:20px 24px">` +
      `<div style="font:600 22px 'Geist',system-ui,sans-serif">${esc(a.label)}</div>` +
      `<div style="font:17px 'Geist',system-ui,sans-serif;color:#9e9d9f;margin-top:8px;line-height:1.35">${esc(a.blurb)}</div>` +
    `</div>`,
  );
}

export function statsMarkup(lore: MonsterLore, iconUrl: string | null = null): string {
  const bars = Object.entries(lore.stats)
    .map(
      ([k, v]) =>
        `<div style="display:flex;align-items:center;gap:14px;margin-top:12px">` +
          `<span style="width:90px;font:16px 'Geist',system-ui,sans-serif;color:#9e9d9f">${esc(k)}</span>` +
          `<span style="flex:1;height:10px;background:#1a1b1f;border-radius:2px;overflow:hidden">` +
            `<span style="display:block;height:100%;background:#ffffff;width:${(v as number) * 10}%"></span>` +
          `</span>` +
        `</div>`,
    )
    .join("");
  const abilities = lore.abilities
    .map(
      (a) =>
        `<div style="margin-top:8px"><span style="font:600 15px 'Geist',system-ui,sans-serif;color:#ffffff">${esc(a.name)}</span>` +
        `<span style="font:14px 'Geist',system-ui,sans-serif;color:#9e9d9f"> · ${esc(a.blurb)}</span></div>`,
    )
    .join("");
  const icon = iconUrl
    ? `<img src="${esc(iconUrl)}" style="position:absolute;top:22px;right:24px;width:64px;height:64px;border-radius:8px;border:1px solid #26272c" />`
    : "";
  return shell(
    `<div style="padding:24px 28px">${icon}` +
      `<div style="font:600 32px 'Geist',system-ui,sans-serif">${esc(lore.name)}</div>` +
      `<div style="font:italic 400 19px 'Geist',system-ui,sans-serif;color:#9e9d9f;margin-top:4px">${esc(lore.epithet)}</div>` +
      `<div class="eyebrow" style="font-size:12px;color:#ff3500;margin-top:16px">ELEMENT / ${esc(lore.element.toUpperCase())}</div>` +
      `<div style="margin-top:10px">${bars}</div>` +
      `<div class="eyebrow" style="font-size:11px;margin-top:16px">ABILITIES</div>${abilities}` +
      `<div style="font:400 15px 'Geist',system-ui,sans-serif;color:#9e9d9f;margin-top:14px;line-height:1.4">${esc(lore.lore)}</div>` +
    `</div>`,
  );
}

export function conceptMarkup(opts: { imageUrl: string | null; prompt: string; rerolls: number }): string {
  const img = opts.imageUrl
    ? `<img src="${esc(opts.imageUrl)}" crossorigin="anonymous" style="display:block;width:100%;aspect-ratio:1;object-fit:cover;border-radius:8px" />`
    : "";
  const take = opts.rerolls > 1 ? `<div class="eyebrow" style="font-size:11px;margin-top:10px">TAKE ${opts.rerolls}</div>` : "";
  return shell(
    `<div style="padding:24px">${img}` +
      `<div style="font:italic 400 17px 'Geist',system-ui,sans-serif;color:#9e9d9f;margin-top:14px;line-height:1.4">${esc(opts.prompt)}</div>` +
      take +
    `</div>`,
  );
}

export function messageMarkup(opts: { title: string; body: string }): string {
  return shell(
    `<div style="padding:22px 24px">` +
      `<div style="font:600 22px 'Geist',system-ui,sans-serif">${esc(opts.title)}</div>` +
      `<div style="font:16px 'Geist',system-ui,sans-serif;color:#9e9d9f;margin-top:10px;line-height:1.45">${esc(opts.body)}</div>` +
    `</div>`,
  );
}
