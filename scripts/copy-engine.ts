// The Miris core SDK fetches its engine loader at RUNTIME from a URL Vite
// cannot statically see: `new URL("./AquaApi.js", "" + import.meta.url)`, where
// the string concatenation defeats the bundler's asset analysis. AquaApi.js
// then resolves AquaApi.wasm (and the parser pair) as plain-named siblings of
// itself. So a production build only works if those four files sit next to the
// bundle under their ORIGINAL names. Dev never notices, because the dev server
// serves node_modules directly, which is how broken production builds went
// undetected until the first static deploy of the sibling boutique demo.
import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const SRC = join(process.cwd(), "node_modules", "@miris-inc", "core", "dist");
const OUT = join(process.cwd(), "dist-viewer", "assets");
mkdirSync(OUT, { recursive: true });
for (const f of ["AquaApi.js", "AquaApi.wasm", "aqua-parser.js", "aqua-parser.wasm"]) {
  copyFileSync(join(SRC, f), join(OUT, f));
  console.log(`[copy-engine] ${f} -> dist-viewer/assets/`);
}
