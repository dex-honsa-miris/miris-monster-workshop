export const MONSTER_ELEMENTS = ["ember", "tide", "bloom", "storm", "umbra", "chime"] as const;

export function sanitizeUserPrompt(raw: string): string {
  return raw
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/ignore\s+previous[^.]*/gi, " ")
    .replace(/\b(system|assistant)\s*:/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

// The bible optimises for image-to-3D reconstruction: rich MATTE surface
// detail. Detail lives in the diffuse texture (scales, fur, skin), which is
// exactly what survives into Meshy's base-color map -- while gloss, wetness
// and transparency are lighting effects the reconstructor misreads as
// geometry or bakes in as frozen highlights. The earlier cel-shaded bible
// failed for the opposite reason: flat two-tone color fields carry no
// surface information at all, and the models came back smooth and blobby.
const ART_BIBLE =
  "highly detailed fantasy creature design for a monster-taming video game, collectible game asset. " +
  "Photorealistic rendering with rich matte surface detail: individual scales, fur strands, " +
  "skin folds and texture visible up close, sculpted anatomy, crisp material definition. " +
  "Strictly matte, completely diffuse surfaces throughout, like unvarnished painted resin. " +
  "Chunky readable silhouette, friendly-with-an-edge character design. Single full-body " +
  "creature, centered, three-quarter view, in a grounded standing pose: all feet planted flat " +
  "and level at the bottom of the frame, weight settled as if on solid ground -- but the " +
  "ground itself is invisible, a seamless uniform backdrop with no floor line, no disc, no " +
  "pedestal, no base, no shadow beneath it. Clean light gray studio background, flat even " +
  "diffuse lighting, no cast shadows, no scenery.";

const NEGATIVE =
  "glossy, shiny, wet look, slimy, chrome, metallic sheen, specular hotspots, reflections, " +
  "transparency, translucent, glass, iridescent, lens flare, rim light, dramatic shadows, " +
  "detailed background, scenery, ground plane, floor, pedestal, base, platform, disc, " +
  "text, watermark, human, multiple creatures";

export function buildConceptPrompt(userText: string): { prompt: string; negativePrompt: string } {
  const cleaned = sanitizeUserPrompt(userText);
  return {
    prompt: `${ART_BIBLE} The creature: ${cleaned}.`,
    negativePrompt: NEGATIVE,
  };
}

/** Emblem/icon prompt: a flat game badge for the monster. */
export function buildIconPrompt(userText: string): string {
  const cleaned = sanitizeUserPrompt(userText);
  return (
    `flat game emblem icon representing ${cleaned}: bold simple shape, two flat colors ` +
    `plus a dark outline, matte, centered on a plain solid background, no text, ` +
    `sticker-like video game ability icon`
  );
}
