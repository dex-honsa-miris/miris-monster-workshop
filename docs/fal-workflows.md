# fal workflow build sheets

**BUILT AND VERIFIED 2026-08-21.** Both workflows are live and public on the
Miris fal account, pinned as defaults in server/fal.ts:

- `workflows/dexhonsa/miris-monster-sketch` - LLM prompt-shaper -> **openai/gpt-image-2**
- `workflows/dexhonsa/miris-monster-manifest` - **meshy/v7/image-to-3d** + lore LLM + icon (gpt-image-2)

Model choices (owner, 2026-08-21): gpt-image-2 for all image generation;
Meshy v7 for 3D with game-asset settings: `model_type: standard`,
`topology: quad`, `target_polycount: 24000`, `should_remesh: true`,
`enable_pbr: FALSE` (no metallic/roughness maps, which keeps monsters matte
per the no-shiny-attributes rule), and `texture_prompt` fed the attendee's own
words. Measured output: single mesh, one material, metallic 0.0 / roughness
0.8, ~4MB GLB, ~145s. Meshy's output field is `model_glb.url` (Trellis used
`model_mesh.url`); the app's parser accepts both.

Their exact graphs are versioned in `workflows/*.json` (fetched from the API,
re-postable with PATCH). What follows documents the format and the hard-won
rules, since the workflow API is alpha and undocumented.

## The reference syntax (discovered empirically)

Node inputs and workflow outputs reference values with `$` paths:

- workflow input: `$input.prompt`
- another node's output: `$nodeId.output`, `$nodeId.images.0.url`, `$nodeId.model_mesh.url`

**Only WHOLE-VALUE references resolve.** A reference embedded in a longer
string (`"...style text... $input.prompt ..."`) is passed through LITERALLY:
the run completes, the image looks stylish, and the attendee's actual idea is
silently missing (verified: "a bright red octopus in a purple top hat"
produced a generic leaf-beast). This is why the sketch workflow shapes its
prompt in an LLM node instead of string-concatenating: the style bible lives
in that node's STATIC `system_prompt`, and `prompt` is the whole-value
`$input.prompt`.

## API notes

- Base: `https://rest.alpha.fal.ai/workflows/` (needs an ADMIN key; run keys
  get 403). Create = POST, read = GET `/{nickname}/{name}`, update = **PATCH**
  (PUT and POST both 405), delete = DELETE.
- Body: `{ name, title, is_public, contents }`; `contents` =
  `{ name, version: "1", nodes, output, schema, metadata }`.
- Nodes: `{ type: "run" | "display", id, depends: [], app, input, metadata:
  { position } }`. The editor also keeps a `display` node whose `fields`
  mirror the workflow `output`.
- The API does NOT validate node inputs or references. A malformed graph
  saves happily and fails (or silently misbehaves) at run time, so always
  run a workflow after changing it.

## Workflow 1: miris-monster-sketch (runs per reroll)

As built: node `shape` (fal-ai/any-llm, gemini-flash-1.5) turns the
attendee's sentence into a full styled image prompt using the style bible as
its system prompt; node `node-...` (openai/gpt-image-2, square_hd) renders it.
Output: `{ image_url, styled_prompt }`.

Original build sheet (kept for reference and for anyone rebuilding by hand):

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

## Workflow 2: miris-monster-manifest (runs once, at approve)

As built, four run nodes: `model3d` (fal-ai/trellis on `$input.image_url`),
`lore` (any-llm on **anthropic/claude-haiku-4.5** with the lore system prompt on `$input.prompt`), `iconprompt`
(any-llm writing an emblem prompt) then `icon` (flux/schnell on
`$iconprompt.output`). Output: `{ model_url, lore, icon_url }`. The lore LLM
often wraps its JSON in markdown fences; the app's parser strips them.

Original build sheet:

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

## LLM choice (A/B, 2026-08-21)

The lore node runs **anthropic/claude-haiku-4.5**; the two utility legs
(prompt shaper, icon prompt) stay on **google/gemini-flash-1.5**.

Measured on identical prompts through fal-ai/any-llm:

| model | storm axolotl | teapot turtle | notes |
|---|---|---|---|
| gemini-flash-1.5 | "Axolotl the Sparktail", 2 abilities | "Tealot the Grumbling Brewer" | 2-3s, generic names |
| claude-haiku-4.5 | "Zephyrmite the Giggling Storm", 3 abilities | "Brewkettle the Grumbly Steeper" | 5s, sharper and funnier |
| gpt-5-mini | unparseable output | unparseable output | rejected |

The lore is the attendee's keepsake, so it gets the better model; the 3 extra
seconds hide inside the ~145s Meshy wait. The shaper runs on every reroll, so
it stays cheap. Both models fence their JSON in markdown, which the app's
parser strips.

## Click to annotate (vision, direct call not a workflow)

`POST /api/annotate` sends TWO data-URI images to `fal-ai/any-llm/vision`
(anthropic/claude-haiku-4.5): a closeup framed on the clicked point and a
full-body context shot. Data URIs work directly, so no upload step is needed.

Two failure modes found while building it (2026-08-21), both fixed and worth
knowing if the prompt is ever edited:

1. **Coordinate pointing does not work.** Telling the model "the player
   clicked x=0.5, y=0.30" produced disagreement between models on the same
   image ("head with vegetation" vs "back spikes"). The click is communicated
   by FRAMING instead: whatever fills the center of the closeup is the answer.
2. **Lore text overrides the image.** With the lore in the prompt, a closeup
   of the monster's FEET came back as "Stone Shield" because the lore
   mentioned a shield. The prompt now demands a `seen` field first (what the
   model literally observes), forbids naming anything not visible, and passes
   lore as identity and tone only, never as a feature list.

Model prose is normalized by `prose()` in server/lore-schema.ts: LLMs reach
for em dashes constantly and this copy renders straight into the UI.
