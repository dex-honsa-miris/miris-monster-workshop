import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { workshopApi } from "./server/api";

export default defineConfig({
  plugins: [react(), workshopApi()],
});
