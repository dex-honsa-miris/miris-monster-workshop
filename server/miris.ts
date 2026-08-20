// !! CONTRACT UNCONFIRMED: paths, multipart field names, and the status
// vocabulary below are a working guess and MUST be confirmed against the real
// Miris API before the workshop. Fix them HERE and in test/miris.test.ts in
// the same commit; nothing else in the repo knows these details.
import { createHash } from "node:crypto";
import { patchState, readState } from "./state";

export interface MirisDeps { token: string; base: string; fetch: typeof fetch }

export async function uploadGlb(glb: ArrayBuffer, name: string, deps: MirisDeps): Promise<{ assetId: string; reused: boolean }> {
  const sha = createHash("sha256").update(Buffer.from(glb)).digest("hex");
  const cur = await readState();
  if (cur.upload.glbSha === sha && cur.upload.assetId) return { assetId: cur.upload.assetId, reused: true };

  const form = new FormData();
  form.append("file", new Blob([glb], { type: "model/gltf-binary" }), `${name}.glb`);
  form.append("name", name);
  const r = await deps.fetch(`${deps.base}/v1/assets`, {
    method: "POST",
    headers: { Authorization: `Bearer ${deps.token}` },
    body: form,
  });
  if (!r.ok) throw new Error(`Miris upload failed: ${r.status}`);
  const out = (await r.json()) as { asset_id: string };
  await patchState({ upload: { glbSha: sha, assetId: out.asset_id, state: "processing", error: null } });
  return { assetId: out.asset_id, reused: false };
}

export async function assetStatus(assetId: string, deps: MirisDeps): Promise<"processing" | "ready" | "failed"> {
  const r = await deps.fetch(`${deps.base}/v1/assets/${assetId}`, { headers: { Authorization: `Bearer ${deps.token}` } });
  if (!r.ok) throw new Error(`Miris status failed: ${r.status}`);
  const { status } = (await r.json()) as { status: string };
  if (status === "ready" || status === "complete") return "ready";
  if (status === "failed" || status === "error") return "failed";
  return "processing";
}
