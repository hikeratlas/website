// Cloudflare Pages Functions: every request not for a static file
// (static/_routes.json) goes to the site's server build.
import { createPagesFunctionHandler } from "@react-router/cloudflare";
import { RouterContextProvider, type RouterContext, type ServerBuild } from "react-router";
// Made by react-router build (npm run build), before Pages bundles this.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as serverBuild from "../build/server/index.js";

const build = serverBuild as unknown as ServerBuild;
// The server build's own context key (app/cloudflare.ts, re-exported by
// entry.server.tsx): importing app/cloudflare.ts here would make a second
// one, which loaders wouldn't find.
const { envContext } = build.entry.module as unknown as { envContext: RouterContext<object> };

export const onRequest = createPagesFunctionHandler({
  build,
  // The bindings (the curation database, curators' keys) for loaders and
  // actions: context.get(envContext).
  getLoadContext: ({ context }) => {
    const c = new RouterContextProvider();
    c.set(envContext, context.cloudflare.env as object);
    return c;
  },
});
