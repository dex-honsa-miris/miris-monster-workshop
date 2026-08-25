// LLM-dealt spark batches, through the sparks workflow.
//
// The static banks in paths.ts boot the UI and survive outages; this refills
// the pool with fresh fragments so a long session never sees the same twelve
// options twice. One any-llm node, system prompt supplied per path as an
// $input ref like every other workflow prompt in this repo.
import { z } from "zod";
import { falQueue, type FalDeps } from "./fal";
import type { PathSpec, SparkGroup } from "./paths";

export const SPARKS_WORKFLOW = "workflows/dexhonsa/miris-monster-sparks";

/** What a usable batch looks like. The transform trims, drops overlong
 * options, lowercases first characters (the banks' mid-sentence contract)
 * and dedupes -- an LLM batch that survives all that is safe to deal. */
const groupSchema = z.object({
  label: z.string().trim().min(1).max(24),
  options: z
    .array(z.string().trim().min(2).max(70))
    .min(4)
    .max(16)
    .transform((opts) => {
      const seen = new Set<string>();
      const out: string[] = [];
      for (const raw of opts) {
        const o = (raw.charAt(0).toLowerCase() + raw.slice(1)).replace(/[.!?]+$/, "");
        if (!seen.has(o)) { seen.add(o); out.push(o); }
      }
      return out;
    }),
});

export const sparksBatchSchema = z
  .object({ groups: z.array(groupSchema).length(3) })
  .refine((b) => b.groups.every((g) => g.options.length >= 4), {
    message: "a group lost too many options to dedup/clamping",
  });

export function parseSparksOutput(raw: unknown): SparkGroup[] {
  const o = (raw ?? {}) as Record<string, unknown>;
  const payload = typeof o.sparks === "string" ? tryJson(o.sparks) : (o.sparks ?? o);
  const parsed = sparksBatchSchema.parse(payload);
  return parsed.groups;
}

function tryJson(text: string): unknown {
  try {
    return JSON.parse(text.replace(/^```json?\s*|\s*```$/g, "").trim());
  } catch {
    return null;
  }
}

/**
 * Deals a fresh batch for a path. `avoid` carries a few fragments the client
 * already showed, which is what pushes the model off its favorite ruts.
 * Throws on any failure; the caller falls back to the static banks.
 */
export async function generateSparks(deps: FalDeps, path: PathSpec, avoid: string[] = []): Promise<SparkGroup[]> {
  const avoidLine = avoid.length ? ` Avoid anything close to: ${avoid.slice(0, 6).join("; ")}.` : "";
  const out = await falQueue(SPARKS_WORKFLOW, {
    sparks_system: path.sparksSystem,
    prompt: `Deal a fresh batch of fragments.${avoidLine}`,
  }, deps);
  return parseSparksOutput(out);
}
