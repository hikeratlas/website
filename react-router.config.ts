import type { Config } from "@react-router/dev/config";

// Server-rendered, on Cloudflare Pages: the client half goes to public/
// (npm run build), the server half is functions/[[path]].ts's.
export default {
  ssr: true,
} satisfies Config;
