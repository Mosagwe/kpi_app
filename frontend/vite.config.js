import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET || "http://127.0.0.1:3010";

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: "dist",
    emptyOutDir: true
  },
  server: {
    port: 5174,
    proxy: {
      "/api": apiProxyTarget
    }
  }
});
