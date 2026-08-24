import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface Concept {
  id: string;
  prompt: string;
  imageUrl: string;
  createdAt: string;
  /** The shaper's art-direction paragraph for this concept. Carried forward
   * so the texturing stage is told the same style the image was drawn to. */
  styledPrompt?: string | null;
}
/** A click-to-annotate discovery, with the local-space point on the mount so
 * the card can be restored exactly where the player clicked. */
export interface StoredDiscovery {
  id: string;
  label: string;
  blurb: string;
  slot: string;
  seen: string;
  point: [number, number, number];
}

/** One summoned creature, kept so it can be brought back to the pedestal.
 * The files themselves live under .workshop/monsters/<id>/; this is the index
 * plus everything that belongs to the creature rather than to the session:
 * its notes, and the Miris asset it was published as. */
export interface MonsterRecord {
  id: string;
  prompt: string;
  name: string;
  epithet: string;
  createdAt: string;
  discoveries: StoredDiscovery[];
  assetId: string | null;
}

export interface WorkshopState {
  monsters: MonsterRecord[];
  /** Which record the pedestal is currently showing. */
  currentMonsterId: string | null;
  concepts: Concept[];
  approvedConceptId: string | null;
  model: { status: "none" | "running" | "done" | "failed"; glbPath: string | null; error: string | null };
  lore: unknown | null;
  discoveries: StoredDiscovery[];
  loreStatus: { status: "none" | "running" | "done" | "failed"; error: string | null };
  upload: { glbSha: string | null; assetId: string | null; state: "none" | "uploading" | "processing" | "ready" | "failed"; error: string | null };
}

export const workshopDir = (): string => process.env.WORKSHOP_DIR ?? join(process.cwd(), ".workshop");
export const stateFile = (): string => join(workshopDir(), "state.json");

export function defaultState(): WorkshopState {
  return {
    monsters: [],
    currentMonsterId: null,
    concepts: [],
    approvedConceptId: null,
    model: { status: "none", glbPath: null, error: null },
    lore: null,
    discoveries: [],
    loreStatus: { status: "none", error: null },
    upload: { glbSha: null, assetId: null, state: "none", error: null },
  };
}

export async function readState(): Promise<WorkshopState> {
  try {
    const raw = await readFile(stateFile(), "utf8");
    return { ...defaultState(), ...(JSON.parse(raw) as WorkshopState) };
  } catch {
    return defaultState();
  }
}

async function doPatch(patch: Partial<WorkshopState>): Promise<WorkshopState> {
  const cur = await readState();
  const next: WorkshopState = {
    ...cur,
    ...patch,
    model: { ...cur.model, ...(patch.model ?? {}) },
    loreStatus: { ...cur.loreStatus, ...(patch.loreStatus ?? {}) },
    upload: { ...cur.upload, ...(patch.upload ?? {}) },
  };
  await mkdir(workshopDir(), { recursive: true });
  await writeFile(stateFile(), JSON.stringify(next, null, 2));
  return next;
}

// Serialize writes: readState() + writeFile() in doPatch() is a
// read-modify-write that races when two callers patch concurrently (e.g.
// the parallel model + lore background tasks kicked off by /api/approve).
// Queueing patchState calls on a module-level promise chain ensures each
// patch reads the state left by the previous one, rather than clobbering it.
let writeChain: Promise<unknown> = Promise.resolve();
export function patchState(patch: Partial<WorkshopState>): Promise<WorkshopState> {
  const run = writeChain.then(() => doPatch(patch));
  writeChain = run.catch(() => undefined);
  return run;
}
