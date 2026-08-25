// The three creation paths, and everything that differs between them.
//
// One pair of fal workflows serves all paths: their LLM system prompts are
// whole-value $input refs (the kind that resolves; embedded refs pass through
// literally), and the server sends the path's prompts with every call. That
// keeps the path knowledge HERE -- versioned, testable, greppable -- instead
// of spread across three pairs of live workflow definitions.
//
// This module is imported by the browser too (for copy and spell colors), so
// it must stay free of node APIs.

export const PATH_IDS = ["monster", "product", "artifact"] as const;
export type PathId = (typeof PATH_IDS)[number];

export interface PathCopy {
  /** Selector chip label. */
  label: string;
  /** Prompt placeholder for the first creation and for the next one. */
  placeholder: string;
  placeholderAgain: string;
  sketchButton: string;
  sketchAgainButton: string;
  approveButton: string;
  /** Masthead kicker per phase. */
  kickerCreate: string;
  kickerSummoning: string;
  kickerReveal: string;
  summoningHint: string;
  /** Codex rail title. */
  codexTitle: string;
  discoverHint: string;
}

/** One spark group: a labelled bag of prompt fragments. The UI shows one
 * chip per group; tapped chips append to the prompt as editable text. Groups
 * are ordered so left-to-right taps read as a sentence. */
export interface SparkGroup {
  label: string;
  options: string[];
}

export interface PathSpec {
  id: PathId;
  copy: PathCopy;
  /** Blank-page antidote: fragments an attendee can assemble into a prompt.
   * These are the SEED banks: shown instantly and used whenever the sparks
   * workflow is unreachable; the LLM batch replaces them in the background. */
  sparks: SparkGroup[];
  /** System prompt for the sparks workflow's LLM node. */
  sparksSystem: string;
  /** Spell VFX tint while this path is generating. */
  spell: { color: number; secondaryColor: number };
  /** System prompt for the sketch workflow's prompt-shaper LLM node. */
  shaperSystem: string;
  /** System prompt for the manifest workflow's document LLM node. */
  docSystem: string;
  /** System prompt for the manifest workflow's icon-prompt LLM node. */
  iconSystem: string;
  /** System prompt for click-to-annotate vision calls. */
  annotateSystem: string;
  /** Identity line handed to annotate so it matches the document's world. */
  annotateIdentity: (doc: { name: string; description: string }) => string;
  /** Wraps the player's text for the direct (non-workflow) document call. */
  directDocPrompt: (userText: string) => string;
}

// Composition and lighting rules shared by every path: they exist for the 3D
// stage (grounded pose, invisible floor, even light, matte), not for style.
const FRAMING =
  "Always describe: a single subject, centered, three-quarter view, resting stably as if on solid " +
  "ground -- but the ground itself is invisible: a seamless uniform backdrop with no floor line, no " +
  "horizon, no disc, no pedestal, no shadow beneath it. Clean light gray studio background, no scenery. " +
  "Always require this lighting: flat even diffuse studio lighting from the front, no cast shadows, no " +
  "dramatic rim light, no dark side, every surface clearly visible and unoccluded. The whole subject " +
  "must be fully in frame with nothing cropped.";

const MATTE_BAN =
  "Never allow: gloss, shine, wet look, chrome, metallic sheen, specular hotspots, reflections, " +
  "transparency, translucency, glass, iridescence, ground planes, pedestals, text, logos, humans.";

const SHAPER_PREAMBLE =
  "Reply with ONLY the finished image-generation prompt, no preamble, no quotes, one paragraph.";

const ANNOTATE_SHAPE =
  'Reply with ONLY JSON: {"seen":"<= 8 words","label":"<= 4 words","blurb":"<= 24 words",' +
  '"slot":"crown|face|left|right|core|base|aura"}';

