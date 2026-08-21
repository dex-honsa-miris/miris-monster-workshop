import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const CONFIG_FILE = "monster.config.json";

/**
 * The baked config is fetched at runtime, not imported, so the deploy script
 * can rewrite `viewer/monster.config.json` and rebuild without touching code.
 * It sits at the Vite root rather than in a public/ folder, so the dev server
 * already serves it, and this plugin is what carries it into the bundle.
 */
const bakedConfig: Plugin = {
  name: "monster-baked-config",
  generateBundle() {
    this.emitFile({ type: "asset", fileName: CONFIG_FILE, source: readFileSync(join(HERE, CONFIG_FILE), "utf8") });
  },
};

/**
 * Dev-only shim for the same engine-loading quirk that copy-engine.ts fixes for
 * production. The core SDK asks for its loader at `/node_modules/@miris-inc/
 * core/dist/AquaApi.js`, a path relative to the SERVER root; because this
 * config roots Vite at `viewer/`, that path is one level above the root and
 * 404s (the engine then never initializes). Map those requests back to the
 * repo's real node_modules.
 */
const engineInDev: Plugin = {
  name: "monster-engine-dev",
  apply: "serve",
  configureServer(server) {
    server.middlewares.use((req, _res, next) => {
      if (req.url?.startsWith("/node_modules/")) req.url = `/@fs${join(ROOT, req.url)}`;
      next();
    });
  },
};

// base "./" keeps the bundle portable: the mini-site works from a bucket
// subfolder or a file path, not just a domain root.
export default defineConfig({
  root: HERE,
  base: "./",
  plugins: [bakedConfig, engineInDev],
  server: { fs: { allow: [ROOT] } },
  // es2022 everywhere: the SDK's WASM bootstrap uses top-level await, which
  // Vite's default browser target rejects outright.
  build: {
    target: "es2022",
    outDir: join(HERE, "..", "dist"),
    emptyOutDir: true,
  },
  esbuild: { target: "es2022" },
  optimizeDeps: { esbuildOptions: { target: "es2022" } },
});
