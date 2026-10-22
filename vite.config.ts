import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

/**
 * Uygulama kimliği — **tek kaynak `package.json`**.
 *
 * Sürüm ve kaynak bağlantısı build sırasında `define` ile gömülür; uygulama
 * içinde sabit sürüm yazmaz (About sekmesi otomatik güncel kalır).
 */
const pkg = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as {
  version: string;
  repository?: { url?: string };
  homepage?: string;
};

const repoUrl = pkg.repository?.url ?? pkg.homepage ?? "";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __REPO_URL__: JSON.stringify(repoUrl),
  },
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    outDir: "dist",
  },
});
