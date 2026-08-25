import { useCallback, useEffect, useRef, useState } from "react";
import { checklistFrom } from "./checklist-model";

// StackBlitz previews run on webcontainer hostnames; detecting that is how
// checklist item zero checks itself off (signed-in state is not detectable).
const IN_STACKBLITZ =
  typeof location !== "undefined" && /webcontainer|local-credentialless|stackblitz/i.test(location.hostname);
import { flowPhase } from "./flow";
import { Bank, Checklist, ConceptPanel, Dock, DocPanel, Note, PublishPanel, Working } from "./panels";
import { useStatus } from "./useStatus";
import { fetchLore, postAnnotate, postApprove, postClearDiscoveries, postConcept, postLoadMonster, postLoreRetry, postSparks, postSummonRetry, postAssetId, postDeployedUrl } from "../pipeline-client";
import * as THREE from "three";
import { Scene } from "../scene/Scene";
import { captureProbe } from "../scene/probe";
import type { WorkshopDoc } from "../../server/lore-schema";
import type { WorkshopStatus } from "../../server/status";
import { PATH_IDS, PATHS, type PathId } from "../../server/paths";
import { appendSpark, dealSparks, redealOne, type Spark } from "./sparks";
import type { SparkGroup } from "../../server/paths";
import type { Concept } from "../../server/state";

const GLB_URL = "/generated/monster.glb";
const ICON_URL = "/generated/icon.png";

// Rehearsal affordance, alongside ?demo-error. Bare ?demo-summon holds the
// stage in the summoning phase indefinitely; ?demo-summon=4 holds it for four
// seconds and then releases to the real phase, which plays the whole
// completion beat and the reveal flash without waiting on a generation.
const DEMO_SUMMON =
  typeof location !== "undefined" ? new URLSearchParams(location.search).get("demo-summon") : null;

interface ConceptState extends Pick<Concept, "id" | "prompt" | "imageUrl"> {
  rerolls: number;
}

const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** The approved concept's path: what is being (or was last) summoned. The
 * current BANK entry is wrong here -- during a summon it still names the
 * previous creature, which would put the wrong effect on the pedestal. */
function pathOfConcept(status: WorkshopStatus | null): PathId | null {
  const p = status?.approvedPath;
  return p && (PATH_IDS as readonly string[]).includes(p) ? (p as PathId) : null;
}

