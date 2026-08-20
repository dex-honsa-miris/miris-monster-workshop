import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { workshopApi } from "./server/api";

export default defineConfig({
  plugins: [react(), workshopApi()],
  // The viewer (viewer/index.html) lives in this repo but is its own build
  // (viewer/vite.config.ts, target es2022). Vite's dep scanner crawls every
  // .html under the root by default, so without this it follows
  // viewer/main.ts into @miris-inc/three, whose top-level await breaks
  // esbuild prebundling and takes down THIS app's dev server. Found live on
  // the first StackBlitz boot of the template (2026-08-20 dry run).
  optimizeDeps: { entries: ["index.html"] },
});
