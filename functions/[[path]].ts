// Cloudflare Pages Functions: every request not for a static file
// (static/_routes.json) goes to the site's server build.
import { createPagesFunctionHandler } from "@react-router/cloudflare";
import { RouterContextProvider, type ServerBuild } from "react-router";
// Made by react-router build (npm run build), before Pages bundles this.
// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore
import * as serverBuild from "../build/server/index.js";

export const onRequest = createPagesFunctionHandler({
  build: serverBuild as unknown as ServerBuild,
  // Loaders read nothing from it (no bindings); React Router 8 asks for one.
  getLoadContext: () => new RouterContextProvider(),
});
