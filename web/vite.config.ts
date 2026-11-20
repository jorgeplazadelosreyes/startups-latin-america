import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// base "./" so the build works on GitHub Pages project URLs (/<repo>/) without config.
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("echarts") || id.includes("zrender")) return "charts";
          if (id.includes("deck.gl") || id.includes("luma.gl") || id.includes("maplibre") || id.includes("math.gl") || id.includes("loaders.gl")) return "map";
        },
      },
    },
  },
});
