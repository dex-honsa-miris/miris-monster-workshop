export interface ProbeResult { ok: boolean; detail: string }
export interface KeyStatus { present: boolean; valid: boolean | null; detail: string }

export const MIRIS_ME_PATH = "/v1/me"; // confirm with the ingest contract (server/miris.ts)

const net = (e: unknown): ProbeResult => ({ ok: false, detail: `network error: ${String(e)}` });

export async function probeFal(key: string, f: typeof fetch): Promise<ProbeResult> {
  try {
    const r = await f("https://queue.fal.run/fal-ai/flux/schnell/requests/00000000-0000-0000-0000-000000000000/status", {
      headers: { Authorization: `Key ${key}` },
    });
    if (r.status === 401 || r.status === 403) return { ok: false, detail: "fal rejected the key" };
    return { ok: true, detail: "key accepted (balance is visible on the fal dashboard)" };
  } catch (e) { return net(e); }
}

export async function probeGateway(key: string, f: typeof fetch): Promise<ProbeResult> {
  try {
    const r = await f("https://ai-gateway.vercel.sh/v1/models", { headers: { Authorization: `Bearer ${key}` } });
    return r.status === 200 ? { ok: true, detail: "gateway key accepted" } : { ok: false, detail: `gateway said ${r.status}` };
  } catch (e) { return net(e); }
}

export async function probeMiris(token: string, base: string, f: typeof fetch): Promise<ProbeResult> {
  try {
    const r = await f(`${base}${MIRIS_ME_PATH}`, { headers: { Authorization: `Bearer ${token}` } });
    return r.status === 200 ? { ok: true, detail: "Miris token accepted" } : { ok: false, detail: `Miris said ${r.status}` };
  } catch (e) { return net(e); }
}
