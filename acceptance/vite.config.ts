import { defineConfig } from "vite";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root,
  build: {
    outDir: resolve(root, "../dist/acceptance-host"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        host: resolve(root, "host.html"),
        viewer: resolve(root, "viewer.html"),
      },
    },
  },
});
