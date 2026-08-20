import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { checklistFrom } from "./checklist-model";
import { flowPhase } from "./flow";
import { useStatus } from "./useStatus";
import { fetchLore, postApprove, postConcept, postLoreRetry, postUpload } from "../pipeline-client";
import { SceneDirector } from "../scene/director";
import type { Concept } from "../../server/state";

const GLB_URL = "/generated/monster.glb";

interface ConceptState extends Pick<Concept, "id" | "prompt" | "imageUrl"> {
  rerolls: number;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

export function App(): JSX.Element {
  const mountRef = useRef<HTMLDivElement>(null);
  const directorRef = useRef<SceneDirector | null>(null);
  const dragRef = useRef<number | null>(null);
  const { status, error, refresh } = useStatus();
  const [prompt, setPrompt] = useState("");
  const [concept, setConcept] = useState<ConceptState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ title: string; body: string } | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);

  const phase = flowPhase(status);
  const loreReady = status?.lore.ready ?? false;
  const modelReady = status?.model.status === "done";
  const assetId = uploadedId ?? status?.upload.assetId ?? null;

  useEffect(() => {
    const director = new SceneDirector(mountRef.current!);
    directorRef.current = director;
    return () => {
      directorRef.current = null;
      director.dispose();
    };
  }, []);

  useEffect(() => { directorRef.current?.showPhase(phase); }, [phase]);
  useEffect(() => { directorRef.current?.showChecklist(checklistFrom(status)); }, [status]);
  useEffect(() => { directorRef.current?.setRitualBusy(busy || phase === "summoning"); }, [busy, phase]);
  useEffect(() => { directorRef.current?.showMessage(note); }, [note]);
  useEffect(() => {
    if (concept) directorRef.current?.showConcept(concept);
  }, [concept]);
  useEffect(() => {
    if (error) setNote({ title: "The workshop server went quiet", body: `${error} Is npm run dev still running?` });
  }, [error]);

  useEffect(() => {
    if (phase !== "reveal") return;
    let cancelled = false;
    void (async () => {
      try {
        const lore = await fetchLore();
        if (cancelled) return;
        await directorRef.current?.revealMonster(GLB_URL, lore);
      } catch (e) {
        if (!cancelled) setNote({ title: "The lore is missing", body: errText(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [phase, loreReady]);

  const run = useCallback(async (title: string, fn: () => Promise<void>): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      setNote(null);
    } catch (e) {
      setNote({ title, body: errText(e) });
    } finally {
      setBusy(false);
      refresh();
    }
  }, [refresh]);

  const onGenerate = (): void => {
    const text = prompt.trim();
    if (!text) return;
    void run("That concept did not come through", async () => {
      const c = await postConcept(text);
      setConcept({ id: c.id, prompt: c.prompt, imageUrl: c.imageUrl, rerolls: (status?.concept.count ?? 0) + 1 });
    });
  };

  const onApprove = (): void => {
    if (!concept) return;
    void run("The summoning did not start", async () => {
      await postApprove(concept.id);
      directorRef.current?.setRitualBusy(true);
    });
  };

  const onUpload = (): void => {
    void run("The upload did not go through", async () => {
      const r = await postUpload();
      setUploadedId(r.assetId);
    });
  };

  const onRetryLore = (): void => {
    void run("The lore retry did not start", async () => {
      await postLoreRetry();
    });
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if ((e.target as HTMLElement).closest(".overlay")) return;
    dragRef.current = e.clientX;
    // Capture keeps the drag alive past the window edge; a synthetic or
    // already-released pointer id throws, and a dragless page is fine.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no capture, still draggable */ }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (dragRef.current === null) return;
    directorRef.current?.applyOrbitDelta(e.clientX - dragRef.current);
    dragRef.current = e.clientX;
  };
  const endDrag = (): void => { dragRef.current = null; };

  return (
    <div
      id="stage-mount"
      ref={mountRef}
      style={{ position: "fixed", inset: 0 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onLostPointerCapture={endDrag}
    >
      <div className="overlay">
        {phase === "setup" && (
          <p className="hint">Add your three keys to .env, then run npm run doctor. This panel wakes up on its own.</p>
        )}

        {phase === "create" && (
          <div className="row">
            <input
              className="prompt"
              value={prompt}
              placeholder="A moss-covered lantern beast with too many eyes"
              disabled={busy}
              onChange={(e) => setPrompt(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") onGenerate(); }}
            />
            <button className="btn primary" disabled={busy || !prompt.trim()} onClick={onGenerate}>
              {busy ? "Working" : "Generate"}
            </button>
          </div>
        )}

        {phase === "create" && concept && (
          <div className="row">
            <button className="btn" disabled={busy} onClick={onGenerate}>Reroll</button>
            <button className="btn primary" disabled={busy} onClick={onApprove}>Approve</button>
          </div>
        )}

        {phase === "summoning" && <p className="hint">Summoning your monster. This takes a minute or two.</p>}

        {(phase === "summoning" || phase === "reveal") && status?.lore.status === "failed" && (
          <div className="row">
            <p className="hint">The lore did not come through.</p>
            <button className="btn" disabled={busy} onClick={onRetryLore}>Retry lore</button>
          </div>
        )}

        {phase === "reveal" && !assetId && (
          <div className="row">
            <button className="btn primary" disabled={busy || !modelReady || !loreReady} onClick={onUpload}>
              {busy ? "Uploading" : "Upload to Miris"}
            </button>
          </div>
        )}

        {assetId && (
          <div className="banner">
            <span className="banner-label">Asset</span>
            <code>{assetId}</code>
            <span>is with Miris. Last step: run</span>
            <code>npm run deploy</code>
            <span>in the terminal.</span>
          </div>
        )}
      </div>
    </div>
  );
}
