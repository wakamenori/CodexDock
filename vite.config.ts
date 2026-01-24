import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverTarget = process.env.VITE_SERVER_URL ?? "http://localhost:8787";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: serverTarget,
        changeOrigin: true,
      },
      "/ws": {
        target: serverTarget,
        ws: true,
      },
    },
  },
});
