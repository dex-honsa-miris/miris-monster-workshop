import "dotenv/config";
import { generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { probeFal, probeGateway, probeMiris } from "../server/probes";
import { LORE_MODEL_ID } from "../server/lore";

const env = process.env;
const line = (name: string, ok: boolean | null, detail: string) =>
  console.log(`${ok === null ? "…" : ok ? "✓" : "✗"} ${name.padEnd(22)} ${detail}`);

const main = async () => {
  console.log("Miris Monster Workshop - credential check\n");
  if (!env.FAL_KEY) line("FAL_KEY", false, "not set (copy .env.example to .env and fill it in)");
  else { const r = await probeFal(env.FAL_KEY, fetch); line("FAL_KEY", r.ok, r.detail); }

  if (!env.AI_GATEWAY_API_KEY) line("AI_GATEWAY_API_KEY", false, "not set");
  else {
    const r = await probeGateway(env.AI_GATEWAY_API_KEY, fetch);
    line("AI_GATEWAY_API_KEY", r.ok, r.detail);
    if (r.ok) {
      try {
        await generateText({ model: gateway(LORE_MODEL_ID), prompt: "ping", maxOutputTokens: 1 });
        line(`model ${LORE_MODEL_ID}`, true, "responds");
      } catch (e) { line(`model ${LORE_MODEL_ID}`, false, String(e).slice(0, 100)); }
    }
  }

  if (!env.MIRIS_API_TOKEN) line("MIRIS_API_TOKEN", false, "not set");
  else { const r = await probeMiris(env.MIRIS_API_TOKEN, env.MIRIS_API_BASE ?? "https://api.miris.com", fetch); line("MIRIS_API_TOKEN", r.ok, r.detail); }

  console.log("\nfal balance is not exposed via API - check https://fal.ai/dashboard if generations fail.");
};
main();
