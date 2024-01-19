import type { MetaFunction } from "@remix-run/cloudflare";

export const meta: MetaFunction = () => {
  return [
    { title: "Hiker Atlas" },
    { name: "description", content: "Explore hiking trails and plan your next trip." },
  ];
};

export default function Index() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", lineHeight: "1.8" }}>
      <h1>Hiker Atlas</h1>
      <p>Hey! I'm <a href="https://cldellow.com/">Colin</a>. This is a hobby project, so there's not much here yet. You might want to check out:</p>
      <ul>
        <li>
          <a
            href="/map"
          >
            the map
          </a>, showing an extract of the planet
        </li>
        <li>
          <a
            href="/blog"
          >
            the blog
          </a>, detailing random cartography things I learned while building this
        </li>
      </ul>
      <p>This project is open source, see <a href="https://github.com/hikeratlas/">hikeratlas on GitHub</a>.</p>
    </div>
  );
}
