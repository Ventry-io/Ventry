import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "url";
import path from "path";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(fileURLToPath(new URL("./", import.meta.url)), "src"),
      "@root": path.resolve(fileURLToPath(new URL("./", import.meta.url))),
    },
  },
  test: {
    globals: true,
    environment: "jsdom",
    setupFiles: ["./src/test-setup.ts"],
    // MUI forms re-render slowly in jsdom (~0.7s each); under the full parallel run they exceed 5s.
    testTimeout: 30_000,
  },
});
