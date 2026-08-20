import { parseLore, type MonsterLore } from "../server/lore-schema";

/** The baked contract the deploy script writes into `viewer/monster.config.json`.
 *  `viewerKey` is optional: whether a processed asset is readable by uuid alone
 *  or needs a key is the same unconfirmed Miris contract as the pipeline task,
 *  so the viewer passes one through when it is present and boots without it
 *  when it is not. */
export interface ViewerConfig {
  assetId: string;
  lore: MonsterLore;
  viewerKey?: string;
}

export function loadConfig(raw: unknown): ViewerConfig {
  const cfg = raw as { assetId?: unknown; lore?: unknown; viewerKey?: unknown };
  const assetId = String(cfg.assetId ?? "");
  if (!assetId) throw new Error("monster.config.json is missing assetId");
  const viewerKey = cfg.viewerKey == null ? "" : String(cfg.viewerKey);
  const config: ViewerConfig = { assetId, lore: parseLore(cfg.lore) };
  if (viewerKey) config.viewerKey = viewerKey;
  return config;
}
