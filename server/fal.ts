import { buildConceptPrompt, buildIconPrompt, sanitizeUserPrompt } from "./guardrails";
import { discoverySchema, safeParseDoc, type Discovery, type WorkshopDoc } from "./lore-schema";
import { PATHS, type PathSpec } from "./paths";

export interface FalDeps {
  key: string;
  fetch: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Use the workflow SSE endpoint for per-node progress events. Off by
   * default so tests (which script plain JSON responses) keep the queue
   * path; the live server turns it on. */
  stream?: boolean;
}

/** One event from a workflow SSE stream. fal emits `submit` and `completion`
 * per node, then a final `output` carrying the workflow result. */
export interface WorkflowEvent { type: string; node_id?: string; output?: unknown; error?: unknown }

const POLL_MS = 1500;
/** Default wait for a queued job: image and LLM legs finish well inside it. */
const TIMEOUT_MS = 6 * 60 * 1000;
/** The 3D stage runs ultra_mode at 150k quad polys, which routinely takes
 * longer than the default window. The old 6-minute cap was tuned for 30k
 * standard generations, and once ultra went live it abandoned jobs that were
 * still working -- billed, completed, and thrown away. */
const TIMEOUT_3D_MS = 25 * 60 * 1000;
const MODEL_IMAGE = "fal-ai/flux/schnell";
// Meshy v7 (chosen 2026-08-21 over Trellis): game-asset topology, matte
// output (metallic 0, roughness 0.8 measured), texture_prompt steering.
const MODEL_3D = "meshy/v7/image-to-3d";
const MESHY_INPUT = {
  should_texture: true,
  should_remesh: true,
  enable_pbr: false, // no metallic/roughness maps: keeps monsters matte
  model_type: "standard",
  topology: "quad",
  target_polycount: 24_000,
  symmetry_mode: "auto",
  enable_safety_checker: true,
} as const;

const wait = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Run a fal workflow over its SSE endpoint, surfacing per-node events.
 *
 * This is the only place fal exposes ANY progress: the queue status endpoint
 * reports a bare IN_PROGRESS for both apps and workflows (verified
 * empirically, logs=1 included), and Meshy's own percentage is swallowed
 * entirely. Node submit/completion events at least mark real milestones.
 * Mind the separators: events arrive delimited by CRLF pairs, and keepalive
 * comments (": ping") every 15s.
 */
