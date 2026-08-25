import { z } from "zod";
import { MONSTER_ELEMENTS } from "./guardrails";

export const ANNOTATION_SLOTS = ["crown", "face", "left", "right", "core", "base", "aura"] as const;
export type AnnotationSlot = (typeof ANNOTATION_SLOTS)[number];

const stat = z.number().int().min(1).max(10);

/** Model-written prose, normalized on the way in. LLMs reach for em dashes
 * constantly ("simmering-don't touch", "stance-gains resolve") and this copy
 * renders straight into the UI, where the house style forbids them. */
const prose = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .transform((t) => t.replace(/[\u2014\u2013]/g, " - ").replace(/\s+/g, " ").trim());

const annotation = z.object({ slot: z.enum(ANNOTATION_SLOTS), label: prose(30), blurb: prose(90) });

export const loreSchema = z.object({
  kind: z.literal("monster").default("monster"),
  name: prose(40),
  epithet: prose(60),
  lore: prose(420),
  element: z.enum(MONSTER_ELEMENTS as unknown as [string, ...string[]]),
  stats: z.object({ might: stat, agility: stat, arcana: stat, mischief: stat, resolve: stat }),
  abilities: z
    .array(z.object({ name: prose(30), blurb: prose(90) }))
    .min(2)
    .max(3),
  annotations: z.array(annotation).min(3).max(5),
});

export type MonsterLore = z.infer<typeof loreSchema>;
export const parseLore = (raw: unknown): MonsterLore => loreSchema.parse(raw);

/** Retail digital-twin listing. Price is model-invented but bounded, so a
 * hallucinated "$2" or "$2,000,000" kettle never reaches the spec sheet. */
export const productSchema = z.object({
  kind: z.literal("product"),
  name: prose(50),
  tagline: prose(90),
  description: prose(480),
  category: prose(40),
  price: z.object({
    amount: z.number().positive().max(250_000),
    currency: z.string().trim().toUpperCase().max(3).default("USD"),
  }),
  attributes: z.array(z.object({ label: prose(30), value: prose(70) })).min(3).max(6),
  highlights: z.array(prose(90)).min(2).max(5),
  annotations: z.array(annotation).min(3).max(5),
});
export type ProductDoc = z.infer<typeof productSchema>;

/** Museum exhibit label. Figures are real historical people; their connection
 * to the (imaginary) object is invented museum legend -- the prompt enforces
 * dead >100 years and nothing defamatory, the schema enforces shape. */
export const artifactSchema = z.object({
  kind: z.literal("artifact"),
  name: prose(60),
  era: prose(60),
  origin: prose(80),
  description: prose(480),
  figures: z.array(z.object({ name: prose(50), role: prose(90), story: prose(240) })).min(1).max(3),
  annotations: z.array(annotation).min(3).max(5),
});
export type ArtifactDoc = z.infer<typeof artifactSchema>;

/** Any path's document. Banked monsters predate `kind`, so parseDoc injects
 * the default before discriminating. */
export const docSchema = z.discriminatedUnion("kind", [loreSchema, productSchema, artifactSchema]);
export type WorkshopDoc = z.infer<typeof docSchema>;

export function parseDoc(raw: unknown): WorkshopDoc {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return docSchema.parse({ kind: "monster", ...o });
}
export const safeParseDoc = (raw: unknown) => {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return docSchema.safeParse({ kind: "monster", ...o });
};

/** A player-discovered annotation from click-to-annotate. `seen` is the
 * model's own description of what it looked at, kept for debugging and for
 * the rehearsal notes. */
export const discoverySchema = z.object({
  seen: prose(80),
  label: prose(30),
  blurb: prose(160),
  slot: z.enum(ANNOTATION_SLOTS),
});
export type Discovery = z.infer<typeof discoverySchema>;
