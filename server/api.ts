import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { annotateFeature, generateLoreLLM, manifestMonster, MANIFEST_WORKFLOW, sketchMonster, SKETCH_WORKFLOW } from "./fal";
import { probeFal } from "./probes";
import { patchState, readState, workshopDir, type MonsterRecord } from "./state";
import { buildStatus } from "./status";
import { matteGlb, smoothGlb } from "./mesh-smooth";
import { pathOf } from "./paths";
import { parseDoc } from "./lore-schema";
import { deploymentRecord } from "./deploy-core";
import { workshopEnv } from "./env";

type Handler = (body: Record<string, unknown>) => Promise<{ status: number; json: unknown }>;

const env = () => workshopEnv();
const sketchWorkflow = () => env().FAL_SKETCH_WORKFLOW || SKETCH_WORKFLOW;
const manifestWorkflow = () => env().FAL_MANIFEST_WORKFLOW || MANIFEST_WORKFLOW;
const glbFile = () => join(workshopDir(), "monster.glb");
const loreFile = () => join(workshopDir(), "lore.json");
const deployFile = () => join(workshopDir(), "deployment.json");
/** Where a summoned creature is kept so it can be brought back later. The
 * files under public/generated are the CURRENT one; these are the originals. */
const monsterDir = (id: string) => join(workshopDir(), "monsters", id);
const publicGenerated = () => join(process.cwd(), "public", "generated");
/** Bank thumbnails are served statically rather than through a route, because
 * the router matches whole paths and cannot carry an id. */
const bankIcon = (id: string) => join(publicGenerated(), "bank", `${id}.png`);

const hintFor = (e: unknown): string => {
  const msg = String(e);
  if (msg.includes("402")) return "Your fal balance may be empty. Check the fal dashboard, or the coupon step in the itinerary.";
  if (msg.includes("401") || msg.includes("403")) return "Your fal key was rejected. Re-check FAL_KEY in .env, then run npm run doctor.";
  if (msg.includes("timed out")) return "The generation service is slow right now. Try again.";
  if (msg.includes("no image")) return "The workflow finished but returned no image. Tell the presenter; the workflow output contract may have changed.";
  return "Run npm run doctor in the terminal for a credential check.";
};

/** Adopt a monster that was summoned before the bank existed.
 *
 * Runs once: as soon as it writes a record the guard stops matching. Without
 * it the creature already on the pedestal is the one creature missing from
 * the list of creatures, which reads as a bug rather than as history. */
async function adoptCurrentMonster(): Promise<void> {
  const s = await readState();
  if (s.monsters.length > 0 || !existsSync(glbFile()) || !existsSync(loreFile())) return;
  const lore = parseDoc(JSON.parse(await readFile(loreFile(), "utf8")));
  const id = s.approvedConceptId ?? "adopted";
  const dir = monsterDir(id);
  await mkdir(dir, { recursive: true });
  await mkdir(join(publicGenerated(), "bank"), { recursive: true });
  await copyFile(glbFile(), join(dir, "monster.glb"));
  await copyFile(loreFile(), join(dir, "lore.json"));
  const icon = join(publicGenerated(), "icon.png");
  if (existsSync(icon)) {
    await copyFile(icon, join(dir, "icon.png"));
    await copyFile(icon, bankIcon(id));
  }
  await patchState({
    monsters: [{
      id,
      prompt: s.concepts.find((c) => c.id === id)?.prompt ?? lore.name,
      name: lore.name,
      epithet: docSubtitle(lore),
      path: lore.kind,
      createdAt: new Date().toISOString(),
      discoveries: s.discoveries,
      assetId: s.upload.assetId,
    }],
    currentMonsterId: id,
  });
}

/** Fold the live session's notes and asset id back onto the record of the
 * creature currently on the pedestal, so switching away does not lose them. */
function stash(s: { monsters: MonsterRecord[]; currentMonsterId: string | null; discoveries: MonsterRecord["discoveries"]; upload: { assetId: string | null } }): MonsterRecord[] {
  if (!s.currentMonsterId) return s.monsters;
  return s.monsters.map((m) =>
    m.id === s.currentMonsterId ? { ...m, discoveries: s.discoveries, assetId: s.upload.assetId } : m,
  );
}

