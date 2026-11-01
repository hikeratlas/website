// Which basemap build to show.
//
// The basemap repo publishes each build to R2 as <namespace>.pmtiles and
// <namespace>.style.json, where the namespace is an area (e.g. nova-scotia)
// or a PR build (e.g. pr-45/nova-scotia). See hikeratlas/basemap's
// build-area.yml.
//
// - ?build=<namespace> picks a build explicitly (used for PR previews).
// - <area>.hikeratlas.com picks that area's build.
// - Otherwise, null: show the main north-america map.

export const TILES_ROOT = "https://public.hikeratlas.com";

// Only allow names the basemap pipeline can produce, so ?build= can't be used
// to load arbitrary paths.
const NAMESPACE_RE = /^[a-z0-9-]+(\/[a-z0-9-]+)?$/;
const AREA_HOST_RE = /^([a-z0-9-]+)\.hikeratlas\.com$/;

// Subdomains that aren't area builds.
const RESERVED_SUBDOMAINS = new Set(["www", "public"]);

export function buildFor(url: URL): string | null {
  const param = url.searchParams.get("build");
  if (param !== null) {
    return NAMESPACE_RE.test(param) ? param : null;
  }

  const m = url.hostname.match(AREA_HOST_RE);
  if (m && !RESERVED_SUBDOMAINS.has(m[1])) {
    return m[1];
  }

  return null;
}

export function styleUrl(build: string | null): string {
  return build ? `${TILES_ROOT}/${build}.style.json` : `${TILES_ROOT}/style.json`;
}

export function tilesUrl(build: string): string {
  return `${TILES_ROOT}/${build}.pmtiles`;
}
