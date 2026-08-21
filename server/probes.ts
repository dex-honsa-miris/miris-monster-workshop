export interface ProbeResult { ok: boolean; detail: string }
export interface KeyStatus { present: boolean; valid: boolean | null; detail: string }

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
