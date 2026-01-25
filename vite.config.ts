import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const serverTarget = process.env.VITE_SERVER_URL ?? "http://localhost:8787";
const devServerPort = Number(process.env.VITE_PORT ?? 5173);

export default defineConfig({
  plugins: [react()],
  server: {
    port: devServerPort,
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
