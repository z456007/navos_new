import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  publicDir: false,
  build: {
    outDir: "dist-admin",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: resolve(__dirname, "web/src/main.tsx"),
      output: {
        entryFileNames: "assets/admin.js",
        chunkFileNames: "assets/[name].js",
        assetFileNames: "assets/admin[extname]"
      }
    }
  }
});
