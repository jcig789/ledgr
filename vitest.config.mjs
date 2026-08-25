import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    alias: {
      obsidian: new URL("./src/data/__tests__/__mocks__/obsidian.ts", import.meta.url).pathname,
    },
  },
});
