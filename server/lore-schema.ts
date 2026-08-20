import { z } from "zod";
import { MONSTER_ELEMENTS } from "./guardrails";

export const ANNOTATION_SLOTS = ["crown", "face", "left", "right", "core", "base", "aura"] as const;
export type AnnotationSlot = (typeof ANNOTATION_SLOTS)[number];

const stat = z.number().int().min(1).max(10);

export const loreSchema = z.object({
  name: z.string().min(1).max(40),
  epithet: z.string().min(1).max(60),
  lore: z.string().min(1).max(420),
  element: z.enum(MONSTER_ELEMENTS as unknown as [string, ...string[]]),
  stats: z.object({ might: stat, agility: stat, arcana: stat, mischief: stat, resolve: stat }),
  annotations: z
    .array(z.object({ slot: z.enum(ANNOTATION_SLOTS), label: z.string().min(1).max(30), blurb: z.string().min(1).max(90) }))
    .min(3)
    .max(5),
});

export type MonsterLore = z.infer<typeof loreSchema>;
export const parseLore = (raw: unknown): MonsterLore => loreSchema.parse(raw);
