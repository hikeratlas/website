// A blog post's frontmatter "meta", "headers" and "handle" as its route's
// exports, as Remix's own compiler made them (handle carries a post's
// external scripts, e.g. highlight.js, for root.tsx's ExternalScripts):
//
//   ---
//   meta:
//     - title: "..."
//   headers:
//     Cache-Control: no-cache
//   ---
//
// remark-mdx-frontmatter exports the frontmatter (as `frontmatter`); this adds
// the exports reading it.
import { parse } from "acorn";
import type { Root } from "mdast";

const CODE = `export const meta = () => frontmatter?.meta ?? [];
export const headers = () => frontmatter?.headers ?? {};
export const handle = frontmatter?.handle;`;

export default function remarkRouteExports() {
  return (tree: Root) => {
    if (!tree.children.some((n) => n.type === "yaml")) return;
    const estree = parse(CODE, { ecmaVersion: "latest", sourceType: "module" });
    // An ESM node (mdxjsEsm): MDX takes its estree as is.
    tree.children.push({ type: "mdxjsEsm", value: CODE, data: { estree } } as unknown as Root["children"][number]);
  };
}
