import type { ProbeResult, KeyStatus } from "./probes";
import type { WorkshopState } from "./state";

export interface StatusDeps {
  env: Record<string, string | undefined>;
  probes: { fal: () => Promise<ProbeResult>; gateway: () => Promise<ProbeResult>; miris: () => Promise<ProbeResult> };
  artifacts: { conceptCount: () => Promise<number>; glbExists: () => Promise<boolean>; loreExists: () => Promise<boolean> };
  deployment: () => Promise<{ url: string } | null>;
  state: () => Promise<WorkshopState>;
}
export interface WorkshopStatus {
  keys: { fal: KeyStatus; gateway: KeyStatus; miris: KeyStatus };
  concept: { count: number; approved: boolean };
  model: WorkshopState["model"];
  lore: { ready: boolean; status: string; error: string | null };
  upload: WorkshopState["upload"];
  deployment: { url: string | null };
}

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; r: ProbeResult }>();

// Cache key includes the probe slot and the probe function's own source text
// in addition to the key value. In production the caller (server/api.ts)
// always constructs the same closure source per slot, so the cache still
// hits across repeated polls for an unchanged key -- this preserves the
// "cached in-module for 60s keyed by key value" behavior for real traffic.
// The extra components just prevent two different probe functions that
// happen to share a key value (as in tests, or in the theoretical case of
// two env vars holding the same literal string) from colliding on one
// cache entry.
async function keyStatus(slot: string, value: string | undefined, probe: () => Promise<ProbeResult>): Promise<KeyStatus> {
  if (!value) return { present: false, valid: null, detail: "not set" };
  const cacheKey = `${slot}:${value}:${probe.toString()}`;
  const hit = cache.get(cacheKey);
  const r = hit && Date.now() - hit.at < CACHE_MS ? hit.r : await probe();
  cache.set(cacheKey, { at: Date.now(), r });
  return { present: true, valid: r.ok, detail: r.detail };
}

export async function buildStatus(deps: StatusDeps): Promise<WorkshopStatus> {
  const [fal, gw, miris, count, glb, lore, dep, state] = await Promise.all([
    keyStatus("fal", deps.env.FAL_KEY, deps.probes.fal),
    keyStatus("gateway", deps.env.AI_GATEWAY_API_KEY, deps.probes.gateway),
    keyStatus("miris", deps.env.MIRIS_API_TOKEN, deps.probes.miris),
    deps.artifacts.conceptCount(),
    deps.artifacts.glbExists(),
    deps.artifacts.loreExists(),
    deps.deployment(),
    deps.state(),
  ]);
  return {
    keys: { fal, gateway: gw, miris },
    concept: { count, approved: state.approvedConceptId !== null },
    model: glb && state.model.status === "none" ? { ...state.model, status: "done" } : state.model,
    lore: { ready: lore, status: state.loreStatus.status, error: state.loreStatus.error },
    upload: state.upload,
    deployment: { url: dep?.url ?? null },
  };
}
