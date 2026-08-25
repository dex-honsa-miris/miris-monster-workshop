import "dotenv/config";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { manifestMonster, MANIFEST_WORKFLOW, sketchMonster, SKETCH_WORKFLOW } from "../server/fal";
import { workshopDir } from "../server/state";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) { console.error('usage: npm run generate -- "a moss golem with lantern eyes"'); process.exit(1); }

const main = async () => {
  const deps = { key: process.env.FAL_KEY!, fetch };
  console.log("1/3 sketching the concept…");
  const { imageUrl } = await sketchMonster(prompt, deps, process.env.FAL_SKETCH_WORKFLOW || SKETCH_WORKFLOW);
  console.log("   ", imageUrl);
  console.log("2/3 manifesting: 3D model + lore + icon (a minute or two)…");
  const { glb, lore, iconPng } = await manifestMonster(prompt, imageUrl, deps, process.env.FAL_MANIFEST_WORKFLOW || MANIFEST_WORKFLOW, (p) => process.stdout.write(`\r    ${p.status}        `));
  if (!lore) console.warn("\n    lore did not validate; the app can retry it later");
  await mkdir(workshopDir(), { recursive: true });
  await writeFile(join(workshopDir(), "monster.glb"), Buffer.from(glb));
  await mkdir(join(process.cwd(), "public", "generated"), { recursive: true });
  await copyFile(join(workshopDir(), "monster.glb"), join(process.cwd(), "public", "generated", "monster.glb"));
  if (iconPng) await writeFile(join(process.cwd(), "public", "generated", "icon.png"), Buffer.from(iconPng));
  if (lore) await writeFile(join(workshopDir(), "lore.json"), JSON.stringify(lore, null, 2));
  console.log(`\n3/3 saved ${join(workshopDir(), "monster.glb")}${lore ? ` and lore.json - meet ${lore.name}` : ""}`);
};
main().catch((e) => { console.error("\ngeneration failed:", String(e)); process.exit(1); });
