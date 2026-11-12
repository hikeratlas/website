// The homepage's featured park and hike: from a hand-picked list of
// showcase parks, the one nearest the visitor (Cloudflare's guess at where
// they are) if one is close, else the day's; and that park's best moderate
// hike. Read from the live routes build, as the hike pages are, so the
// counts and routes are always the current ones.
import { hikeEntries, hikesPath, indexUrl, parkDoc, parkReports, regionsUrl, type BundleIndex, type Regions, type Route } from '~/hikes';
import { parkHikes, picks, timeLabel, type Difficulty } from '~/park';

// Well-known parks with plenty of hikes (25+), across both countries, as
// regions.json's paths.
export const SHOWCASE = [
  'canada/alberta/banff-national-park',
  'canada/alberta/jasper-national-park',
  'canada/british-columbia/yoho-national-park',
  'canada/british-columbia/kootenay-national-park',
  'canada/british-columbia/garibaldi-provincial-park',
  'canada/british-columbia/golden-ears-provincial-park',
  'canada/british-columbia/e-c-manning-provincial-park',
  'canada/british-columbia/strathcona-provincial-park',
  'canada/british-columbia/mount-robson-provincial-park',
  'canada/ontario/algonquin-provincial-park',
  'canada/ontario/killarney-provincial-park',
  'canada/quebec/parc-national-du-mont-tremblant',
  'canada/new-brunswick/fundy-national-park',
  'canada/nova-scotia/cape-breton-highlands-national-park',
  'canada/newfoundland-and-labrador/gros-morne-national-park',
  'united-states/washington/mount-rainier-national-park',
  'united-states/washington/olympic-national-park',
  'united-states/california/yosemite-national-park',
  'united-states/california/sequoia-national-park',
  'united-states/california/joshua-tree-national-park',
  'united-states/utah/zion-national-park',
  'united-states/utah/bryce-canyon-national-park',
  'united-states/arizona/grand-canyon-national-park',
  'united-states/wyoming/grand-teton-national-park',
  'united-states/montana/waterton-glacier-international-peace-park',
  'united-states/colorado/rocky-mountain-national-park',
  'united-states/north-carolina/great-smoky-mountains-national-park',
  'united-states/virginia/shenandoah-national-park',
  'united-states/new-hampshire/white-mountain-national-forest',
  'united-states/new-york/adirondack-park',
  'united-states/maine/acadia-national-park',
];

// The featured hike: the best easy or moderate one, if it scores this share
// of the park's best.
const APPROACHABLE_WITHIN = 0.7;

// A showcase park this close (km, centre to centre) counts as near.
const NEAR_KM = 500;

export interface Featured {
  near: boolean;
  // Which showcase park it is, when one was asked for (?showcase=N, for
  // checking them one by one).
  showcase: { index: number; count: number } | null;
  park: {
    name: string;
    region: string;
    path: string;
    counts: [number, string][];
    starts: { tag: string; title: string; km: number }[]; // its picks to start with
    id: string; // its OSM id, for its outline on the map
    bounds: [number, number, number, number]; // most of its routes (w, s, e, n)
  };
  hike: {
    title: string;
    path: string;
    from: string;
    km: number;
    gain: number;
    time: string;
    loop: boolean;
    diff: Difficulty;
    sac: number;
    landcover: [string, number][];
    passes: string[];
    reports: number;
    bounds: [number, number, number, number]; // its line's box (w, s, e, n)
    coords: [number, number][]; // its line, thinned, for its elevation profile
    km_total: number;
    // What it passes, in order, numbered, with where in the line's box.
    along: { n: number; name: string; kind: string; km: number; at: [number, number] }[];
  };
}

async function getJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cf: { cacheTtl: 300 } } as RequestInit);
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

function km(a: [number, number], b: [number, number]): number {
  const rad = Math.PI / 180;
  const h = Math.sin(((b[1] - a[1]) * rad) / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(((b[0] - a[0]) * rad) / 2) ** 2;
  return 12742 * Math.asin(Math.sqrt(h));
}

// Lines scaled together into a w x h box (longitude scaled by latitude), as
// SVG points, each thinned to about `n` points. The box fits `frame`'s
// points (default: all of them) between the `trim` and 1 - `trim` quantiles,
// grown by `grow` on each side: a park's outlying parcels (Acadia's Schoodic
// and islands) run off the edge instead of shrinking the rest to a corner.
export function fit(lines: [number, number][][], w: number, h: number, opts: { pad?: number; n?: number; trim?: number; frame?: [number, number][][]; grow?: number } = {}): string[] {
  const { pad = 12, n = 60, trim = 0, grow = 0 } = opts;
  const pts = (opts.frame ?? lines).flat();
  if (!pts.length) return [];
  const k = Math.cos((pts[0][1] * Math.PI) / 180);
  const q = (v: number[], f: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))]; };
  const xs = pts.map(([x]) => x * k), ys = pts.map(([, y]) => -y);
  let x0 = q(xs, trim), x1 = q(xs, 1 - trim), y0 = q(ys, trim), y1 = q(ys, 1 - trim);
  const gx = (x1 - x0) * grow, gy = (y1 - y0) * grow;
  x0 -= gx; x1 += gx; y0 -= gy; y1 += gy;
  const sc = Math.min((w - 2 * pad) / Math.max(x1 - x0, 1e-9), (h - 2 * pad) / Math.max(y1 - y0, 1e-9));
  const dx = (w - (x1 - x0) * sc) / 2, dy = (h - (y1 - y0) * sc) / 2;
  return lines.map((line) => {
    const step = Math.max(1, Math.floor(line.length / n));
    return line.filter((_, i) => i % step === 0 || i === line.length - 1)
      .map(([x, y]) => `${((x * k - x0) * sc + dx).toFixed(1)},${((-y - y0) * sc + dy).toFixed(1)}`).join(' ');
  });
}

