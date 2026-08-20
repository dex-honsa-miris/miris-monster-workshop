import { MirisStream } from "@miris-inc/three";
import { loadConfig } from "./config";
import { createViewerStage } from "./stage";
import type { MirisStreamInit, MirisStreamObject } from "./sdk-types";

const streamCtor = MirisStream as unknown as new (init: MirisStreamInit) => MirisStreamObject;

const status = document.getElementById("status")!;

function say(text: string): void {
  status.textContent = text;
  status.hidden = false;
}

async function boot(): Promise<void> {
  const res = await fetch("./monster.config.json", { cache: "no-store" });
  if (!res.ok) throw new Error(`monster.config.json ${res.status}`);
  const config = loadConfig(await res.json());

  document.title = `${config.lore.name}, ${config.lore.epithet}`;
  say("Summoning the monster");

  const stage = await createViewerStage(config.viewerKey);
  const init: MirisStreamInit = { uuid: config.assetId };
  if (config.viewerKey) init.viewerKey = config.viewerKey;
  const stream = new streamCtor(init);
  stage.start();

  const seated = await stage.seatStream(stream);
  if (!seated) {
    say(`The monster never arrived. Asset ${config.assetId} did not stream in.`);
    return;
  }
  stage.applyLore(config.lore);
  status.hidden = true;
}

boot().catch((e: unknown) => {
  console.error("[viewer]", e);
  say(e instanceof Error ? e.message : String(e));
});
