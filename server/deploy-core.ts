import type { MonsterLore } from "./lore-schema";
import type { WorkshopState } from "./state";

export function resolveAssetId(cliArg: string | undefined, state: WorkshopState): string {
  if (cliArg?.trim()) return cliArg.trim();
  if (state.upload.assetId) return state.upload.assetId;
  throw new Error("No asset id. Upload first, or pass one: npm run deploy -- <asset_id>");
}

export const viewerConfig = (assetId: string, lore: MonsterLore, viewerKey?: string): string =>
  JSON.stringify(viewerKey ? { assetId, lore, viewerKey } : { assetId, lore }, null, 2);

export const deploymentRecord = (url: string): string =>
  JSON.stringify({ url, deployedAt: new Date().toISOString() }, null, 2);

