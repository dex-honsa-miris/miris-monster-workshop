// The dev server auto-starts BEFORE the attendee creates .env (Bolt runs
// `npm start` on fork), so a boot-time dotenv load would never see their
// keys without a restart. Read the file fresh on every call instead: values
// in .env win over inherited process env, and the checklist really does wake
// up on its own a poll after the key is pasted.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse } from "dotenv";

export function workshopEnv(): Record<string, string | undefined> {
  const path = join(process.cwd(), ".env");
  const fromFile = existsSync(path) ? parse(readFileSync(path, "utf8")) : {};
  return { ...process.env, ...fromFile };
}
