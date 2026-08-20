import "dotenv/config";
import { copyFile, mkdir, writeFile } from "node:fs/promises";
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
  const [modelResult, loreResult] = await Promise.allSettled([
    generateModel(imageUrl, deps, (p) => process.stdout.write(`\r    ${p.status}        `)),
    generateLore(prompt),
  ]);

  if (modelResult.status === "rejected") {
    console.error("\ngeneration failed:", String(modelResult.reason));
    process.exit(1);
  }

  const { glb } = modelResult.value;
  await mkdir(workshopDir(), { recursive: true });
  await writeFile(join(workshopDir(), "monster.glb"), Buffer.from(glb));
  await mkdir(join(process.cwd(), "public", "generated"), { recursive: true });
  await copyFile(join(workshopDir(), "monster.glb"), join(process.cwd(), "public", "generated", "monster.glb"));

  if (loreResult.status === "rejected") {
    console.warn("\n   lore generation failed, monster model saved without lore:", String(loreResult.reason));
    console.log(`\n3/3 saved ${join(workshopDir(), "monster.glb")} (no lore.json - lore generation failed)`);
    return;
  }

  const lore = loreResult.value;
  await writeFile(join(workshopDir(), "lore.json"), JSON.stringify(lore, null, 2));
  console.log(`\n3/3 saved ${join(workshopDir(), "monster.glb")} and lore.json - meet ${lore.name} ${lore.epithet}`);
};
main().catch((e) => { console.error("\ngeneration failed:", String(e)); process.exit(1); });
