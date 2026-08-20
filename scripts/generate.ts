import "dotenv/config";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { generateConcept, generateModel } from "../server/fal";
import { generateLore } from "../server/lore";
import { workshopDir } from "../server/state";

const prompt = process.argv.slice(2).join(" ").trim();
if (!prompt) { console.error('usage: npm run generate -- "a moss golem with lantern eyes"'); process.exit(1); }

const main = async () => {
  const deps = { key: process.env.FAL_KEY!, fetch };
  console.log("1/3 concept image…");
  const { imageUrl } = await generateConcept(prompt, deps);
  console.log("   ", imageUrl);
  console.log("2/3 3D model (this takes a minute or two)…");
  const [{ glb }, lore] = await Promise.all([
    generateModel(imageUrl, deps, (p) => process.stdout.write(`\r    ${p.status}        `)),
    generateLore(prompt),
  ]);
  await mkdir(workshopDir(), { recursive: true });
  await writeFile(join(workshopDir(), "monster.glb"), Buffer.from(glb));
  await writeFile(join(workshopDir(), "lore.json"), JSON.stringify(lore, null, 2));
  console.log(`\n3/3 saved ${join(workshopDir(), "monster.glb")} and lore.json - meet ${lore.name} ${lore.epithet}`);
};
main().catch((e) => { console.error("\ngeneration failed:", String(e)); process.exit(1); });