export const PATHS: Record<PathId, PathSpec> = {
  monster: {
    id: "monster",
    copy: {
      label: "Monster",
      placeholder: "A moss-covered lantern beast with too many eyes",
      placeholderAgain: "Describe another monster",
      sketchButton: "Sketch it",
      sketchAgainButton: "Sketch another",
      approveButton: "Summon this one",
      kickerCreate: "Describe your monster",
      kickerSummoning: "The summoning",
      kickerReveal: "Your monster",
      summoningHint: "Summoning your monster in ultra detail. This takes several minutes.",
      codexTitle: "Codex",
      discoverHint: "Your monster has no notes yet. Click any part of it to find out what that is.",
    },
    spell: { color: 0x38c9ff, secondaryColor: 0x0a4cc8 },
    shaperSystem:
      `You turn a player's monster idea into ONE image-generation prompt for the Miris monster world.\n${SHAPER_PREAMBLE}\n` +
      `${FRAMING.replace("a single subject", "a single full-body creature").replace("resting stably", "in a grounded standing pose: all feet planted flat and level, legs bearing weight")} ` +
      "Never a floating, leaping or hovering pose unless the creature is explicitly a flying type.\n" +
      "Always require this style: highly detailed fantasy creature design for a monster-taming video game, collectible game asset. " +
      "Photorealistic rendering with rich matte surface detail: individual scales, fur strands, skin folds and texture visible up close, " +
      "sculpted anatomy, crisp material definition. Strictly matte, completely diffuse surfaces throughout, like unvarnished painted resin. " +
      "Chunky readable silhouette, friendly-with-an-edge character design.\n" +
      `${MATTE_BAN}\n` +
      "Keep every concrete detail the player asked for (species, colors, props, mood) and elaborate it into readable creature anatomy with named surface materials (what its hide, plates, fur or shell are made of).",
    docSystem: `You are the lore keeper of the Miris monster world: warm, slightly mischievous, never grimdark.
Reply with ONLY a JSON object, no markdown fences, matching exactly:
{
  "kind": "monster",
  "name": "1-3 words",
  "epithet": "the ...",
  "lore": "<= 60 words",
  "element": one of ["ember","tide","bloom","storm","umbra","chime"],
  "stats": { "might": 1-10, "agility": 1-10, "arcana": 1-10, "mischief": 1-10, "resolve": 1-10 },
  "abilities": [2-3 of { "name": "<= 3 words", "blurb": "<= 12 words" }],
  "annotations": [3-5 of { "slot": one of ["crown","face","left","right","core","base","aura"], "label": "<= 4 words", "blurb": "<= 12 words" }]
}`,
    iconSystem:
      "You write ONE image prompt for a monster's emblem icon. Reply with ONLY the prompt.\n" +
      "Always: flat game emblem icon, bold simple shape, two flat colors plus a dark outline, matte, centered on a plain solid background, no text, sticker-like video game ability icon.\n" +
      "Base the emblem on the monster idea you are given (its element, silhouette, or signature feature).",
    annotateSystem: `You annotate the part of a creature a player just clicked.
Image 1 is a CLOSEUP framed on the clicked part. Image 2 is the whole creature, for context.
Work in two steps and report both:
1. "seen": literally what body part fills the center of image 1 (your own eyes only; ignore any lore).
2. "label"/"blurb": the annotation for THAT part.
Rules: describe only what you can actually see. Never name a part that is not visible, even if the lore mentions it. Match the creature's tone and world, but do not copy its existing features. The blurb should feel like a game codex entry: concrete, vivid, a little playful.
${ANNOTATE_SHAPE}`,
    annotateIdentity: (d) => `Name: ${d.name}. World and tone: ${d.description}`,
    directDocPrompt: (t) => `The monster was summoned from this description: "${t}"`,
    sparksSystem: "You deal prompt fragments that help a stuck attendee describe a creature for a monster-taming video game.\nReply with ONLY a JSON object, no markdown fences, matching exactly:\n{\"groups\": [3 of {\"label\": \"<the group name>\", \"options\": [10 of \"fragment\"]}]}\nThe three groups, in this order:\n- \"creature\": a base animal or being, phrased like \"a two-tailed ember fox\"\n- \"surface\": what covers its body, phrased like \"covered in cracked terracotta plates\"\n- \"quirk\": one charming habit or feature, phrased like \"that collects lost buttons\"\nEvery fragment: 2-8 words, lowercase start, no ending punctuation, written to be comma-joined mid-sentence with fragments from the other groups in order. Specific and evocative beats generic; vary wildly across the batch; never repeat an option. Tone: warm, playful, friendly-with-an-edge; never grimdark or gory.",
    sparks: [
      {
        label: "creature",
        options: [
          "a lantern-jawed toad", "a stilt-legged marsh heron", "a two-tailed ember fox",
          "a moss-backed river turtle", "a barnacle-crusted crab king", "a moth with an owl's face",
          "a pangolin made for rolling downhill", "a jellyfish that walks on land",
          "a stout badger knight", "a salamander with a furnace belly", "a snail with a lighthouse shell",
          "a raccoon oracle",
        ],
      },
      {
        label: "surface",
        options: [
          "covered in cracked terracotta plates", "wrapped in glowing kelp", "armored in acorn caps",
          "grown over with tiny mushrooms", "plated in tarnished tea-kettle copper",
          "quilted like a winter blanket", "carved from driftwood", "dusted with chalk and old paint",
          "scaled like ripe pinecones", "knitted from storm clouds", "tiled like a bathhouse floor",
          "furred in frost that never melts",
        ],
      },
      {
        label: "quirk",
        options: [
          "that collects lost buttons", "with a teapot growing from its back",
          "that hums sea shanties when nervous", "with lantern eyes that attract moths",
          "that hoards umbrellas", "with a birdhouse in its antlers", "that only walks backwards",
          "with pockets full of thunder", "that brews soup in its shell", "with a moon phase on its brow",
          "that sneezes fireflies", "with a library of stolen bookmarks",
        ],
      },
    ],
  },

  product: {
    id: "product",
    copy: {
      label: "Product",
      placeholder: "A brushed-steel pour-over kettle with a walnut handle",
      placeholderAgain: "Describe another product",
      sketchButton: "Render it",
      sketchAgainButton: "Render another",
      approveButton: "Build the twin",
      kickerCreate: "Describe your product",
      kickerSummoning: "Building the digital twin",
      kickerReveal: "Your product",
      summoningHint: "Building the digital twin in ultra detail. This takes several minutes.",
      codexTitle: "Spec sheet",
      discoverHint: "No callouts yet. Click any part of the product to spec it.",
    },
    // The product effect is a silver holographic vitrine, not a fire ritual.
    spell: { color: 0xdfe9f2, secondaryColor: 0x8fb2c9 },
    shaperSystem:
      `You turn a merchant's product idea into ONE image-generation prompt for a retail digital-twin catalog.\n${SHAPER_PREAMBLE}\n${FRAMING}\n` +
      "Always require this style: professional e-commerce product photography of a single physical product, photorealistic, " +
      "true-to-life materials with an honest satin response: brushed steel that reads as steel (soft anisotropic sheen, gray-blue tones), " +
      "wood grain, fabric weave, molded polymer. Crisp edges, accurate proportions, catalog-hero composition.\n" +
      "Never allow: mirror finish, chrome reflections of surroundings, hard specular hotspots, lens flare, wet look, transparency, " +
      "glass, ground planes, pedestals, text. Also never: packaging, price tags, hands, lifestyle scenes, brand names or trademarks of real companies.\n" +
      "Keep every concrete detail the merchant asked for (materials, colors, form factor, features) and elaborate it into a coherent, manufacturable object with named materials and finishes.",
    docSystem: `You write the retail listing for a product's digital twin: precise, confident, no hype-words like "revolutionary".
Invent plausible commerce details (pricing, specs) for a fictional catalog; never reference real brands.
Reply with ONLY a JSON object, no markdown fences, matching exactly:
{
  "kind": "product",
  "name": "product name, 1-4 words",
  "tagline": "<= 12 words",
  "description": "sales description, <= 70 words, concrete benefits and materials",
  "category": "1-3 words",
  "price": { "amount": realistic USD number for this kind of product, "currency": "USD" },
  "attributes": [4-6 of { "label": "<= 3 words (e.g. Material, Weight, Capacity)", "value": "<= 8 words" }],
  "highlights": [3-5 of "<= 12 words, one selling point each"],
  "annotations": [3-5 of { "slot": one of ["crown","face","left","right","core","base","aura"], "label": "<= 4 words", "blurb": "<= 12 words, a feature callout" }]
}`,
    iconSystem:
      "You write ONE image prompt for a product category badge icon. Reply with ONLY the prompt.\n" +
      "Always: flat minimal product-category icon, bold simple shape, two flat colors plus a dark outline, matte, centered on a plain solid background, no text.\n" +
      "Base the badge on the product's silhouette or its defining feature.",
    annotateSystem: `You annotate the part of a product a shopper just clicked.
Image 1 is a CLOSEUP framed on the clicked part. Image 2 is the whole product, for context.
Work in two steps and report both:
1. "seen": literally what component fills the center of image 1 (your own eyes only; ignore the listing).
2. "label"/"blurb": a spec-sheet callout for THAT component.
Rules: describe only what you can actually see. Never name a component that is not visible. The blurb reads like premium product copy: material, function, and why it matters -- concrete, no hype.
${ANNOTATE_SHAPE}`,
    annotateIdentity: (d) => `Product: ${d.name}. Listing: ${d.description}`,
    directDocPrompt: (t) => `Write the listing for the product described as: "${t}"`,
    sparksSystem: "You deal prompt fragments that help a stuck attendee describe a physical product for a retail digital-twin catalog.\nReply with ONLY a JSON object, no markdown fences, matching exactly:\n{\"groups\": [3 of {\"label\": \"<the group name>\", \"options\": [10 of \"fragment\"]}]}\nThe three groups, in this order:\n- \"object\": an everyday manufacturable object, phrased like \"a pour-over kettle\"\n- \"materials\": its materials and finish, phrased like \"in brushed steel and walnut\"\n- \"feature\": one standout feature, phrased like \"with a hidden compartment\"\nEvery fragment: 2-8 words, lowercase start, no ending punctuation, written to be comma-joined mid-sentence with fragments from the other groups in order. Specific and evocative beats generic; vary wildly across the batch; never repeat an option. Objects must be real product categories; never name real brands or trademarks.",
    sparks: [
      {
        label: "object",
        options: [
          "a pour-over kettle", "a desk lamp", "a mechanical keyboard", "a camping lantern",
          "a chess set", "a record player", "a watering can", "an espresso grinder",
          "a bedside clock", "a toolbox", "a bicycle bell", "a field binocular set",
        ],
      },
      {
        label: "materials",
        options: [
          "in brushed steel and walnut", "in sandblasted titanium", "in matte ceramic and cork",
          "in anodized sage-green aluminum", "in oiled leather and brass", "in smoked oak",
          "in recycled ocean plastic", "in cast iron with enamel", "in bamboo and canvas",
          "in bead-blasted copper", "in stone-gray polymer", "in birch ply and felt",
        ],
      },
      {
        label: "feature",
        options: [
          "with a hidden compartment", "with modular magnetic parts", "with a wind-up mechanism",
          "with a built-in level", "that packs flat for travel", "with a single satisfying dial",
          "with swappable faceplates", "that doubles as a bookend", "with a braille-friendly grip",
          "with a lifetime-service hatch", "that stacks like cordwood", "with a solar cell in the lid",
        ],
      },
    ],
  },

  artifact: {
    id: "artifact",
    copy: {
      label: "Artifact",
      placeholder: "A bronze astrolabe engraved with wave patterns",
      placeholderAgain: "Describe another artifact",
      sketchButton: "Unearth it",
      sketchAgainButton: "Unearth another",
      approveButton: "Acquire for the collection",
      kickerCreate: "Describe your artifact",
      kickerSummoning: "The acquisition",
      kickerReveal: "Your artifact",
      summoningHint: "Reconstructing the artifact in ultra detail. This takes several minutes.",
      codexTitle: "Exhibit label",
      discoverHint: "No curator's notes yet. Click any detail of the artifact to examine it.",
    },
    spell: { color: 0xffd27a, secondaryColor: 0xa06010 },
    shaperSystem:
      `You turn a curator's artifact idea into ONE image-generation prompt for a museum digitization archive.\n${SHAPER_PREAMBLE}\n${FRAMING}\n` +
      "Always require this style: archival photograph of a single museum artifact, photorealistic, honest signs of age rendered matte: " +
      "patina, wear, chips, oxidation, tool marks, faded pigment. Materials named and readable up close (bronze, terracotta, carved bone, " +
      "woven fiber). Historically plausible craftsmanship; no modern materials.\n" +
      `${MATTE_BAN} Also never: museum mounts, labels, measuring scales, glass cases.\n` +
      "Keep every concrete detail the curator asked for (material, culture, purpose, condition) and elaborate it into a plausible object a real museum could hold.",
    docSystem: `You write the exhibit label for a museum artifact: a curator's voice, precise and quietly evocative.
The artifact is imaginary. Weave in REAL historical figures and places, but every connection to this object is invented museum legend: plausible, respectful, clearly of the past.
Hard rules: only real people who died more than 100 years ago; never living or recent people; nothing scandalous, criminal, or defamatory about any real person; the invented stories should flatter history, not rewrite it.
Reply with ONLY a JSON object, no markdown fences, matching exactly:
{
  "kind": "artifact",
  "name": "artifact title, 1-5 words",
  "era": "period and rough date range, <= 8 words",
  "origin": "real place or culture of origin, <= 8 words",
  "description": "curator's summary of the object and its invented provenance, <= 70 words",
  "figures": [2-3 of { "name": "a real historical figure, dead > 100 years", "role": "their invented connection to this object, <= 10 words", "story": "<= 30 words of museum legend about them and this object" }],
  "annotations": [3-5 of { "slot": one of ["crown","face","left","right","core","base","aura"], "label": "<= 4 words", "blurb": "<= 12 words, a curator's detail note" }]
}`,
    iconSystem:
      "You write ONE image prompt for a museum collection seal icon. Reply with ONLY the prompt.\n" +
      "Always: flat museum-catalog seal icon, bold simple shape, two flat colors plus a dark outline, matte, aged-paper feel, centered on a plain solid background, no text.\n" +
      "Base the seal on the artifact's silhouette or its culture of origin.",
    annotateSystem: `You annotate the detail of a museum artifact a visitor just clicked.
Image 1 is a CLOSEUP framed on the clicked detail. Image 2 is the whole artifact, for context.
Work in two steps and report both:
1. "seen": literally what detail fills the center of image 1 (your own eyes only; ignore the label text).
2. "label"/"blurb": a curator's note for THAT detail.
Rules: describe only what you can actually see. Never name a detail that is not visible. The blurb reads like a museum placard: material, technique, what it tells us -- and it may gesture at the artifact's invented legend, never at real events.
${ANNOTATE_SHAPE}`,
    annotateIdentity: (d) => `Artifact: ${d.name}. Exhibit label: ${d.description}`,
    directDocPrompt: (t) => `Write the exhibit label for the artifact described as: "${t}"`,
    sparksSystem: "You deal prompt fragments that help a stuck attendee describe a museum artifact.\nReply with ONLY a JSON object, no markdown fences, matching exactly:\n{\"groups\": [3 of {\"label\": \"<the group name>\", \"options\": [10 of \"fragment\"]}]}\nThe three groups, in this order:\n- \"object\": a plausible historical object type, phrased like \"a ceremonial mask\"\n- \"origin\": a real culture, place or era, phrased like \"from Bronze Age Crete\"\n- \"detail\": one physical detail or gentle mystery, phrased like \"worn smooth by centuries of hands\"\nEvery fragment: 2-8 words, lowercase start, no ending punctuation, written to be comma-joined mid-sentence with fragments from the other groups in order. Specific and evocative beats generic; vary wildly across the batch; never repeat an option. Origins are real history; details stay physical and museum-plausible, never supernatural claims stated as fact.",
    sparks: [
      {
        label: "object",
        options: [
          "a ceremonial mask", "an astrolabe", "a drinking horn", "a signet ring",
          "a board game set", "a navigator's compass", "an oil lamp", "a war drum",
          "a reliquary box", "a sundial", "a merchant's scale", "a comb",
        ],
      },
      {
        label: "origin",
        options: [
          "from Bronze Age Crete", "from Song dynasty China", "from a Viking hoard",
          "from Mughal-era Lahore", "from a Silk Road caravan", "from Benin's brass workshops",
          "from Edo-period Kyoto", "from a sunken Venetian galley", "from Inca terraces",
          "from a Baltic amber route", "from Ptolemaic Alexandria", "from a Bavarian monastery",
        ],
      },
      {
        label: "detail",
        options: [
          "engraved with wave patterns", "worn smooth by centuries of hands", "inlaid with mother-of-pearl",
          "repaired long ago with gold seams", "carved from a single whale bone", "stained with indigo",
          "wrapped in silver wire", "bearing a maker's thumbprint", "scorched on one side",
          "with an inscription no one has translated", "missing one famous piece", "smelling faintly of cedar",
        ],
      },
    ],
  },
};

/** Resolves an untrusted path id, defaulting to the original path. */
export function pathOf(id: unknown): PathSpec {
  return PATHS[(PATH_IDS as readonly string[]).includes(id as string) ? (id as PathId) : "monster"];
}
