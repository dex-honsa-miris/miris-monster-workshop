import { buildConceptPrompt } from "./guardrails";

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
