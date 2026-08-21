import { buildConceptPrompt, buildIconPrompt, LORE_SYSTEM_PROMPT, sanitizeUserPrompt } from "./guardrails";
import { loreSchema, type MonsterLore } from "./lore-schema";

export interface FalDeps { key: string; fetch: typeof fetch; sleep?: (ms: number) => Promise<void> }

const POLL_MS = 1500;
const TIMEOUT_MS = 6 * 60 * 1000;
const MODEL_IMAGE = "fal-ai/flux/schnell";
const MODEL_3D = "fal-ai/trellis"; // bake-off may swap to fal-ai/hunyuan3d/v2

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function falQueue(
  model: string,
  body: unknown,
  deps: FalDeps,
  onProgress?: (p: { status: string }) => void,
): Promise<unknown> {
  const sleep = deps.sleep ?? wait;
  const headers = { Authorization: `Key ${deps.key}`, "Content-Type": "application/json" };
  const submit = await deps.fetch(`https://queue.fal.run/${model}`, { method: "POST", headers, body: JSON.stringify(body) });
  if (!submit.ok) throw new Error(`fal submit failed: ${submit.status}`);
  const job = (await submit.json()) as { status_url: string; response_url: string };
  let elapsed = 0;
  for (;;) {
    const st = await deps.fetch(job.status_url, { headers });
    const s = (await st.json()) as { status: string };
    onProgress?.(s);
    if (s.status === "COMPLETED") break;
    if (s.status === "FAILED" || s.status === "ERROR") throw new Error("fal job failed");
    await sleep(POLL_MS);
    elapsed += POLL_MS;
    if (elapsed >= TIMEOUT_MS) throw new Error("fal job timed out");
  }
  const res = await deps.fetch(job.response_url, { headers });
  return res.json();
}

export async function generateConcept(userText: string, deps: FalDeps): Promise<{ imageUrl: string }> {
  const { prompt } = buildConceptPrompt(userText);
  const out = (await falQueue(MODEL_IMAGE, { prompt, image_size: "square_hd", enable_safety_checker: true }, deps)) as {
    images: Array<{ url: string }>;
  };
  const url = out.images?.[0]?.url;
  if (!url) throw new Error("fal returned no image");
  return { imageUrl: url };
}

export async function generateModel(
  imageUrl: string,
  deps: FalDeps,
  onProgress?: (p: { status: string }) => void,
): Promise<{ glb: ArrayBuffer }> {
  const out = (await falQueue(MODEL_3D, { image_url: imageUrl }, deps, onProgress)) as { model_mesh: { url: string } };
  if (!out.model_mesh?.url) throw new Error("fal returned no mesh");
  const dl = await deps.fetch(out.model_mesh.url, { headers: { Authorization: `Key ${deps.key}` } });
  if (!dl.ok) throw new Error(`mesh download failed: ${dl.status}`);
  return { glb: await dl.arrayBuffer() };
}

// --- The two-stage pipeline ---------------------------------------------------
// Stage 1 SKETCH (per reroll): styled concept image.
// Stage 2 MANIFEST (at approve): 3D model + lore document + emblem icon.
//
// Each stage prefers a PUBLIC fal workflow on the Miris account when its env
// var is set (FAL_SKETCH_WORKFLOW / FAL_MANIFEST_WORKFLOW) and otherwise runs
// the same chain as direct model calls with the prompts in guardrails.ts --
// so the app works before the workflows exist, and the workflow build is a
// transcription job (see docs/fal-workflows.md for the build sheets).
//
// Workflow output contracts (parsers are tolerant of common fal shapes):
//   sketch:   { "image_url": "<concept image>" }
//   manifest: { "model_url": "<glb>", "lore": { ...loreSchema }, "icon_url": "<png>" }

const MODEL_LLM = "fal-ai/any-llm";
const LLM_NAME = "google/gemini-flash-1.5";

function firstImageUrl(o: Record<string, unknown>): string | null {
  return (
    (typeof o.image_url === "string" && o.image_url) ||
    ((o.image as { url?: string } | undefined)?.url ?? null) ||
    ((o.images as Array<{ url?: string }> | undefined)?.[0]?.url ?? null)
  );
}