/** Persist a lore document the workflow produced (or null when it did not). */
async function recordLore(lore: import("./lore-schema").WorkshopDoc | null): Promise<void> {
  if (lore) {
    await mkdir(workshopDir(), { recursive: true });
    await writeFile(loreFile(), JSON.stringify(lore, null, 2));
    await patchState({ lore, loreStatus: { status: "done", error: null } });
  } else {
    await patchState({
      loreStatus: { status: "failed", error: "The workflow returned no valid lore document." },
    });
  }
}

/** Kick off the manifest generation for an approved concept: reset the
 * session to "summoning", run the workflow in the background, bank the result.
 * Shared by approve and by summon/retry, so a timed-out generation can be
 * relaunched without re-sketching (and re-paying for) the concept. */
/** The one-line subtitle each kind carries under its name. */
function docSubtitle(doc: { kind: string } & Record<string, unknown>): string {
  if (doc.kind === "product") return String(doc.tagline ?? "");
  if (doc.kind === "artifact") return String(doc.era ?? "");
  return String(doc.epithet ?? "");
}

/** Milestone weights for the manifest workflow's quick legs. The 3D node is
 * the rest of the bar; fal exposes no percentage for it (verified), so the
 * front-end eases through that stretch on a clock. */
const NODE_PROGRESS: Record<string, { done: number; label: string }> = {
  lore: { done: 0.1, label: "Lore written" },
  iconprompt: { done: 0.03, label: "Emblem designed" },
  icon: { done: 0.12, label: "Emblem painted" },
};

/** Summons this server process is actually working on. State alone cannot be
 * trusted: a dev-server restart mid-summon (routine in bolt.new) kills the
 * background task but leaves state.json saying "running" forever, which
 * strands the attendee on a bar that never moves and never fails. */
const liveSummons = new Set<string>();

/** Reconcile a "running" state that no live task backs: mark it failed so the
 * retry button appears. Self-healing if the judgement is ever wrong: a task
 * that does complete later still writes "done" over this. */
async function reapOrphanedSummon(): Promise<void> {
  if (liveSummons.size > 0) return;
  const s = await readState();
  if (s.model.status !== "running") return;
  const error = "The server restarted while summoning. The generation may still be billed; press Retry to relaunch it.";
  await patchState({
    model: { status: "failed", glbPath: null, error, progress: 0, stage: null },
    loreStatus: { status: "failed", error },
  });
}

