# fal workflow build sheets

Two public workflows on the Miris fal account power the pipeline. Until they
exist, the app runs the SAME chains as direct model calls (the prompts below
live in server/guardrails.ts and were validated live on 2026-08-21), so
building these is transcription, not design. Set the ids in .env as
FAL_SKETCH_WORKFLOW and FAL_MANIFEST_WORKFLOW once published, and hardcode
them as the defaults in server/api.ts before the event.

## Workflow 1: monster-sketch (runs per reroll, must stay cheap)

Input: `prompt` (string, the attendee's sentence; the app sanitizes it first)

Node: text-to-image, fal-ai/flux/schnell, image_size square_hd, 1 image,
safety checker on. Prompt template (verbatim from guardrails.ts ART_BIBLE):

    stylized fantasy creature design for a monster-taming video game,
    collectible game asset. Clean bold shapes, chunky readable silhouette,
    cel-shaded with soft matte textures, flat colors with simple two-tone
    shading, minimal specular highlights, matte finish, friendly-with-an-edge
    character design. Single full-body creature, centered, three-quarter
    view, standing on a plain pale disc, clean light gray studio background,
    no scenery, high quality game concept art. The creature: {{prompt}}.

Negative prompt:

    photorealistic, glossy, shiny, wet look, chrome, metallic sheen,
    specular hotspots, lens flare, detailed background, scenery, text,
    watermark, human, multiple creatures

Output mapping the app accepts: `image_url` (preferred), or `image.url`, or
`images[0].url`.

## Workflow 2: monster-manifest (runs once, at approve)

Inputs: `prompt` (string), `image_url` (the approved sketch)

Three parallel branches:

1. 3D: image-to-3D, fal-ai/trellis, input image_url. Output -> `model_url`
   (the app also accepts `model_mesh.url` or `model.url`).
2. Lore: LLM, fal-ai/any-llm, model google/gemini-flash-1.5.
   System prompt: copy LORE_SYSTEM_PROMPT from server/guardrails.ts verbatim
   (it demands raw JSON with name/epithet/lore/element/stats/abilities/
   annotations; the app strips accidental markdown fences and validates
   against its schema, degrading to a Retry state on mismatch).
   User prompt template:
       The monster was summoned from this description: "{{prompt}}"
   Output -> `lore` (JSON object or the raw text; both accepted).
3. Icon: text-to-image, fal-ai/flux/schnell, image_size square. Prompt
   template (buildIconPrompt in guardrails.ts):
       flat game emblem icon representing {{prompt}}: bold simple shape,
       two flat colors plus a dark outline, matte, centered on a plain solid
       background, no text, sticker-like video game ability icon
   Output -> `icon_url` (optional; the app treats a missing icon as fine).

Final output object: { "model_url", "lore", "icon_url" }.

## Contract tests

The parsers live in server/fal.ts (parseSketchOutput, parseManifestOutput)
with unit tests in test/fal.test.ts. If the editor forces a different output
shape, extend the parser and its tests in the same commit; nothing else in
the app knows these shapes.

## Cost per attendee (direct-path measurements, 2026-08-21)

Sketch: ~$0.003/reroll (schnell). Manifest: one trellis run + one
gemini-flash call + one schnell icon. Rerolls are the only repeated spend.
