import "dotenv/config";
import { execSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { collectFiles, deploymentRecord, resolveAssetId, viewerConfig } from "../server/deploy-core";
import { parseLore } from "../server/lore-schema";
import { readState, workshopDir } from "../server/state";

const CONFIG_PATH = join(process.cwd(), "viewer", "monster.config.json");
const DIST_DIR = join(process.cwd(), "dist-viewer");

const extractVercelUrl = (stdout: string): string | null => {
  const matches = stdout.match(/https:\/\/[a-zA-Z0-9.-]+\.vercel\.app/g);
  return matches && matches.length > 0 ? matches[matches.length - 1]! : null;
};

async function deployViaRest(token: string): Promise<string> {
  const files = await collectFiles(DIST_DIR);
  const createRes = await fetch("https://api.vercel.com/v13/deployments", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ name: "monster-viewer", target: "production", files, projectSettings: { framework: null } }),
  });
  if (!createRes.ok) throw new Error(`Vercel REST deploy failed: ${createRes.status} ${await createRes.text()}`);
  const created = (await createRes.json()) as { id: string };

  for (let i = 0; i < 60; i++) {
    const statusRes = await fetch(`https://api.vercel.com/v13/deployments/${created.id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!statusRes.ok) throw new Error(`Vercel REST status check failed: ${statusRes.status}`);
    const deployment = (await statusRes.json()) as { readyState: string; url: string };
    if (deployment.readyState === "READY") return `https://${deployment.url}`;
    if (deployment.readyState === "ERROR" || deployment.readyState === "CANCELED") {
      throw new Error(`Vercel deployment ended in state ${deployment.readyState}`);
    }
    await new Promise((res) => setTimeout(res, 3000));
  }
  throw new Error("Vercel REST deployment timed out waiting for READY");
}

async function main(): Promise<void> {
  const state = await readState();
  const assetId = resolveAssetId(process.argv[2], state);

  const loreRaw = JSON.parse(await readFile(join(workshopDir(), "lore.json"), "utf8"));
  const lore = parseLore(loreRaw);

  console.log(`1/4 writing viewer config for ${lore.name}...`);
  await writeFile(CONFIG_PATH, viewerConfig(assetId, lore, process.env.VIEWER_KEY));

  console.log("2/4 building viewer...");
  execSync("npm run build:viewer", { stdio: "inherit" });

  console.log("3/4 deploying to Vercel...");
  let url: string | null = null;
  try {
    const stdout = execSync("npx vercel deploy dist-viewer --prod --yes", { encoding: "utf8" });
    process.stdout.write(stdout);
    url = extractVercelUrl(stdout);
    if (!url) throw new Error("vercel CLI succeeded but no deployment URL was found in its output");
  } catch (cliError) {
    const token = process.env.VERCEL_TOKEN;
    if (token) {
      console.log("   vercel CLI path failed, falling back to the Vercel REST API...");
      url = await deployViaRest(token);
    } else {
      console.error("\nThe deploy failed, and there is no VERCEL_TOKEN set for the fallback.\n");
      console.error("You have two options:");
      console.error("  1. Run npx vercel login to authenticate the CLI, then run npm run deploy again.");
      console.error("  2. Set VERCEL_TOKEN in your .env file (Vercel dashboard, Settings, Tokens), then run npm run deploy again.\n");
      throw cliError;
    }
  }

  console.log("4/4 recording deployment...");
  await writeFile(join(workshopDir(), "deployment.json"), deploymentRecord(url));

  console.log(`\n  Your monster lives at: ${url}\n`);
}

main().catch((e) => {
  console.error("deploy failed:", String(e));
  process.exit(1);
});
