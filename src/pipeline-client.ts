import type { WorkshopStatus } from "../server/status";
import type { Concept } from "../server/state";
import type { MonsterLore } from "../server/lore-schema";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  const json = (await r.json()) as T & { error?: string; hint?: string };
  if (!r.ok) throw new Error(json.hint ?? json.error ?? `request failed: ${r.status}`);
  return json;
}
const post = (body: unknown): RequestInit => ({ method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });

export const fetchStatus = (): Promise<WorkshopStatus> => call("/api/status");
export const postConcept = (prompt: string): Promise<Concept> => call("/api/concept", post({ prompt }));
export const postApprove = (conceptId: string): Promise<{ started: boolean }> => call("/api/approve", post({ conceptId }));
export const postUpload = (): Promise<{ assetId: string; reused: boolean }> => call("/api/upload", post({}));
export const postLoreRetry = (): Promise<{ started: boolean }> => call("/api/lore/retry", post({}));
export const fetchLore = async (): Promise<MonsterLore | null> => {
  const r = await fetch("/api/lore");
  if (r.status === 404) return null;
  const json = (await r.json()) as MonsterLore & { error?: string; hint?: string };
  if (!r.ok) throw new Error(json.hint ?? json.error ?? `request failed: ${r.status}`);
  return json;
};
