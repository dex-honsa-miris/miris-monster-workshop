import type { WorkshopStatus } from "../server/status";
import type { Concept } from "../server/state";
import type { WorkshopDoc } from "../server/lore-schema";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  const json = (await r.json()) as T & { error?: string; hint?: string };
  if (!r.ok) throw new Error(json.hint ?? json.error ?? `request failed: ${r.status}`);
  return json;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const fetchStatus = (): Promise<WorkshopStatus> => call("/api/status");
export const postConcept = (prompt: string, path: string): Promise<Concept> =>
  call("/api/concept", post({ prompt, path }));
export const postApprove = (conceptId: string): Promise<{ started: boolean }> => call("/api/approve", post({ conceptId }));
export const postAssetId = (assetId: string): Promise<{ assetId: string }> => call("/api/asset-id", post({ assetId }));
export const postAnnotate = (payload: { closeup: string; context: string; point: [number, number, number] }): Promise<{
  id: string; label: string; blurb: string; slot: string; seen: string; point: [number, number, number];
}> => call("/api/annotate", post(payload));
export const postClearDiscoveries = (): Promise<{ discoveries: [] }> =>
  call("/api/discoveries/clear", post({}));
export const postSummonRetry = (): Promise<{ started: boolean }> =>
  call("/api/summon/retry", post({}));
export const postLoadMonster = (id: string): Promise<{ id: string }> =>
  call("/api/monsters/load", post({ id }));
export const postDeployedUrl = (url: string): Promise<{ url: string }> => call("/api/deployed-url", post({ url }));
export const postLoreRetry = (): Promise<{ started: boolean }> => call("/api/lore/retry", post({}));
export const fetchLore = async (): Promise<WorkshopDoc | null> => {
  const r = await fetch("/api/lore");
  if (r.status === 404) return null;
  const json = (await r.json()) as WorkshopDoc & { error?: string; hint?: string };
  if (!r.ok) throw new Error(json.hint ?? json.error ?? `request failed: ${r.status}`);
  return json;
};
