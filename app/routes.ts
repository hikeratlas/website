import type { RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

// app/routes/'s files, named as Remix named them (blog.<post>.mdx, hikes.$.tsx).
export default flatRoutes({ ignoredRouteFiles: ["**/.*"] }) satisfies RouteConfig;
