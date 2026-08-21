import { useCallback, useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { checklistFrom } from "./checklist-model";

// StackBlitz previews run on webcontainer hostnames; detecting that is how
// checklist item zero checks itself off (signed-in state is not detectable).
const IN_STACKBLITZ =
  typeof location !== "undefined" && /webcontainer|local-credentialless|stackblitz/i.test(location.hostname);
import { flowPhase } from "./flow";
import { useStatus } from "./useStatus";
import { fetchLore, postApprove, postConcept, postLoreRetry, postAssetId, postDeployedUrl } from "../pipeline-client";
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
  useEffect(() => { directorRef.current?.showChecklist(checklistFrom(status, { inStackBlitz: IN_STACKBLITZ })); }, [status]);
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

  const [assetIdDraft, setAssetIdDraft] = useState("");
  const [liveUrlDraft, setLiveUrlDraft] = useState("");
  const deployedUrl = status?.deployment.url ?? null;
  const onSaveLiveUrl = (): void => {
    const url = liveUrlDraft.trim();
    if (!url) return;
    void run("That link was not accepted", async () => {
      await postDeployedUrl(url);
    });
  };
  const onSaveAssetId = (): void => {
    const id = assetIdDraft.trim();
    if (!id) return;
    void run("That asset id was not accepted", async () => {
      const r = await postAssetId(id);
      setUploadedId(r.assetId);
    });
  };

  const onRetryLore = (): void => {
    void run("The lore retry did not start", async () => {
      await postLoreRetry();
    });
  };

  const movedRef = useRef(0);
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>): void => {
    movedRef.current = 0;
    if ((e.target as HTMLElement).closest(".overlay")) return;
    dragRef.current = e.clientX;
    // Capture keeps the drag alive past the window edge; a synthetic or
    // already-released pointer id throws, and a dragless page is fine.
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no capture, still draggable */ }
  };
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>): void => {
    directorRef.current?.pointerMove(e.clientX, e.clientY);
    if (dragRef.current === null) return;
    movedRef.current += Math.abs(e.clientX - dragRef.current);
    directorRef.current?.applyOrbitDelta(e.clientX - dragRef.current);
    dragRef.current = e.clientX;
  };
  const endDrag = (e?: ReactPointerEvent<HTMLDivElement>): void => {
    // A press that never really moved is a tap; the scene may consume it
    // (checklist rows open their dashboards).
    if (e && dragRef.current !== null && movedRef.current < 6) directorRef.current?.tap(e.clientX, e.clientY);
    dragRef.current = null;
  };

  return (
    <div
      id="stage-mount"
      ref={mountRef}
      style={{ position: "fixed", inset: 0 }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => endDrag(e)}
      onPointerCancel={() => endDrag()}
      onLostPointerCapture={endDrag}
    >
      <header
        className="masthead"
        data-compact={phase === "summoning" || phase === "reveal" ? "true" : undefined}
        data-busy={phase === "summoning" ? "true" : undefined}
      >
        <svg className="lockup" viewBox="0 0 976 272" role="img" aria-label="Miris">
          <path d="M920 152h-32c-8.82 0-16-7.18-16-16s7.18-16 16-16h72V88h-72c-26.47 0-48 21.53-48 48s21.53 48 48 48h32c8.82 0 16 7.18 16 16s-7.18 16-16 16h-80v32h80c26.47 0 48-21.53 48-48s-21.53-48-48-48M784 88h32v160h-32zm-168 0h32v160h-32zM479.1 200h-14.2L392 24h-32v224h32V120h5.5l53.01 128h42.98l53.01-128h5.5v128h32V24h-32zM616 24h32v32h-32zm168 0h32v32h-32zm-64.12 68.94L712 112l-9.94-24H680v160h32V136c0-8.84 7.16-16 16-16h36V88h-36.72c-3.24 0-6.16 1.96-7.4 4.94M114.51 264h42.98L184 200H88zm44.35-176L192 8H80l33.14 80zM184 200h80V72h-26.98zM8 72v128h80L34.98 72z" />
        </svg>
        <h1 className="masthead-title">Monster Workshop</h1>
        <p className="masthead-kicker">
          {phase === "setup" && "First, the keys"}
          {phase === "create" && "Describe your monster"}
          {phase === "summoning" && "The summoning"}
          {phase === "reveal" && "Your monster"}
        </p>
      </header>

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
              {busy ? "Sketching" : "Sketch it"}
            </button>
          </div>
        )}

        {phase === "create" && concept && (
          <div className="row">
            <button className="btn" disabled={busy} onClick={onGenerate}>Reroll</button>
            <button className="btn primary" disabled={busy} onClick={onApprove}>Summon this one</button>
          </div>
        )}

        {phase === "summoning" && <p className="hint">Summoning your monster. A minute or two.</p>}

        {(phase === "summoning" || phase === "reveal") && status?.lore.status === "failed" && (
          <div className="row">
            <p className="hint">The lore did not come through.</p>
            <button className="btn" disabled={busy} onClick={onRetryLore}>Retry lore</button>
          </div>
        )}

        {phase === "reveal" && !assetId && (
          <>
            <p className="hint">
              Publish it: download the model, upload it in the Miris portal under your account, then paste the asset id here.
            </p>
            <div className="row">
              <a className="btn" href="/generated/monster.glb" download="monster.glb">Download monster.glb</a>
              <a className="btn" href="https://app.miris.com" target="_blank" rel="noopener">Open the Miris portal</a>
            </div>
            <div className="row">
              <input
                className="prompt"
                value={assetIdDraft}
                placeholder="Paste your Miris asset id"
                disabled={busy}
                onChange={(e) => setAssetIdDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onSaveAssetId(); }}
              />
              <button className="btn primary" disabled={busy || !assetIdDraft.trim()} onClick={onSaveAssetId}>
                {busy ? "Saving" : "Save asset id"}
              </button>
            </div>
          </>
        )}

        {assetId && !deployedUrl && (
          <>
            <div className="banner">
              <span className="banner-label">Asset</span>
              <code>{assetId}</code>
              <span>is with Miris. Run</span>
              <code>npm run deploy</code>
              <span>in the terminal, then press Deploy in bolt.new.</span>
            </div>
            <div className="row">
              <input
                className="prompt"
                value={liveUrlDraft}
                placeholder="Paste your live link from Bolt"
                disabled={busy}
                onChange={(e) => setLiveUrlDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onSaveLiveUrl(); }}
              />
              <button className="btn primary" disabled={busy || !liveUrlDraft.trim()} onClick={onSaveLiveUrl}>
                {busy ? "Saving" : "Save link"}
              </button>
            </div>
          </>
        )}

        {assetId && deployedUrl && (
          <div className="banner">
            <span className="banner-label">Live</span>
            <span>Your monster is on the internet:</span>
            <a href={deployedUrl} target="_blank" rel="noopener"><code>{deployedUrl}</code></a>
          </div>
        )}
      </div>
    </div>
  );
}
