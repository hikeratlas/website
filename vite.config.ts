import mdx from "@mdx-js/rollup";
import { reactRouter } from "@react-router/dev/vite";
import remarkFrontmatter from "remark-frontmatter";
import remarkMdxFrontmatter from "remark-mdx-frontmatter";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import remarkRouteExports from "./mdx-route-exports";

export default defineConfig(({ isSsrBuild }) => ({
  // The site's own files (favicons, images, Pages' _headers and _routes.json),
  // served as they are. public/ is the built site (npm run build).
  publicDir: "static",
  plugins: [
    // The homepage and blog posts (app/content/home.mdx, app/routes/blog.*.mdx).
    { enforce: "pre", ...mdx({ remarkPlugins: [remarkFrontmatter, remarkMdxFrontmatter, remarkRouteExports] }) },
    reactRouter(),
  ],
  // ~/ is app/, in .mdx files too (tsconfig.json's paths, for the editor).
  resolve: {
    alias: {
      "~": fileURLToPath(new URL("./app", import.meta.url)),
      // Its web build on the server too: its exports list "node" first, whose
      // build reads its .wasm from disk (only the browser decodes tiles).
      "@bokuweb/zstd-wasm": fileURLToPath(new URL("./node_modules/@bokuweb/zstd-wasm/dist/web/index.web.js", import.meta.url)),
    },
  },
  // The server half runs on Cloudflare (workerd): everything bundled into it,
  // each package's worker build where it has one.
  ssr: isSsrBuild
    ? {
        target: "webworker",
        noExternal: true,
        resolve: { conditions: ["workerd", "worker", "browser"], externalConditions: ["workerd", "worker"] },
      }
    : undefined,
}));
