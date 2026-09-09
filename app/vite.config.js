import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// CoinCurb.jsx bleibt im Repo-Wurzelverzeichnis die einzige Quelle; der Dev-Server darf sie von dort lesen.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, fs: { allow: [".."] } },
  build: { outDir: "dist", emptyOutDir: true },
});
