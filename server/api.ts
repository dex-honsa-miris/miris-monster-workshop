import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { generateLoreLLM, manifestMonster, MANIFEST_WORKFLOW, sketchMonster, SKETCH_WORKFLOW } from "./fal";
import { probeFal } from "./probes";
import { patchState, readState, workshopDir } from "./state";
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

const hintFor = (e: unknown): string => {
  const msg = String(e);
  if (msg.includes("402")) return "Your fal balance may be empty. Check the fal dashboard, or the coupon step in the itinerary.";
  if (msg.includes("401") || msg.includes("403")) return "Your fal key was rejected. Re-check FAL_KEY in .env, then run npm run doctor.";
  if (msg.includes("timed out")) return "The generation service is slow right now. Try again.";
  if (msg.includes("no image")) return "The workflow finished but returned no image. Tell the presenter; the workflow output contract may have changed.";
  return "Run npm run doctor in the terminal for a credential check.";
};

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
  "GET /api/status": async () => ({
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
  }),

  "GET /api/lore": async () => {
    if (!existsSync(loreFile())) return { status: 404, json: { error: "no lore yet", hint: "Approve a concept first." } };
    return { status: 200, json: parseLore(JSON.parse(await readFile(loreFile(), "utf8"))) };
  },

  // Stage 1 SKETCH: the styled concept image (workflow when configured,
  // direct flux/schnell with the guardrails template otherwise). Cheap per
  // reroll; lore waits for the manifest stage.
  "POST /api/concept": async (body) => {
    const prompt = String(body.prompt ?? "");
    const { imageUrl } = await sketchMonster(prompt, { key: env().FAL_KEY!, fetch }, sketchWorkflow());
    const concept = { id: `c${Date.now()}`, prompt, imageUrl, createdAt: new Date().toISOString() };
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
    });
    // Stage 2 MANIFEST: 3D model + lore + emblem icon in one go (workflow
    // when configured, three direct legs otherwise).
    void (async () => {
      try {
        const m = await manifestMonster(concept.prompt, concept.imageUrl, { key: env().FAL_KEY!, fetch }, manifestWorkflow());
        await mkdir(workshopDir(), { recursive: true });
        await mkdir(join(process.cwd(), "public", "generated"), { recursive: true });
        await writeFile(glbFile(), Buffer.from(m.glb));
        await copyFile(glbFile(), join(process.cwd(), "public", "generated", "monster.glb"));
        if (m.iconPng) await writeFile(join(process.cwd(), "public", "generated", "icon.png"), Buffer.from(m.iconPng));
        await recordLore(m.lore);
        await patchState({ model: { status: "done", glbPath: glbFile(), error: null } });
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
          if (raw.length > 10_240) { res.statusCode = 413; res.end("{}"); return; }
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
