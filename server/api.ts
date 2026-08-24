import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { annotateFeature, generateLoreLLM, manifestMonster, MANIFEST_WORKFLOW, sketchMonster, SKETCH_WORKFLOW } from "./fal";
import { probeFal } from "./probes";
import { patchState, readState, workshopDir, type MonsterRecord } from "./state";
import { buildStatus } from "./status";
import { parseLore, type MonsterLore } from "./lore-schema";
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
  const lore = parseLore(JSON.parse(await readFile(loreFile(), "utf8")));
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
      epithet: lore.epithet,
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
async function recordLore(lore: MonsterLore | null): Promise<void> {
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

const routes: Record<string, Handler> = {
  "GET /api/status": async () => {
    await adoptCurrentMonster();
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
    return { status: 200, json: parseLore(JSON.parse(await readFile(loreFile(), "utf8"))) };
  },

  // Stage 1 SKETCH: the styled concept image (workflow when configured,
  // direct flux/schnell with the guardrails template otherwise). Cheap per
  // reroll; lore waits for the manifest stage.
  "POST /api/concept": async (body) => {
    const prompt = String(body.prompt ?? "");
    const { imageUrl, styledPrompt } = await sketchMonster(prompt, { key: env().FAL_KEY!, fetch }, sketchWorkflow());
    const concept = { id: `c${Date.now()}`, prompt, imageUrl, createdAt: new Date().toISOString(), styledPrompt };
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
    await patchState({
      approvedConceptId: concept.id,
      model: { status: "running", glbPath: null, error: null },
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
        const m = await manifestMonster(
          concept.prompt,
          concept.imageUrl,
          { key: env().FAL_KEY!, fetch },
          manifestWorkflow(),
          undefined,
          concept.styledPrompt,
        );
        await mkdir(workshopDir(), { recursive: true });
        await mkdir(join(process.cwd(), "public", "generated"), { recursive: true });
        await writeFile(glbFile(), Buffer.from(m.glb));
        await copyFile(glbFile(), join(publicGenerated(), "monster.glb"));
        if (m.iconPng) await writeFile(join(publicGenerated(), "icon.png"), Buffer.from(m.iconPng));
        await recordLore(m.lore);

        // Bank the originals so this creature can be summoned back after
        // later ones have overwritten the "current" files.
        const dir = monsterDir(concept.id);
        await mkdir(dir, { recursive: true });
        await mkdir(join(publicGenerated(), "bank"), { recursive: true });
        await writeFile(join(dir, "monster.glb"), Buffer.from(m.glb));
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
          epithet: m.lore?.epithet ?? "",
          createdAt: new Date().toISOString(),
          discoveries: [],
          assetId: null,
        };
        await patchState({
          model: { status: "done", glbPath: glbFile(), error: null },
          monsters: [...cur.monsters.filter((x) => x.id !== record.id), record],
          currentMonsterId: record.id,
        });
      } catch (e) {
        await patchState({
          model: { status: "failed", glbPath: null, error: String(e) },
          loreStatus: { status: "failed", error: String(e) },
        });
      }
    })().catch((e) => console.warn("[workshop] background task failed:", e));
    return { status: 202, json: { started: true } };
  },

  // Retry re-runs ONLY the lore leg (direct LLM call, cheap) -- never the
  // expensive 3D stage.
  "POST /api/lore/retry": async () => {
    const s = await readState();
    const concept = s.approvedConceptId
      ? s.concepts.find((c) => c.id === s.approvedConceptId)
      : s.concepts[s.concepts.length - 1];
    if (s.loreStatus.status !== "failed" || !concept) {
      return { status: 409, json: { error: "no failed lore to retry", hint: "Approve a concept and let its lore fail first." } };
    }
    await patchState({ loreStatus: { status: "running", error: null } });
    void (async () => {
      try {
        await recordLore(await generateLoreLLM(concept.prompt, { key: env().FAL_KEY!, fetch }));
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
    const lore = parseLore(JSON.parse(await readFile(loreFile(), "utf8")));
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
