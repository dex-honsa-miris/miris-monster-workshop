import "dotenv/config";
import { execSync } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { resolveAssetId, viewerConfig } from "../server/deploy-core";
import { parseLore } from "../server/lore-schema";
import { readState, workshopDir } from "../server/state";
import { readFile } from "node:fs/promises";

// Bakes your monster into the viewer and builds it as the project's build
// output. Publishing is Bolt's job: press Deploy in bolt.new, then paste the
// bolt.host link into the app so the checklist can tick itself.
const main = async () => {
  const assetId = resolveAssetId(process.argv[2], await readState());
  const lore = parseLore(JSON.parse(await readFile(join(workshopDir(), "lore.json"), "utf8")));
  await writeFile(join(process.cwd(), "viewer", "monster.config.json"), viewerConfig(assetId, lore, process.env.VIEWER_KEY));
  console.log(`Baked asset ${assetId} into viewer/monster.config.json`);
  console.log("Building the viewer (this becomes the project's build output)...\n");
  execSync("npm run build:viewer", { stdio: "inherit" });
  console.log("\nBuild ready in dist/.");
  console.log("Last step happens in the editor: press Deploy in bolt.new.");
  console.log("When Bolt hands you your live link, paste it into the app to finish the checklist.");
};
main().catch((e) => { console.error("\ndeploy prep failed:", String(e)); process.exit(1); });