export function parseSketchOutput(raw: unknown): { imageUrl: string } {
  const url = firstImageUrl((raw ?? {}) as Record<string, unknown>);
  if (!url) throw new Error("workflow returned no image (expected image_url, image.url, or images[0].url)");
  return { imageUrl: url };
}

export function parseManifestOutput(raw: unknown): { modelUrl: string; lore: MonsterLore | null; iconUrl: string | null } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const modelUrl =
    (typeof o.model_url === "string" && o.model_url) ||
    ((o.model_mesh as { url?: string } | undefined)?.url ?? null) ||
    ((o.model as { url?: string } | undefined)?.url ?? null);
  if (!modelUrl) throw new Error("workflow returned no model (expected model_url, model_mesh.url, or model.url)");
  let lore: MonsterLore | null = null;
  for (const key of ["lore", "details", "monster"]) {
    const parsed = loreSchema.safeParse(typeof o[key] === "string" ? tryJson(o[key] as string) : o[key]);
    if (parsed.success) { lore = parsed.data; break; }
  }
  const iconUrl = (typeof o.icon_url === "string" && o.icon_url) || ((o.icon as { url?: string } | undefined)?.url ?? null);
  return { modelUrl: modelUrl as string, lore, iconUrl };
}

function tryJson(text: string): unknown {
  try { return JSON.parse(text.replace(/^```(json)?|```$/gm, "").trim()); } catch { return null; }
}

/** The lore leg alone (used by the direct manifest path and by lore retry). */
export async function generateLoreLLM(userText: string, deps: FalDeps): Promise<MonsterLore | null> {
  const out = (await falQueue(MODEL_LLM, {
    model: LLM_NAME,
    system_prompt: LORE_SYSTEM_PROMPT,
    prompt: `The monster was summoned from this description: "${sanitizeUserPrompt(userText)}"`,
  }, deps)) as { output?: string; text?: string };
  const parsed = loreSchema.safeParse(tryJson(out.output ?? out.text ?? ""));
  return parsed.success ? parsed.data : null;
}

export async function sketchMonster(
  userText: string,
  deps: FalDeps,
  workflowId?: string,
): Promise<{ imageUrl: string }> {
  if (workflowId) {
    const out = await falQueue(workflowId, { prompt: sanitizeUserPrompt(userText) }, deps);
    return parseSketchOutput(out);
  }
  return generateConcept(userText, deps);
}

export interface Manifest { glb: ArrayBuffer; lore: MonsterLore | null; iconPng: ArrayBuffer | null }

async function download(url: string, deps: FalDeps): Promise<ArrayBuffer> {
  const r = await deps.fetch(url, { headers: { Authorization: `Key ${deps.key}` } });
  if (!r.ok) throw new Error(`download failed: ${r.status}`);
  return r.arrayBuffer();
}

export async function manifestMonster(
  userText: string,
  imageUrl: string,
  deps: FalDeps,
  workflowId?: string,
  onProgress?: (p: { status: string }) => void,
): Promise<Manifest> {
  if (workflowId) {
    const out = await falQueue(workflowId, { prompt: sanitizeUserPrompt(userText), image_url: imageUrl }, deps, onProgress);
    const { modelUrl, lore, iconUrl } = parseManifestOutput(out);
    const [glb, iconPng] = await Promise.all([
      download(modelUrl, deps),
      iconUrl ? download(iconUrl, deps).catch(() => null) : Promise.resolve(null),
    ]);
    return { glb, lore, iconPng };
  }
  // Direct path: the same chain as the workflow, three parallel legs.
  const [model, lore, icon] = await Promise.allSettled([
    generateModel(imageUrl, deps, onProgress),
    generateLoreLLM(userText, deps),
    (async () => {
      const out = (await falQueue(MODEL_IMAGE, { prompt: buildIconPrompt(userText), image_size: "square", num_images: 1, enable_safety_checker: true }, deps)) as { images?: Array<{ url?: string }> };
      const url = out.images?.[0]?.url;
      return url ? download(url, deps) : null;
    })(),
  ]);
  if (model.status === "rejected") throw model.reason;
  return {
    glb: model.value.glb,
    lore: lore.status === "fulfilled" ? lore.value : null,
    iconPng: icon.status === "fulfilled" ? icon.value : null,
  };
}
