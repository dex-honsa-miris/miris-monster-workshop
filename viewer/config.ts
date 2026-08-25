import { loreSchema, type MonsterLore } from "../server/lore-schema";

/** The baked contract the deploy script writes into `viewer/monster.config.json`.
 *  `viewerKey` is optional: whether a processed asset is readable by uuid alone
 *  or needs a key is the same unconfirmed Miris contract as the pipeline task,
 *  so the viewer passes one through when it is present and boots without it
 *  when it is not. */
export interface ViewerConfig {
  assetId: string;
  /** Monster codex data, or null when the asset is a product/artifact. */
  lore: MonsterLore | null;
  viewerKey?: string;
}

export function loadConfig(raw: unknown): ViewerConfig {
  const cfg = raw as { assetId?: unknown; lore?: unknown; viewerKey?: unknown };
  const assetId = String(cfg.assetId ?? "");
  if (!assetId) throw new Error("monster.config.json is missing assetId");
  const viewerKey = cfg.viewerKey == null ? "" : String(cfg.viewerKey);
  // The published viewer's stats card only knows the monster shape. Product
  // and artifact documents ride through as null: the model still shows, the
  // card simply stays hidden. (A per-path viewer card is future work.)
  const parsed = loreSchema.safeParse({ kind: "monster", ...(cfg.lore as Record<string, unknown> ?? {}) });
  const config: ViewerConfig = { assetId, lore: parsed.success ? parsed.data : null };
  if (viewerKey) config.viewerKey = viewerKey;
  return config;
}
