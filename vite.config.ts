import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";
export default defineConfig({
  plugins: [vue()],
  root: "apps/extension",
  base: "/",
  build: {
    outDir: "../../dist/web",
    emptyOutDir: true,
    rollupOptions: { input: "apps/extension/index.html" },
  },
});
