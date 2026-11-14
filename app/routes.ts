import type { RouteConfig } from "@react-router/dev/routes";
import { flatRoutes } from "@react-router/fs-routes";

// app/routes/'s files, named as Remix named them (blog.<post>.mdx, hikes.$.tsx),
// except unit tests (*.test.ts, beside what they test).
export default flatRoutes({ ignoredRouteFiles: ["**/.*", "**/*.test.*"] }) satisfies RouteConfig;