// The box around most of the points (between the trim and 1 - trim
// quantiles), as [w, s, e, n].
function trimmedBox(pts: [number, number][], trim: number): [number, number, number, number] {
  const q = (v: number[], f: number) => { const s = [...v].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round(f * (s.length - 1))))]; };
  const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
  return [q(xs, trim), q(ys, trim), q(xs, 1 - trim), q(ys, 1 - trim)];
}

const thin = (line: [number, number][], n: number) => {
  const step = Math.max(1, Math.floor(line.length / n));
  return line.filter((_, i) => i % step === 0 || i === line.length - 1);
};

// at: the visitor's [lon, lat], if known; day: which day it is, for the
// rotation.
// showcase: which showcase park to feature (the homepage's ?showcase=N), else
// null to choose.
export async function featured(build: string, at: [number, number] | null, day: number, showcase: number | null = null): Promise<Featured | null> {
  const [regions, index] = await Promise.all([getJson<Regions>(regionsUrl(build)), getJson<BundleIndex>(indexUrl(build))]);
  if (!regions || !index) return null;
  const parks = SHOWCASE.flatMap((path) => {
    const [c, s, a] = path.split('/');
    const country = regions.countries.find((x) => x.slug === c);
    const state = country?.states.find((x) => x.slug === s);
    const area = state?.areas.find((x) => x.slug === a);
    return area?.bbox ? [{ path, state: state!.name, area, mid: [(area.bbox[0] + area.bbox[2]) / 2, (area.bbox[1] + area.bbox[3]) / 2] as [number, number] }] : [];
  });
  if (!parks.length) return null;
  const nearest = at ? parks.map((p) => ({ p, d: km(at, p.mid) })).sort((a, b) => a.d - b.d)[0] : null;
  const near = !!nearest && nearest.d <= NEAR_KM;
  const wrap = (i: number) => ((i % parks.length) + parks.length) % parks.length;
  const pick = showcase !== null ? parks[wrap(showcase)] : near ? nearest!.p : parks[wrap(day)];

  const [doc, reports] = await Promise.all([
    parkDoc(build, index, pick.area.id).catch(() => null),
    parkReports(build, index, pick.area.id).catch(() => null),
  ]);
  if (!doc || !doc.day_hikes.length) return null;
  const hikes = parkHikes(doc, reports);
  // The best approachable hike (easy or moderate) that's among the park's
  // good ones (APPROACHABLE_WITHIN of its best), else the best.
  const byScore = [...hikes].sort((a, b) => b.score - a.score);
  const h = byScore.find((x) => (x.diff === 'Easy' || x.diff === 'Moderate') && x.score >= APPROACHABLE_WITHIN * byScore[0].score) ?? byScore[0];
  const entry = hikeEntries(doc).find((e) => e.id === h.id);
  const parkPath = hikesPath(pick.path.split('/'));
  const top = [...doc.day_hikes].sort((a, b) => (b.score ?? 0) - (a.score ?? 0)).slice(0, 60);
  const counts: [number, string][] = ([
    [doc.day_hikes.length, 'day hike'],
    [doc.base_camps.length, 'base camp'],
    [doc.point_to_points.length + (doc.see_also ?? []).length, 'multi-day trip'],
    [(doc.stops ?? []).length, 'quick stop'],
  ] as [number, string][]).filter(([n]) => n > 0);
  return {
    near: showcase === null && near,
    showcase: showcase !== null ? { index: wrap(showcase), count: parks.length } : null,
    park: {
      name: doc.park?.name ?? pick.area.name,
      region: pick.state,
      path: parkPath,
      counts,
      id: String(doc.park?.id ?? pick.area.id),
      bounds: trimmedBox(top.flatMap((x) => x.route.line), 0.04),
      starts: picks(hikes).map((p) => ({ tag: p.tag, title: hikeEntries(doc).find((e) => e.id === p.hike.id)?.title ?? p.hike.title, km: p.hike.route.km })),
    },
    hike: {
      title: entry?.title ?? h.title,
      path: entry ? `${parkPath}/${entry.slug}` : parkPath,
      from: h.from,
      km: h.route.km,
      gain: h.route.gain,
      time: timeLabel(h.hours, h.route),
      loop: h.loop,
      diff: h.diff,
      sac: h.route.max_sac ?? 0,
      landcover: h.route.landcover,
      passes: h.features,
      reports: h.reports,
      bounds: trimmedBox(h.route.line, 0),
      coords: thin(h.route.line, 300),
      km_total: h.route.km,
      along: alongPoints(h.route),
    },
  };
}

// A route's numbered features (routes' "along", from builds after
// hikeratlas/routes#170): at most 6, unnamed ones and repeats left out.
function alongPoints(r: Route): Featured['hike']['along'] {
  const seen = new Set<string>();
  return (r.along ?? []).filter(([, n]) => n && !/^unnamed$/i.test(n) && !seen.has(n) && !!seen.add(n)).slice(0, 6)
    .map(([kind, name, km, at], i) => ({ n: i + 1, name, kind, km, at }));
}
