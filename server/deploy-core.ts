import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
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

export async function collectFiles(dir: string): Promise<Array<{ file: string; data: string; encoding: "base64" }>> {
  const out: Array<{ file: string; data: string; encoding: "base64" }> = [];
  const walk = async (d: string): Promise<void> => {
    for (const entry of await readdir(d, { withFileTypes: true })) {
      const p = join(d, entry.name);
      if (entry.isDirectory()) await walk(p);
      else out.push({ file: relative(dir, p).split("\\").join("/"), data: (await readFile(p)).toString("base64"), encoding: "base64" });
    }
  };
  await walk(dir);
  return out;
}