export function App(): React.ReactElement {
  // R3F hands these out once the canvas exists. The annotate probe needs the
  // renderer; nothing else reaches into the scene imperatively any more.
  const glRef = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const camRef = useRef<THREE.Camera | null>(null);
  const [lore, setLore] = useState<WorkshopDoc | null>(null);
  // The creation path for the NEXT sketch. The path of what is on the
  // pedestal travels with its document (doc.kind), not with this choice.
  const [pathChoice, setPathChoice] = useState<PathId>("monster");
  // Spark chips deal from a POOL. The static banks fill it instantly; the
  // sparks workflow refills it in the background with fresh LLM fragments, so
  // chips are never blocked on a network call and an unreachable fal (or a
  // missing key during setup) quietly leaves the banks in charge.
  const sparkPool = useRef<Record<PathId, SparkGroup[]>>({
    monster: PATHS.monster.sparks,
    product: PATHS.product.sparks,
    artifact: PATHS.artifact.sparks,
  });
  const [sparks, setSparks] = useState<Spark[]>(() => dealSparks(sparkPool.current.monster));
  const refillSparks = useCallback((id: PathId, shown: Spark[]): void => {
    void postSparks(id, shown.map((sp) => sp.text))
      .then(({ groups }) => { sparkPool.current[id] = groups; })
      .catch(() => undefined); // banks remain; silence is the feature
  }, []);
  useEffect(() => { refillSparks("monster", []); }, [refillSparks]);
  const choosePath = (id: PathId): void => {
    setPathChoice(id);
    const dealt = dealSparks(sparkPool.current[id]);
    setSparks(dealt);
    refillSparks(id, dealt);
  };
  const onSpark = (spark: Spark): void => {
    setPrompt((cur) => appendSpark(cur, spark.text));
    setSparks((cur) => cur.map((s) => (s === spark ? redealOne(sparkPool.current[pathChoice], spark) : s)));
  };
  const redealAll = (): void => {
    const dealt = dealSparks(sparkPool.current[pathChoice]);
    setSparks(dealt);
    // Each shuffle also asks for a fresh batch, so variety compounds over
    // the session instead of cycling the same twelve options.
    refillSparks(pathChoice, dealt);
  };
  const [pinned, setPinned] = useState<Set<string>>(() => new Set());
  const { status, error, refresh } = useStatus();
  const [prompt, setPrompt] = useState("");
  const [concept, setConcept] = useState<ConceptState | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ title: string; body: string } | null>(null);
  const [uploadedId, setUploadedId] = useState<string | null>(null);
  const [replayNonce, setReplayNonce] = useState(0);
  // A sketched concept that has not been summoned yet. At reveal this is what
  // tells the stage to show the new concept instead of the current monster's
  // codex, since the phase is still "reveal" until the summon starts.
  const [pendingConcept, setPendingConcept] = useState(false);
  // What the current wait is for. Set alongside busy so the indicator can
  // name the step instead of spinning anonymously.
  const [busyLabel, setBusyLabel] = useState("Working");

  const [demoHold, setDemoHold] = useState(DEMO_SUMMON !== null);
  useEffect(() => {
    const seconds = Number(DEMO_SUMMON);
    if (!seconds) return;
    const t = setTimeout(() => setDemoHold(false), seconds * 1000);
    return () => clearTimeout(t);
  }, []);
  // Visual only: no pipeline call is made or skipped.
  const phase = demoHold ? "summoning" : flowPhase(status);
  // Copy follows whichever path is in play: while sketching, the selector;
  // while summoning/revealed, the concept or document that owns the moment.
  const activePath = PATHS[pathChoice];
  const summonPath = PATHS[pathOfConcept(status) ?? pathChoice];
  const docPath = lore ? PATHS[lore.kind] : summonPath;
  const loreReady = status?.lore.ready ?? false;
  const modelReady = status?.model.status === "done";
  const assetId = uploadedId ?? status?.upload.assetId ?? null;

  useEffect(() => {
    // Rehearsal affordance: ?demo-error shows a sample error card so message
    // placement can be checked without breaking anything for real.
    if (new URLSearchParams(location.search).has("demo-error")) {
      setNote({ title: "That didn't work", body: "This is a sample error card for layout checks. The workflow was not called." });
    }
  }, []);
  useEffect(() => {
    if (error) setNote({ title: "The workshop server went quiet", body: `${error} Is npm run dev still running?` });
  }, [error]);

  useEffect(() => {
    if (phase !== "reveal") return;
    let cancelled = false;
    void (async () => {
      try {
        const doc = await fetchLore();
        if (!cancelled) setLore(doc);
      } catch (e) {
        if (!cancelled) setNote({ title: "The lore is missing", body: errText(e) });
      }
    })();
    return () => { cancelled = true; };
  }, [phase, loreReady, status?.currentMonsterId]);

  const run = useCallback(async (title: string, fn: () => Promise<void>, label = "Working"): Promise<void> => {
    setBusyLabel(label);
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
      const c = await postConcept(text, pathChoice);
      setConcept({ id: c.id, prompt: c.prompt, imageUrl: c.imageUrl, rerolls: (status?.concept.count ?? 0) + 1 });
      setPendingConcept(true);
    }, "Sketching your monster. This takes a few seconds.");
  };

  const onApprove = (): void => {
    if (!concept) return;
    void run("The summoning did not start", async () => {
      await postApprove(concept.id);
      setPendingConcept(false);
      setPinned(new Set());
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

  const [probing, setProbing] = useState(false);

  /** Clicking the creature: render the clicked spot, let vision name it, and
   * store the discovery. R3F reports the hit point through the mesh's own
   * onClick, so there is no raycasting or drag bookkeeping here, and drei's
   * OrbitControls owns the camera. */
  const onPickPoint = useCallback((point: THREE.Vector3, local: THREE.Vector3): void => {
    const gl = glRef.current;
    const scene = sceneRef.current;
    const cam = camRef.current;
    if (!gl || !scene || !cam || probing) return;
    const monster = scene.getObjectByName("monster-root");
    if (!monster) return;
    // Hide HUD cards and markers so the closeup frames only the creature.
    const hide: THREE.Object3D[] = [];
    scene.traverse((o) => { if (o.userData.hideInProbe === true) hide.push(o); });
    const shots = captureProbe(gl, scene, cam, monster, point, hide);
    if (!shots) return;
    setProbing(true);
    void (async () => {
      try {
        // Store the LOCAL point so the marker stays put on the spinning mount.
        await postAnnotate({ ...shots, point: [local.x, local.y, local.z] });
        refresh(); // the discovery returns through /api/status
      } catch (err) {
        setNote({ title: "That part stayed a mystery", body: errText(err) });
      } finally {
        setProbing(false);
      }
    })();
  }, [probing, refresh]);

  const onRetrySummon = (): void => {
    void run("The summoning would not restart", async () => {
      await postSummonRetry();
    }, "Restarting the summoning.");
  };

  const onLoadMonster = (id: string): void => {
    void run("That one would not come back", async () => {
      await postLoadMonster(id);
      setLore(null);        // refetched by the reveal effect for the new creature
      setPinned(new Set());
      setConcept(null);
      setPendingConcept(false);
    }, "Bringing it back to the pedestal.");
  };

  const onClearDiscoveries = (): void => {
    void run("The notes would not clear", async () => {
      await postClearDiscoveries();
      setPinned(new Set());
    });
  };

  const onHotspotClick = useCallback((id: string): void => {
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const onCanvasReady = useCallback((gl: THREE.WebGLRenderer, scene: THREE.Scene, cam: THREE.Camera): void => {
    glRef.current = gl;
    sceneRef.current = scene;
    camRef.current = cam;
    // Dev affordance: lets tooling inspect the live scene graph.
    (window as unknown as { __scene?: THREE.Scene }).__scene = scene;
  }, []);

  return (
    <>
      <Scene
        phase={phase}
        pathId={pathOfConcept(status) ?? pathChoice}
        docKind={lore?.kind ?? pathOfConcept(status) ?? "monster"}
        replayNonce={replayNonce}
        status={status}
        monsterUrl={modelReady ? `${GLB_URL}?v=${status?.currentMonsterId ?? "0"}` : null}
        pinned={pinned}
        onPickPoint={onPickPoint}
        onHotspotClick={onHotspotClick}
        onCanvasReady={onCanvasReady}
      />
      <Dock side="left">
        <Checklist phases={checklistFrom(status, { inStackBlitz: IN_STACKBLITZ })} />
        <Bank entries={status?.monsters ?? []} busy={busy} onLoad={onLoadMonster} />
      </Dock>

      <Dock side="right">
        {phase === "reveal" && lore && !pendingConcept
          ? <DocPanel doc={lore} iconUrl={ICON_URL} />
          : concept && <ConceptPanel concept={concept} />}
        {phase === "reveal" && !assetId && (
          <PublishPanel
            glbHref={GLB_URL}
            portalHref="https://app.miris.com"
            assetId={assetIdDraft}
            onAssetIdChange={setAssetIdDraft}
            onSave={onSaveAssetId}
            busy={busy}
          />
        )}
      </Dock>

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
          {phase === "create" && activePath.copy.kickerCreate}
          {phase === "summoning" && summonPath.copy.kickerSummoning}
          {phase === "reveal" && docPath.copy.kickerReveal}
        </p>
      </header>

      <div className="overlay">
        {note && <Note note={note} onDismiss={() => setNote(null)} />}
        {busy && <Working label={busyLabel} />}

        {phase === "setup" && (
          <p className="hint">Add your fal key to .env and this panel wakes up on its own. Stuck? Run npm run doctor in the terminal.</p>
        )}

        {(phase === "create" || (phase === "reveal" && !pendingConcept)) && (
          <>
            <div className="row path-row" role="radiogroup" aria-label="Creation path">
              {PATH_IDS.map((id) => (
                <button
                  key={id}
                  className="path-chip"
                  role="radio"
                  aria-checked={pathChoice === id}
                  data-active={pathChoice === id || undefined}
                  disabled={busy}
                  onClick={() => choosePath(id)}
                >
                  {PATHS[id].copy.label}
                </button>
              ))}
            </div>
            <div className="row spark-row" aria-label="Prompt sparks">
              {sparks.map((sp) => (
                <button
                  key={`${sp.group}:${sp.text}`}
                  className="spark-chip"
                  disabled={busy}
                  title={`Add: ${sp.text}`}
                  onClick={() => onSpark(sp)}
                >
                  <span className="spark-plus" aria-hidden="true">+</span>
                  {sp.text}
                </button>
              ))}
              <button
                className="spark-redeal"
                disabled={busy}
                aria-label="New sparks"
                title="New sparks"
                onClick={redealAll}
              >
                ↻
              </button>
            </div>
            <div className="row">
              <input
                className="prompt"
                value={prompt}
                placeholder={phase === "reveal" ? activePath.copy.placeholderAgain : activePath.copy.placeholder}
                disabled={busy}
                onChange={(e) => setPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") onGenerate(); }}
              />
              <button className="btn primary" disabled={busy || !prompt.trim()} onClick={onGenerate}>
                {busy ? "Sketching" : phase === "reveal" ? activePath.copy.sketchAgainButton : activePath.copy.sketchButton}
              </button>
            </div>
          </>
        )}

        {(phase === "create" || pendingConcept) && concept && (
          <div className="row">
            <button className="btn" disabled={busy} onClick={onGenerate}>Reroll</button>
            <button className="btn primary" disabled={busy} onClick={onApprove}>{activePath.copy.approveButton}</button>
          </div>
        )}

        {phase === "summoning" && (
          <p className="hint">
            {status?.model.stage
              ? `${status.model.stage}. Ultra detail takes several minutes.`
              : summonPath.copy.summoningHint}
          </p>
        )}

        {/* A summon that died (a timeout, a fal hiccup) must not strand the
            attendee: the concept is already paid for, so offer to relaunch it
            rather than sending them back to sketch from scratch. */}
        {phase === "create" && status?.model.status === "failed" && (
          <div className="row">
            <p className="hint">The summoning failed: {status.model.error?.replace(/^Error:\s*/, "")}</p>
            <button className="btn primary" disabled={busy} onClick={onRetrySummon}>Retry the summoning</button>
          </div>
        )}

        {(phase === "summoning" || phase === "reveal") && status?.lore.status === "failed" && (
          <div className="row">
            <p className="hint">The lore did not come through.</p>
            <button className="btn" disabled={busy} onClick={onRetryLore}>Retry lore</button>
          </div>
        )}

        {phase === "reveal" && !pendingConcept && (
          <div className="row">
            <p className="hint">
              {probing
                ? "Looking closely at that part..."
                : (status?.discoveries.length ?? 0) === 0
                  ? docPath.copy.discoverHint
                  : `${status?.discoveries.length} discovered. Keep clicking, or hover a marker to read it.`}
            </p>
            <button className="btn quiet" onClick={() => setReplayNonce((n) => n + 1)}>Replay the summoning</button>
            {(status?.discoveries.length ?? 0) > 0 && (
              <button className="btn quiet" disabled={busy} onClick={onClearDiscoveries}>Clear notes</button>
            )}
          </div>
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
    </>
  );
}
