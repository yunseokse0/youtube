import path from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "packages/**/*.test.ts"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@donation-alert-overlay": path.resolve(__dirname, "./packages/donation-alert-overlay/src/index.ts"),
      "@donation-alert-overlay/core": path.resolve(__dirname, "./packages/donation-alert-overlay/src/core.ts"),
      "@donation-alert-overlay/source": path.resolve(__dirname, "./packages/donation-alert-overlay/src/source.ts"),
      "@donation-alert-overlay/react": path.resolve(__dirname, "./packages/donation-alert-overlay/src/react/index.ts"),
      "@donation-alert-overlay/types": path.resolve(__dirname, "./packages/donation-alert-overlay/src/types.ts"),
    },
  },
});
