// A blog post's frontmatter "meta" and "headers" as its route's meta and
// headers exports, as Remix's own compiler made them:
//
//   ---
//   meta:
//     - title: "..."
//   headers:
//     Cache-Control: no-cache
//   ---
//
// remark-mdx-frontmatter exports the frontmatter (as `frontmatter`); this adds
// the two exports reading it.
import { parse } from "acorn";
import type { Root } from "mdast";

const CODE = `export const meta = () => frontmatter?.meta ?? [];
export const headers = () => frontmatter?.headers ?? {};`;

export default function remarkRouteExports() {
  return (tree: Root) => {
    if (!tree.children.some((n) => n.type === "yaml")) return;
    const estree = parse(CODE, { ecmaVersion: "latest", sourceType: "module" });
    // An ESM node (mdxjsEsm): MDX takes its estree as is.
    tree.children.push({ type: "mdxjsEsm", value: CODE, data: { estree } } as unknown as Root["children"][number]);
  };
}
