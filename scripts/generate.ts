import "dotenv/config";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { DEFAULT_WORKFLOW_ID, generateModel, runMonsterWorkflow } from "../server/fal";
import { workshopDir } from "../server/state";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) { console.error('usage: npm run generate -- "a moss golem with lantern eyes"'); process.exit(1); }

const main = async () => {
  const deps = { key: process.env.FAL_KEY!, fetch };
  const workflowId = process.env.FAL_WORKFLOW_ID ?? DEFAULT_WORKFLOW_ID;
  console.log(`1/3 running the workshop workflow (${workflowId})…`);
  const { imageUrl, lore } = await runMonsterWorkflow(prompt, deps, workflowId);
  console.log("   ", imageUrl);
  if (!lore) console.warn("    the workflow returned no valid lore document; the app can retry later");
  console.log("2/3 3D model (this takes a minute or two)…");
  const { glb } = await generateModel(imageUrl, deps, (p) => process.stdout.write(`\r    ${p.status}        `));
  await mkdir(workshopDir(), { recursive: true });
  await writeFile(join(workshopDir(), "monster.glb"), Buffer.from(glb));
  await mkdir(join(process.cwd(), "public", "generated"), { recursive: true });
  await copyFile(join(workshopDir(), "monster.glb"), join(process.cwd(), "public", "generated", "monster.glb"));
  if (lore) await writeFile(join(workshopDir(), "lore.json"), JSON.stringify(lore, null, 2));
  console.log(`\n3/3 saved ${join(workshopDir(), "monster.glb")}${lore ? ` and lore.json - meet ${lore.name} ${lore.epithet}` : ""}`);
};
main().catch((e) => { console.error("\ngeneration failed:", String(e)); process.exit(1); });
