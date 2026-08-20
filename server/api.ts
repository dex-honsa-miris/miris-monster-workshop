import "dotenv/config";
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { generateConcept, generateModel } from "./fal";
import { generateLore } from "./lore";
import { assetStatus, uploadGlb } from "./miris";
import { probeFal, probeGateway, probeMiris } from "./probes";
import { patchState, readState, workshopDir } from "./state";
import { buildStatus } from "./status";
import { parseLore, type MonsterLore } from "./lore-schema";

type Handler = (body: Record<string, unknown>) => Promise<{ status: number; json: unknown }>;

const env = () => process.env as Record<string, string | undefined>;
const mirisBase = () => env().MIRIS_API_BASE ?? "https://api.miris.com";
const glbFile = () => join(workshopDir(), "monster.glb");
const loreFile = () => join(workshopDir(), "lore.json");
const deployFile = () => join(workshopDir(), "deployment.json");

const hintFor = (e: unknown): string => {
  const msg = String(e);
  if (msg.includes("402")) return "Your fal balance may be empty. Check the fal dashboard, or the coupon step in the itinerary.";
  if (msg.includes("401") || msg.includes("403")) return "A key was rejected. Re-check the matching line in your .env, then run npm run doctor.";
  if (msg.includes("timed out")) return "The generation service is slow right now. Try again.";
  return "Run npm run doctor in the terminal for a full credential check.";
};

async function runLoreTask(prompt: string): Promise<void> {
  await patchState({ loreStatus: { status: "running", error: null } });
  try {
    const lore = await generateLore(prompt);
    await writeFile(loreFile(), JSON.stringify(lore, null, 2));
    await patchState({ lore, loreStatus: { status: "done", error: null } });
  } catch (e) {
    console.warn("[workshop] lore generation failed:", e);
    await patchState({ loreStatus: { status: "failed", error: String(e) } });
  }
}

const routes: Record<string, Handler> = {
  "GET /api/status": async () => ({
    status: 200,
    json: await buildStatus({
      env: env(),
      probes: {
        fal: () => probeFal(env().FAL_KEY!, fetch),
        gateway: () => probeGateway(env().AI_GATEWAY_API_KEY!, fetch),
        miris: () => probeMiris(env().MIRIS_API_TOKEN!, mirisBase(), fetch),
      },
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

  "POST /api/concept": async (body) => {
    const prompt = String(body.prompt ?? "");
    const { imageUrl } = await generateConcept(prompt, { key: env().FAL_KEY!, fetch });
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
    await patchState({ approvedConceptId: concept.id, model: { status: "running", glbPath: null, error: null } });
    void (async () => {
      try {
        const { glb } = await generateModel(concept.imageUrl, { key: env().FAL_KEY!, fetch });
        await mkdir(workshopDir(), { recursive: true });
        await writeFile(glbFile(), Buffer.from(glb));
        await mkdir(join(process.cwd(), "public", "generated"), { recursive: true });
        await copyFile(glbFile(), join(process.cwd(), "public", "generated", "monster.glb"));
        await patchState({ model: { status: "done", glbPath: glbFile(), error: null } });
      } catch (e) {
        await patchState({ model: { status: "failed", glbPath: null, error: String(e) } });
      }
    })().catch((e) => console.warn("[workshop] background task failed:", e));
    void runLoreTask(concept.prompt).catch((e) => console.warn("[workshop] background task failed:", e));
    return { status: 202, json: { started: true } };
  },

  "POST /api/lore/retry": async () => {
    const s = await readState();
    const concept = s.approvedConceptId ? s.concepts.find((c) => c.id === s.approvedConceptId) : undefined;
    if (s.loreStatus.status !== "failed" || !concept) {
      return { status: 409, json: { error: "no failed lore to retry", hint: "Approve a concept and let it fail first." } };
    }
    void runLoreTask(concept.prompt).catch((e) => console.warn("[workshop] background task failed:", e));
    return { status: 202, json: { started: true } };
  },

  "POST /api/upload": async () => {
    const glb = await readFile(glbFile());
    const lore = parseLore(JSON.parse(await readFile(loreFile(), "utf8"))) as MonsterLore;
    const deps = { token: env().MIRIS_API_TOKEN!, base: mirisBase(), fetch };
    const r = await uploadGlb(glb.buffer.slice(glb.byteOffset, glb.byteOffset + glb.byteLength) as ArrayBuffer, lore.name, deps);
    void (async () => {
      for (let i = 0; i < 120; i++) {
        await new Promise((res) => setTimeout(res, 5000));
        const st = await assetStatus(r.assetId, deps).catch(() => "processing" as const);
        if (st !== "processing") { await patchState({ upload: { state: st } as never }); return; }
      }
      await patchState({ upload: { state: "failed", error: "Miris processing timed out after 10 minutes" } as never });
    })().catch((e) => console.warn("[workshop] background task failed:", e));
    return { status: 200, json: r };
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