export async function falWorkflowStream(
  workflowId: string,
  input: unknown,
  deps: FalDeps,
  onEvent?: (e: WorkflowEvent) => void,
  timeoutMs = TIMEOUT_3D_MS,
): Promise<unknown> {
  const res = await deps.fetch(`https://fal.run/${workflowId}/stream`, {
    method: "POST",
    headers: { Authorization: `Key ${deps.key}`, "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify(input),
  });
  if (!res.ok || !res.body) throw new Error(`fal stream failed: ${res.status}`);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const deadline = Date.now() + timeoutMs;
  let buf = "";
  let output: unknown;
  let sawOutput = false;
  for (;;) {
    if (Date.now() > deadline) {
      await reader.cancel().catch(() => undefined);
      throw new Error(`fal job timed out after ${Math.round(timeoutMs / 60000)} minutes`);
    }
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    for (;;) {
      const m = buf.match(/\r?\n\r?\n/);
      if (!m) break;
      const chunk = buf.slice(0, m.index);
      buf = buf.slice(m.index! + m[0].length);
      const data = chunk
        .split(/\r?\n/)
        .filter((l) => l.startsWith("data:"))
        .map((l) => l.slice(5).trim())
        .join("");
      if (!data) continue; // keepalive comment
      let ev: WorkflowEvent;
      try { ev = JSON.parse(data) as WorkflowEvent; } catch { continue; }
      onEvent?.(ev);
      if (ev.type === "error") throw new Error(`fal workflow error: ${JSON.stringify(ev.error ?? ev).slice(0, 300)}`);
      if (ev.type === "output") { output = ev.output; sawOutput = true; }
    }
  }
  if (!sawOutput) throw new Error("fal stream ended without an output event");
  return output;
}

export async function falQueue(
  model: string,
  body: unknown,
  deps: FalDeps,
  onProgress?: (p: { status: string }) => void,
  timeoutMs = TIMEOUT_MS,
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
    if (elapsed >= timeoutMs) throw new Error(`fal job timed out after ${Math.round(timeoutMs / 60000)} minutes`);
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
  userText = "",
): Promise<{ glb: ArrayBuffer }> {
  const out = (await falQueue(MODEL_3D, { image_url: imageUrl, texture_prompt: userText, ...MESHY_INPUT }, deps, onProgress, TIMEOUT_3D_MS)) as {
    model_glb?: { url?: string };
    model_mesh?: { url?: string };
  };
  const meshUrl = out.model_glb?.url ?? out.model_mesh?.url;
  if (!meshUrl) throw new Error("fal returned no mesh");
  const dl = await deps.fetch(meshUrl, { headers: { Authorization: `Key ${deps.key}` } });
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

// The public Miris workflows (built 2026-08-21, verified end to end). Both
// are public on the fal account, so attendees run them with their own key.
export const SKETCH_WORKFLOW = "workflows/dexhonsa/miris-monster-sketch";
export const MANIFEST_WORKFLOW = "workflows/dexhonsa/miris-monster-manifest";

const MODEL_LLM = "fal-ai/any-llm";
// The lore document is the attendee's keepsake, so it gets the better model.
// A/B on identical prompts (2026-08-21): gemini-flash-1.5 named a storm
// axolotl "Axolotl the Sparktail" with 2 abilities; claude-haiku-4.5 returned
// "Zephyrmite the Giggling Storm" with 3 sharper ones, for 3 extra seconds
// that hide inside the ~145s Meshy wait. gpt-5-mini returned unparseable
// output and was rejected.
const LORE_MODEL = "anthropic/claude-haiku-4.5";
// The workflows' utility legs (prompt shaping, icon prompt) stay on
// google/gemini-flash-1.5: the shaper runs on EVERY reroll and its output is
// just a prompt string. The direct path here uses the static buildIconPrompt
// template instead, so it needs no utility model.

function firstImageUrl(o: Record<string, unknown>): string | null {
  return (
    (typeof o.image_url === "string" && o.image_url) ||
    ((o.image as { url?: string } | undefined)?.url ?? null) ||
    ((o.images as Array<{ url?: string }> | undefined)?.[0]?.url ?? null)
  );
}

/** Meshy caps texture_prompt at 600 characters. */
const TEXTURE_PROMPT_MAX = 600;

export function trimTexturePrompt(text: string): string {
  const clean = text.trim().replace(/\s+/g, " ");
  if (clean.length <= TEXTURE_PROMPT_MAX) return clean;
  // Cut on a sentence or clause boundary so the tail is not a half word.
  const cut = clean.slice(0, TEXTURE_PROMPT_MAX);
  const stop = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf(", "), cut.lastIndexOf(" "));
  return (stop > TEXTURE_PROMPT_MAX * 0.6 ? cut.slice(0, stop) : cut).trim();
}

export function parseSketchOutput(raw: unknown): { imageUrl: string; styledPrompt: string | null } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const url = firstImageUrl(o);
  if (!url) throw new Error("workflow returned no image (expected image_url, image.url, or images[0].url)");
  // The shaper's output: the art-direction paragraph that produced the image.
  // The texturing stage wants it too, and until now it was being discarded.
  const styled = typeof o.styled_prompt === "string" ? o.styled_prompt.trim() : "";
  return { imageUrl: url, styledPrompt: styled || null };
}

export function parseManifestOutput(raw: unknown): { modelUrl: string; lore: WorkshopDoc | null; iconUrl: string | null } {
  const o = (raw ?? {}) as Record<string, unknown>;
  const modelUrl =
    (typeof o.model_url === "string" && o.model_url) ||
    ((o.model_glb as { url?: string } | undefined)?.url ?? null) || // meshy v7
    ((o.model_mesh as { url?: string } | undefined)?.url ?? null) || // trellis
    ((o.model as { url?: string } | undefined)?.url ?? null);
  if (!modelUrl) throw new Error("workflow returned no model (expected model_url, model_glb.url, model_mesh.url, or model.url)");
  let lore: WorkshopDoc | null = null;
  for (const key of ["lore", "details", "monster"]) {
    const parsed = safeParseDoc(typeof o[key] === "string" ? tryJson(o[key] as string) : o[key]);
    if (parsed.success) { lore = parsed.data; break; }
  }
  const iconUrl = (typeof o.icon_url === "string" && o.icon_url) || ((o.icon as { url?: string } | undefined)?.url ?? null);
  return { modelUrl: modelUrl as string, lore, iconUrl };
}

