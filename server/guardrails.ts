export const MONSTER_ELEMENTS = ["ember", "tide", "bloom", "storm", "umbra", "chime"] as const;

export function sanitizeUserPrompt(raw: string): string {
  return raw
    .replace(/https?:\/\/\S+/gi, " ")
    .replace(/ignore previous[^.]*/gi, " ")
    .replace(/\b(system|assistant)\s*:/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

const ART_BIBLE =
  "Collectible monster concept art for the Miris monster world. " +
  "single full-body creature, centered, facing slightly left, standing on a plain disc, " +
  "soft studio glow, dark backdrop, rich saturated accent colors on a muted body palette, " +
  "chunky silhouette, friendly-with-an-edge character design, matte painterly finish, " +
  "high detail, no scenery.";

const NEGATIVE =
  "photorealistic human, text, watermark, logo, multiple creatures, cropped body, " +
  "busy background, weapons pointed at viewer, gore";

export function buildConceptPrompt(userText: string): { prompt: string; negativePrompt: string } {
  const cleaned = sanitizeUserPrompt(userText);
  return {
    prompt: `${ART_BIBLE} The creature: ${cleaned}.`,
    negativePrompt: NEGATIVE,
  };
}
