import { generateObject, type LanguageModel } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { MONSTER_ELEMENTS, sanitizeUserPrompt } from "./guardrails";
import { ANNOTATION_SLOTS, loreSchema, type MonsterLore } from "./lore-schema";

export const LORE_MODEL_ID = "anthropic/claude-3-haiku"; // doctor verifies this string live

export async function generateLore(userText: string, opts?: { model?: LanguageModel }): Promise<MonsterLore> {
  const model = opts?.model ?? gateway(LORE_MODEL_ID);
  const cleaned = sanitizeUserPrompt(userText);
  const { object } = await generateObject({
    model,
    schema: loreSchema,
    prompt:
      `You are the lore keeper of the Miris monster world: warm, slightly mischievous, never grimdark. ` +
      `A new monster was just summoned from this description: "${cleaned}". ` +
      `Write its entry. element must be one of: ${MONSTER_ELEMENTS.join(", ")}. ` +
      `Give 3 to 5 annotations, each pointing at a physical region using exactly one slot from: ${ANNOTATION_SLOTS.join(", ")}. ` +
      `labels at most 4 words, blurbs at most 12 words, lore at most 60 words, stats are integers 1-10.`,
  });
  return object;
}
