import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// web3.js / anchor expect Node's Buffer and `global`; polyfilled in src/main.tsx and here.
export default defineConfig({
  plugins: [react()],
  define: { global: "globalThis" },
  resolve: { alias: { buffer: "buffer/" } },
  server: { port: 5173 },
  test: { environment: "node" },
} as any);
