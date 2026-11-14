// npm test: unit tests (app/**/*.test.ts), in Node. Its own config rather than
// vite.config.ts, whose React Router and MDX plugins build the site and
// aren't for tests; only the ~/ alias is shared.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "~": fileURLToPath(new URL("./app", import.meta.url)) },
  },
  test: {
    include: ["app/**/*.test.ts"],
    environment: "node",
  },
});
