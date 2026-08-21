import "dotenv/config";
import { probeFal } from "../server/probes";


const env = process.env;
const line = (name: string, ok: boolean | null, detail: string) =>
  console.log(`${ok === null ? "…" : ok ? "✓" : "✗"} ${name.padEnd(22)} ${detail}`);

const main = async () => {
  console.log("Miris Monster Workshop - credential check\n");
  if (!env.FAL_KEY) line("FAL_KEY", false, "not set (copy .env.example to .env and fill it in)");
  else { const r = await probeFal(env.FAL_KEY, fetch); line("FAL_KEY", r.ok, r.detail); }

  line("sketch workflow", null, env.FAL_SKETCH_WORKFLOW ?? "not set (direct model calls)");
  line("manifest workflow", null, env.FAL_MANIFEST_WORKFLOW ?? "not set (direct model calls)");

  console.log("\nPublishing needs no key: you upload the GLB in the Miris portal (app.miris.com)");
  console.log("under your own account and paste the asset id into the app.");
  console.log("fal balance is not exposed via API - check https://fal.ai/dashboard if generations fail.");
};
main();