async function startSummon(concept: { id: string; prompt: string; imageUrl: string; styledPrompt?: string | null; path?: string }): Promise<void> {
  const path = pathOf(concept.path);
  liveSummons.add(concept.id);
  const s = await readState();
  await patchState({
    approvedConceptId: concept.id,
    model: { status: "running", glbPath: null, error: null, progress: 0.02, stage: "Reading the concept" },
    loreStatus: { status: "running", error: null },
    // The notes and the asset id belong to the creature leaving the
    // pedestal: discovery points are stored in ITS local space, so carrying
    // them over would pin them to meaningless spots on the new one. Stash
    // them on its record so they come back with it.
    monsters: stash(s),
    discoveries: [],
    upload: { glbSha: null, assetId: null, state: "none", error: null },
  });
  // Stage 2 MANIFEST: 3D model + lore + emblem icon in one go (workflow
  // when configured, three direct legs otherwise).
  void (async () => {
    try {
      // Milestones from the workflow stream become a progress floor the
      // scene's bar can never fall below, plus a stage label for the hint.
      let done = 0.02;
      const onNode = (p: { status: string; node?: string; event?: string }): void => {
        if (p.event === "submit" && p.node === "model3d") {
          void patchState({ model: { stage: "Sculpting the 3D model" } });
          return;
        }
        if (p.event !== "completion" || !p.node) return;
        const w = NODE_PROGRESS[p.node];
        if (!w) return;
        done += w.done;
        void patchState({ model: { progress: Math.min(0.3, done), stage: w.label } });
      };
      const m = await manifestMonster(
        concept.prompt,
        concept.imageUrl,
        { key: env().FAL_KEY!, fetch, stream: true },
        manifestWorkflow(),
        onNode,
        concept.styledPrompt,
        path,
      );
      // Erase the reconstruction lattice before the model goes anywhere:
      // the scene, the bank, and the portal upload all read these files.
      const glb = matteGlb(smoothGlb(m.glb));
      await mkdir(workshopDir(), { recursive: true });
      await mkdir(join(process.cwd(), "public", "generated"), { recursive: true });
      await writeFile(glbFile(), Buffer.from(glb));
      await copyFile(glbFile(), join(publicGenerated(), "monster.glb"));
      if (m.iconPng) await writeFile(join(publicGenerated(), "icon.png"), Buffer.from(m.iconPng));
      await recordLore(m.lore);

      // Bank the originals so this creature can be summoned back after
      // later ones have overwritten the "current" files.
      const dir = monsterDir(concept.id);
      await mkdir(dir, { recursive: true });
      await mkdir(join(publicGenerated(), "bank"), { recursive: true });
      await writeFile(join(dir, "monster.glb"), Buffer.from(glb));
      if (m.lore) await writeFile(join(dir, "lore.json"), JSON.stringify(m.lore, null, 2));
      if (m.iconPng) {
        await writeFile(join(dir, "icon.png"), Buffer.from(m.iconPng));
        await writeFile(bankIcon(concept.id), Buffer.from(m.iconPng));
      }
      const cur = await readState();
      const record: MonsterRecord = {
        id: concept.id,
        prompt: concept.prompt,
        name: m.lore?.name ?? "Unnamed",
        epithet: m.lore ? docSubtitle(m.lore) : "",
        path: path.id,
        createdAt: new Date().toISOString(),
        discoveries: [],
        assetId: null,
      };
      await patchState({
        model: { status: "done", glbPath: glbFile(), error: null, progress: 1, stage: null },
        monsters: [...cur.monsters.filter((x) => x.id !== record.id), record],
        currentMonsterId: record.id,
      });
    } catch (e) {
      await patchState({
        model: { status: "failed", glbPath: null, error: String(e), progress: 0, stage: null },
        loreStatus: { status: "failed", error: String(e) },
      });
    } finally {
      liveSummons.delete(concept.id);
    }
  })().catch((e) => console.warn("[workshop] background task failed:", e));
}

