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

export const loreSchema = z.object({
  name: prose(40),
  epithet: prose(60),
  lore: prose(420),
  element: z.enum(MONSTER_ELEMENTS as unknown as [string, ...string[]]),
  stats: z.object({ might: stat, agility: stat, arcana: stat, mischief: stat, resolve: stat }),
  abilities: z
    .array(z.object({ name: prose(30), blurb: prose(90) }))
    .min(2)
    .max(3),
  annotations: z
    .array(z.object({ slot: z.enum(ANNOTATION_SLOTS), label: prose(30), blurb: prose(90) }))
    .min(3)
    .max(5),
});

export type MonsterLore = z.infer<typeof loreSchema>;
export const parseLore = (raw: unknown): MonsterLore => loreSchema.parse(raw);

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
