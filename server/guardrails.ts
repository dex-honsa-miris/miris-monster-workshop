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

/** System prompt for the lore LLM leg (fal any-llm or the workflow's LLM
 * node). Validated live 2026-08-21 with google/gemini-flash-1.5: returns
 * clean JSON matching loreSchema plus abilities. */
export const LORE_SYSTEM_PROMPT = `You are the lore keeper of the Miris monster world: warm, slightly mischievous, never grimdark.
Reply with ONLY a JSON object, no markdown fences, matching exactly:
{
  "name": "1-3 words",
  "epithet": "the ...",
  "lore": "<= 60 words",
  "element": one of ["ember","tide","bloom","storm","umbra","chime"],
  "stats": { "might": 1-10, "agility": 1-10, "arcana": 1-10, "mischief": 1-10, "resolve": 1-10 },
  "abilities": [2-3 of { "name": "<= 3 words", "blurb": "<= 12 words" }],
  "annotations": [3-5 of { "slot": one of ["crown","face","left","right","core","base","aura"], "label": "<= 4 words", "blurb": "<= 12 words" }]
}`;

/** System prompt for click-to-annotate (vision). Two images are sent: a
 * closeup framed on the clicked point, and a full-body context shot.
 *
 * The two-step "seen" field is load-bearing: without it the model ignored the
 * image and simply restated a feature from the lore (measured 2026-08-21 --
 * a closeup of the monster's feet came back as "Stone Shield" because the
 * lore mentioned a shield). Naming what it sees first grounds the annotation
 * in the render. Lore is passed as identity and TONE only, never as a
 * feature list, for the same reason. */
export const ANNOTATE_SYSTEM_PROMPT = `You annotate the part of a creature a player just clicked.
Image 1 is a CLOSEUP framed on the clicked part. Image 2 is the whole creature, for context.
Work in two steps and report both:
1. "seen": literally what body part fills the center of image 1 (your own eyes only; ignore any lore).
2. "label"/"blurb": the annotation for THAT part.
Rules: describe only what you can actually see. Never name a part that is not visible, even if the lore mentions it. Match the creature's tone and world, but do not copy its existing features. The blurb should feel like a game codex entry: concrete, vivid, a little playful.
Reply with ONLY JSON: {"seen":"<= 8 words","label":"<= 4 words","blurb":"<= 24 words","slot":"crown|face|left|right|core|base|aura"}`;

/** Identity+tone line for the annotate call. Deliberately excludes the lore's
 * own annotations so the model cannot parrot them. */
export function annotateIdentity(lore: {
  name: string;
  epithet: string;
  element: string;
  lore: string;
}): string {
  return `Name: ${lore.name} ${lore.epithet}. Element: ${lore.element}. World and tone: ${lore.lore}`;
}