function tryJson(text: string): unknown {
  try { return JSON.parse(text.replace(/^```(json)?|```$/gm, "").trim()); } catch { return null; }
}

/** The lore leg alone (used by the direct manifest path and by lore retry). */
export async function generateLoreLLM(
  userText: string,
  deps: FalDeps,
  path: PathSpec = PATHS.monster,
): Promise<WorkshopDoc | null> {
  const out = (await falQueue(MODEL_LLM, {
    model: LORE_MODEL,
    system_prompt: path.docSystem,
    prompt: path.directDocPrompt(sanitizeUserPrompt(userText)),
  }, deps)) as { output?: string; text?: string };
  const parsed = safeParseDoc(tryJson(out.output ?? out.text ?? ""));
  return parsed.success ? parsed.data : null;
}

export async function sketchMonster(
  userText: string,
  deps: FalDeps,
  workflowId?: string,
  path: PathSpec = PATHS.monster,
): Promise<{ imageUrl: string; styledPrompt: string | null }> {
  if (workflowId) {
    // The shaper's style bible travels with the request: one workflow, three
    // paths, and the prompt text lives in the repo instead of the editor.
    const out = await falQueue(workflowId, {
      prompt: sanitizeUserPrompt(userText),
      shaper_system: path.shaperSystem,
    }, deps);
    return parseSketchOutput(out);
  }
  return { ...(await generateConcept(userText, deps)), styledPrompt: null };
}

export interface Manifest { glb: ArrayBuffer; lore: WorkshopDoc | null; iconPng: ArrayBuffer | null }

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
  onProgress?: (p: { status: string; node?: string; event?: string }) => void,
  /** The shaper's art-direction paragraph. Sent separately from `prompt`,
   * which still carries the player's own words: the lore and emblem legs read
   * that, and they should describe the creature the player asked for, not the
   * image prompt that drew it. */
  texturePrompt?: string | null,
  path: PathSpec = PATHS.monster,
): Promise<Manifest> {
  if (workflowId) {
    const input: Record<string, unknown> = {
      prompt: sanitizeUserPrompt(userText),
      image_url: imageUrl,
      doc_system: path.docSystem,
      icon_system: path.iconSystem,
    };
    if (texturePrompt) input.texture_prompt = trimTexturePrompt(texturePrompt);
    // The workflow's slowest leg is the 3D node, so the whole run gets the
    // 3D window. Streamed when enabled (real milestones), queued otherwise.
    const out = deps.stream
      ? await falWorkflowStream(workflowId, input, deps, (e) => {
          if (e.type === "submit" || e.type === "completion") {
            onProgress?.({ status: "IN_PROGRESS", node: e.node_id, event: e.type });
          }
        }, TIMEOUT_3D_MS)
      : await falQueue(workflowId, input, deps, onProgress, TIMEOUT_3D_MS);
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
    generateLoreLLM(userText, deps, path),
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

// --- Click to annotate (vision) ----------------------------------------------
// fal-ai/any-llm/vision accepts data URIs in image_urls, so the browser's
// rendered closeup goes straight through with no upload step (verified
// 2026-08-21 with a 122KB JPEG data URI).
const VISION_MODEL = "anthropic/claude-haiku-4.5";

export async function annotateFeature(
  input: { closeup: string; context: string; lore: WorkshopDoc },
  deps: FalDeps,
): Promise<Discovery> {
  const path = PATHS[input.lore.kind];
  const identity = path.annotateIdentity({
    name: input.lore.name,
    description: "lore" in input.lore ? input.lore.lore : input.lore.description,
  });
  const out = (await falQueue("fal-ai/any-llm/vision", {
    model: VISION_MODEL,
    image_urls: [input.closeup, input.context],
    system_prompt: path.annotateSystem,
    prompt: `${identity}\nAnnotate the part centered in the closeup.`,
  }, deps)) as { output?: string; text?: string };
  const parsed = discoverySchema.safeParse(tryJson(out.output ?? out.text ?? ""));
  if (!parsed.success) throw new Error("the model did not return a usable annotation");
  return parsed.data;
}