const routes: Record<string, Handler> = {
  "GET /api/status": async () => {
    await adoptCurrentMonster();
    await reapOrphanedSummon();
    return {
      status: 200,
      json: await buildStatus({
        env: env(),
        probes: { fal: () => probeFal(env().FAL_KEY!, fetch) },
        artifacts: {
          conceptCount: async () => (await readState()).concepts.length,
          glbExists: async () => existsSync(glbFile()),
          loreExists: async () => existsSync(loreFile()),
        },
        deployment: async () => (existsSync(deployFile()) ? (JSON.parse(await readFile(deployFile(), "utf8")) as { url: string }) : null),
        state: readState,
      }),
    };
  },

  "GET /api/lore": async () => {
    if (!existsSync(loreFile())) return { status: 404, json: { error: "no lore yet", hint: "Approve a concept first." } };
    return { status: 200, json: parseDoc(JSON.parse(await readFile(loreFile(), "utf8"))) };
  },

  // Stage 1 SKETCH: the styled concept image (workflow when configured,
  // direct flux/schnell with the guardrails template otherwise). Cheap per
  // reroll; lore waits for the manifest stage.
  "POST /api/concept": async (body) => {
    const prompt = String(body.prompt ?? "");
    const path = pathOf(body.path);
    const { imageUrl, styledPrompt } = await sketchMonster(prompt, { key: env().FAL_KEY!, fetch }, sketchWorkflow(), path);
    const concept = { id: `c${Date.now()}`, prompt, imageUrl, createdAt: new Date().toISOString(), styledPrompt, path: path.id };
    const s = await readState();
    await patchState({ concepts: [...s.concepts, concept] });
    return { status: 200, json: concept };
  },

  "POST /api/approve": async (body) => {
    const s = await readState();
    if (s.model.status === "running") {
      return { status: 409, json: { error: "already summoning", hint: "Your monster is already on the way." } };
    }
    const concept = s.concepts.find((c) => c.id === body.conceptId);
    if (!concept) return { status: 404, json: { error: "unknown concept", hint: "Generate a concept first." } };
    await startSummon(concept);
    return { status: 202, json: { started: true } };
  },

  // Relaunch a summon that failed (a timeout, a fal hiccup) using the
  // already-paid-for concept, so a failed 3D stage never costs a re-sketch.
  "POST /api/summon/retry": async () => {
    const s = await readState();
    if (s.model.status === "running") {
      return { status: 409, json: { error: "already summoning", hint: "Your monster is already on the way." } };
    }
    if (s.model.status !== "failed") {
      return { status: 409, json: { error: "nothing to retry", hint: "The last summon did not fail." } };
    }
    const concept = s.concepts.find((c) => c.id === s.approvedConceptId);
    if (!concept) return { status: 404, json: { error: "no approved concept", hint: "Sketch and approve a concept first." } };
    await startSummon(concept);
    return { status: 202, json: { started: true } };
  },

  // Retry re-runs ONLY the lore leg (direct LLM call, cheap) -- never the
  // expensive 3D stage.
  "POST /api/lore/retry": async () => {
    const s = await readState();
    const retryPath = pathOf(s.concepts.find((c) => c.id === s.approvedConceptId)?.path);
    const concept = s.approvedConceptId
      ? s.concepts.find((c) => c.id === s.approvedConceptId)
      : s.concepts[s.concepts.length - 1];
    if (s.loreStatus.status !== "failed" || !concept) {
      return { status: 409, json: { error: "no failed lore to retry", hint: "Approve a concept and let its lore fail first." } };
    }
    await patchState({ loreStatus: { status: "running", error: null } });
    void (async () => {
      try {
        await recordLore(await generateLoreLLM(concept.prompt, { key: env().FAL_KEY!, fetch }, retryPath));
      } catch (e) {
        await patchState({ loreStatus: { status: "failed", error: String(e) } });
      }
    })().catch((e) => console.warn("[workshop] background task failed:", e));
    return { status: 202, json: { started: true } };
  },

  // Click to annotate: the browser sends a rendered closeup of the clicked
  // point plus a full-body context shot; vision names the part and writes its
  // codex entry. Discoveries are persisted so a reload keeps them.
  "POST /api/annotate": async (body) => {
    if (!existsSync(loreFile())) {
      return { status: 409, json: { error: "no lore yet", hint: "Summon your monster first, then click it." } };
    }
    const closeup = String(body.closeup ?? "");
    const context = String(body.context ?? "");
    if (!closeup.startsWith("data:image/") || !context.startsWith("data:image/")) {
      return { status: 400, json: { error: "missing render", hint: "The app could not capture the click. Try clicking the monster again." } };
    }
    const lore = parseDoc(JSON.parse(await readFile(loreFile(), "utf8")));
    const found = await annotateFeature({ closeup, context, lore }, { key: env().FAL_KEY!, fetch });
    const point = Array.isArray(body.point) ? (body.point as number[]).slice(0, 3) : [0, 0, 0];
    const entry = {
      id: `d${Date.now()}`,
      label: found.label,
      blurb: found.blurb,
      slot: found.slot,
      seen: found.seen,
      point: [point[0] ?? 0, point[1] ?? 0, point[2] ?? 0] as [number, number, number],
    };
    const st = await readState();
    await patchState({ discoveries: [...st.discoveries, entry] });
    return { status: 200, json: entry };
  },

  // Discoveries are the only thing in the workshop an attendee accumulates by
  // exploring, so they are also the only thing worth being able to reset --
  // to re-run the discovery moment in a rehearsal, or to clear a duplicate.
  // Everything else (concept, model, lore) is replaced by re-running its step.
  "POST /api/discoveries/clear": async () => {
    await patchState({ discoveries: [] });
    return { status: 200, json: { discoveries: [] } };
  },

  // Summon a banked creature back onto the pedestal: its files become the
  // current ones, and its notes and asset id come back with it.
  "POST /api/monsters/load": async (body) => {
    const id = String(body.id ?? "");
    const s = await readState();
    const rec = s.monsters.find((m) => m.id === id);
    if (!rec) return { status: 404, json: { error: "unknown monster", hint: "That one is not in the bank." } };
    const dir = monsterDir(id);
    if (!existsSync(join(dir, "monster.glb"))) {
      return { status: 410, json: { error: "monster files are gone", hint: "Its model was removed from .workshop; summon it again." } };
    }
    if (id === s.currentMonsterId) return { status: 200, json: { id } };

    await mkdir(publicGenerated(), { recursive: true });
    await copyFile(join(dir, "monster.glb"), glbFile());
    await copyFile(join(dir, "monster.glb"), join(publicGenerated(), "monster.glb"));
    if (existsSync(join(dir, "lore.json"))) await copyFile(join(dir, "lore.json"), loreFile());
    if (existsSync(join(dir, "icon.png"))) await copyFile(join(dir, "icon.png"), join(publicGenerated(), "icon.png"));

    await patchState({
      monsters: stash(s),
      currentMonsterId: id,
      approvedConceptId: id,
      discoveries: rec.discoveries,
      model: { status: "done", glbPath: glbFile(), error: null },
      loreStatus: { status: "done", error: null },
      upload: { glbSha: null, assetId: rec.assetId, state: rec.assetId ? "ready" : "none", error: null },
    });
    return { status: 200, json: { id } };
  },

  // After pressing Deploy in bolt.new, the attendee pastes the live link so
  // the checklist can complete (Bolt's deploy is a UI action; there is no
  // programmatic way to learn the URL from inside the container).
  "POST /api/deployed-url": async (body) => {
    const url = String(body.url ?? "").trim();
    if (!/^https:\/\/[^\s]+\.[a-z]{2,}([\/?#][^\s]*)?$/i.test(url)) {
      return { status: 400, json: { error: "that does not look like a URL", hint: "Paste the https link Bolt shows after Deploy finishes." } };
    }
    await mkdir(workshopDir(), { recursive: true });
    await writeFile(deployFile(), deploymentRecord(url));
    return { status: 200, json: { url } };
  },

  // Publish is manual: the attendee downloads the GLB, uploads it in the
  // Miris portal under their own account, and pastes the asset id back here.
  "POST /api/asset-id": async (body) => {
    const assetId = String(body.assetId ?? "").trim();
    if (!assetId || assetId.length > 128 || /\s/.test(assetId)) {
      return { status: 400, json: { error: "that does not look like an asset id", hint: "Copy the id from the asset page in the Miris portal." } };
    }
    await patchState({ upload: { glbSha: null, assetId, state: "ready", error: null } });
    return { status: 200, json: { assetId } };
  },
};

export function workshopApi(): Plugin {
  return {
    name: "workshop-api",
    configureServer(server) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const key = `${req.method} ${req.url?.split("?")[0]}`;
        const handler = routes[key];
        if (!handler) return next();
        let body: Record<string, unknown> = {};
        if (req.method === "POST") {
          const chunks: Buffer[] = [];
          for await (const c of req) chunks.push(c as Buffer);
          const raw = Buffer.concat(chunks);
          // Rendered closeups are base64 images, far past the old 10KB cap.
          if (raw.length > 4_000_000) { res.statusCode = 413; res.end(JSON.stringify({ error: "payload too large", hint: "Try clicking again." })); return; }
          try { body = raw.length ? JSON.parse(raw.toString("utf8")) : {}; } catch { body = {}; }
        }
        try {
          const out = await handler(body);
          res.statusCode = out.status;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify(out.json));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader("content-type", "application/json");
          res.end(JSON.stringify({ error: String(e), hint: hintFor(e) }));
        }
      });
    },
  };
}
