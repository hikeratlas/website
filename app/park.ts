// What the park sheet shows of a park's routes (website#95's redesign): each
// day hike's difficulty, time, kind of destination and trip reports, the
// filters over them, and the picks to start with. Pure functions of the
// routes document, so they're testable away from the map.
import type { Hike, ParkDoc, ParkReports, Route } from '~/hikes';

export type Difficulty = 'Easy' | 'Moderate' | 'Hard' | 'Scramble';
export const DIFFICULTIES: Difficulty[] = ['Easy', 'Moderate', 'Hard', 'Scramble'];

// From the route's hardest SAC grade (hikeratlas/routes), its climb and its
// length: SAC T4 and up is a scramble; 1,000 m of climb, 18 km or SAC T3 is
// hard; 400 m or 10 km is moderate; less is easy.
export function difficulty(r: Route): Difficulty {
  const sac = r.max_sac ?? 0;
  if (sac >= 4) return 'Scramble';
  if (r.gain >= 1000 || r.km >= 18 || sac === 3) return 'Hard';
  if (r.gain >= 400 || r.km >= 10) return 'Moderate';
  return 'Easy';
}

// Walking time in hours, to the half hour: 4 km an hour, plus an hour for
// each 600 m of climb (a simple form of Naismith's rule).
export function hours(r: Route): number {
  return Math.max(0.25, Math.round((r.km / 4 + r.gain / 600) * 2) / 2);
}

export function timeLabel(h: number, r?: Route): string {
  if (h < 1) {
    const min = r ? Math.max(15, Math.round(((r.km / 4 + r.gain / 600) * 60) / 5) * 5) : Math.round(h * 60);
    return `about ${min} min`;
  }
  return `~${h} h`;
}

export type TimeBand = 'short' | 'half' | 'full';
export function timeBand(h: number): TimeBand {
  return h <= 2 ? 'short' : h <= 5 ? 'half' : 'full';
}

// What SAC grade a route's hardest stretch is, in words.
export const SAC_WORDS: Record<number, string> = {
  1: 'SAC T1: a good path, easy going',
  2: 'SAC T2 at its hardest: steep and rocky in places, sure footing needed',
  3: 'SAC T3 at its hardest: rough, exposed in places, hands sometimes needed for balance',
  4: 'SAC T4 at its hardest: scrambling, with hands on rock and exposure; route-finding may be needed',
  5: 'SAC T5 at its hardest: demanding alpine scrambling',
  6: 'SAC T6 at its hardest: difficult alpine terrain',
};

export const DIFF_COLORS: Record<Difficulty, string> = {
  Easy: 'bg-emerald-50 text-emerald-800',
  Moderate: 'bg-amber-100 text-amber-900',
  Hard: 'bg-orange-100 text-orange-800',
  Scramble: 'bg-red-100 text-red-900',
};

// CSS backgrounds. "other" (hikeratlas/routes: what no class covers, i.e.
// unmapped, or farmland, a town) is striped, as unknown rather than a kind of
// ground; routes lists it last.
export const TERRAIN_COLORS: Record<string, string> = {
  forest: '#2f6f4e', 'alpine rock': '#a8a29e', meadow: '#a3c97a', scrub: '#c9b38a',
  glacier: '#9fd3ef', water: '#5ab4e6', wetland: '#7fb8a4', sand: '#e4cf9a',
  other: 'repeating-linear-gradient(135deg, #e7e5e4 0 3px, #d6d3d1 3px 6px)',
};
export const TERRAIN_TITLES: Record<string, string> = {
  other: 'Not mapped, or farmland, towns and the like',
};
// Routes' land cover is OSM's, and ESA WorldCover's where OSM has none
// (hikeratlas/basemap#167).
export const WORLDCOVER_ATTRIBUTION =
  "<a href='https://esa-worldcover.org/'>Land cover: ESA WorldCover 2021 (CC BY 4.0)</a>";

// A route's shape in words: "loop", "out & back", or for a one-way hike
// (one you may only walk one way, website#109: the Grouse Grind is up only)
// "one way", with how you come back where known ("one way, Blue Grouse
// Gondola down").
export function shapeWords(kind: string, returnBy?: string | null): string {
  if (kind === 'loop') return 'loop';
  if (kind === 'out-and-back') return 'out & back';
  if (kind === 'point-to-point') return 'point to point';
  return returnBy ? `one way, ${returnBy} down` : 'one way';
}

// A day hike in the park sheet.
export interface ParkHike {
  id: string; // as CuratedRoutes' lookup takes: <park>/day/<i>
  title: string;
  from: string; // its trailhead, without "trailhead"
  route: Route;
  diff: Difficulty;
  hours: number;
  loop: boolean;
  shape: string; // shapeWords
  lake: boolean;
  summit: boolean;
  features: string[]; // the lakes, peaks, waterfalls... it goes by
  reports: number; // trip reports and guides that follow it
  score: number;
}

// "Helen Lake Trail trailhead" -> "Helen Lake Trail"; "Fish Creek Parking
// Lot" -> "Fish Creek parking".
export function trailhead(s: string): string {
  return s.replace(/\s+trailhead$/i, '').replace(/\s+Parking( Lot)?$/i, ' parking');
}

const named = (h: { name?: string | null }, otherwise: string) => (typeof h.name === 'string' && h.name ? h.name : otherwise);

export function parkHikes(doc: ParkDoc, reports: ParkReports | null): ParkHike[] {
  const park = String(doc.park?.id ?? '');
  return doc.day_hikes.map((h: Hike, i) => {
    const r = h.route;
    const kinds = new Map(r.passes.map(([k, names]) => [k, names]));
    const features = r.passes.filter(([k]) => ['lake', 'peak', 'waterfall', 'pass', 'glacier', 'viewpoint'].includes(k)).flatMap(([, n]) => n)
      .filter((n) => n && !/^unnamed$/i.test(n));
    const rep = reports?.[h.key ?? `${park}/day/${i}`];
    return {
      id: `${park}/day/${i}`,
      title: named(h, h.dest),
      from: trailhead(h.from),
      route: r,
      diff: difficulty(r),
      hours: hours(r),
      loop: h.kind === 'loop',
      shape: shapeWords(h.kind, h.return_by),
      lake: h.dest_kind === 'lake' || kinds.has('lake'),
      summit: h.dest_kind === 'peak',
      features: [...new Set(features)].slice(0, 3),
      reports: rep?.reports?.length ?? 0,
      score: h.score ?? 0,
    };
  });
}

export interface Filters {
  time: TimeBand | 'any';
  diffs: Difficulty[];
  lakes: boolean;
  summits: boolean;
  loops: boolean;
  reports: boolean;
}
export const NO_FILTERS: Filters = { time: 'any', diffs: [], lakes: false, summits: false, loops: false, reports: false };

export function matches(h: ParkHike, f: Filters): boolean {
  return (f.time === 'any' || timeBand(h.hours) === f.time)
    && (!f.diffs.length || f.diffs.includes(h.diff))
    && (!f.lakes || h.lake) && (!f.summits || h.summit) && (!f.loops || h.loop) && (!f.reports || h.reports > 0);
}

export type Sort = 'best' | 'shortest' | 'least-climb' | 'highest';
export function sorted(hikes: ParkHike[], s: Sort): ParkHike[] {
  const by: Record<Sort, (a: ParkHike, b: ParkHike) => number> = {
    best: (a, b) => b.score - a.score,
    shortest: (a, b) => a.route.km - b.route.km,
    'least-climb': (a, b) => a.route.gain - b.route.gain,
    highest: (a, b) => b.route.max_ele - a.route.max_ele,
  };
  return [...hikes].sort(by[s]);
}

// Where to start: the best easy hike, the best moderate one, and the best
// hard one or scramble, each where the park has one; only for a park with
// enough hikes to need it.
export const PICKS_FROM = 8;
export function picks(hikes: ParkHike[]): { tag: string; hike: ParkHike }[] {
  if (hikes.length < PICKS_FROM) return [];
  const best = (ds: Difficulty[]) => sorted(hikes.filter((h) => ds.includes(h.diff)), 'best')[0];
  return [
    { tag: 'Easy', hike: best(['Easy']) },
    { tag: 'Half day', hike: best(['Moderate']) },
    { tag: 'Big day', hike: best(['Hard', 'Scramble']) },
  ].filter((p): p is { tag: string; hike: ParkHike } => !!p.hike);
}

// A park with this few day hikes (and nothing else to list) gets the compact
// sheet: no filters, a summary, every hike in full.
export const SMALL_PARK = 5;
export function isSmall(doc: ParkDoc): boolean {
  return doc.day_hikes.length <= SMALL_PARK && !doc.base_camps.length && !doc.point_to_points.length && !(doc.see_also ?? []).length;
}

// A small park's summary, from its numbers alone: "3 short, nearly flat
// loops, each under an hour."
export function summary(hikes: ParkHike[]): string {
  const n = hikes.length;
  if (!n) return '';
  const words = ['', 'One', 'Two', 'Three', 'Four', 'Five'];
  const count = words[n] ?? String(n);
  const short = hikes.every((h) => h.route.km <= 6);
  const flat = hikes.every((h) => h.route.gain < 100);
  const loops = hikes.every((h) => h.loop);
  const noun = loops ? (n === 1 ? 'loop' : 'loops') : n === 1 ? 'hike' : 'hikes';
  const easy = hikes.every((h) => h.diff === 'Easy');
  const adj = [short ? 'short' : '', flat ? 'nearly flat' : easy ? 'easy' : ''].filter(Boolean).join(', ');
  const longest = Math.max(...hikes.map((h) => h.hours));
  const when = longest < 1 ? (n === 1 ? ', under an hour' : ', each under an hour')
    : longest <= 2 ? (n === 1 ? ', under two hours' : ', each under two hours')
    : n === 1 ? `, about ${longest} hours` : `, the longest about ${longest} hours`;
  return `${count} ${adj ? `${adj} ` : ''}${noun}${when}.`;
}

// A route's shape for a thumbnail: its line, scaled into a size×size box
// (longitude scaled by latitude so it isn't stretched), as SVG points.
export function thumb(line: [number, number][], size = 56, pad = 6): string {
  if (line.length < 2) return '';
  const step = Math.max(1, Math.floor(line.length / 60));
  const pts = line.filter((_, i) => i % step === 0 || i === line.length - 1);
  const k = Math.cos((pts[0][1] * Math.PI) / 180);
  const xs = pts.map(([x]) => x * k), ys = pts.map(([, y]) => -y);
  const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
  const sc = (size - 2 * pad) / Math.max(x1 - x0, y1 - y0, 1e-9);
  const dx = (size - (x1 - x0) * sc) / 2, dy = (size - (y1 - y0) * sc) / 2;
  return xs.map((x, i) => `${((x - x0) * sc + dx).toFixed(1)},${((ys[i] - y0) * sc + dy).toFixed(1)}`).join(' ');
}

// What a route passes, in words: "lakes, a waterfall and a summit".
const KIND_WORDS: Record<string, [string, string]> = {
  lake: ['a lake', 'lakes'], peak: ['a summit', 'summits'], waterfall: ['a waterfall', 'waterfalls'],
  glacier: ['a glacier', 'glaciers'], pass: ['a pass', 'passes'], viewpoint: ['a viewpoint', 'viewpoints'],
  hut: ['a hut', 'huts'], cave: ['a cave', 'caves'], arch: ['an arch', 'arches'],
};
export function featureWords(passes: [string, string[]][]): string {
  const parts = passes.filter(([k]) => KIND_WORDS[k]).map(([k, n]) => KIND_WORDS[k][n.length > 1 ? 1 : 0]);
  if (!parts.length) return '';
  const s = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
  return s[0].toUpperCase() + s.slice(1);
}

// Why a route made the list, in words, from its score's parts
// (hikeratlas/routes' curate.rs score: each part is its weight times a
// measure from 0 to 1): the parts that counted for it, each past a bar,
// best first. Its destination's appeal, which every hike has, says nothing.
const WHY_BARS: Record<string, [number, (r: Route) => string]> = {
  feature_kinds: [1.08, (r) => featureWords(r.passes)], // 3+ kinds of thing (of 0.6 × 3)
  popularity: [0.6, () => 'Popular'], // of 1.5
  loop: [0.5, () => 'A loop: no retracing your steps'],
  known_route: [0.4, () => 'Follows a named hiking route'], // a fifth of it, of 2.0
  open_high: [0.5, () => 'Open and high: above the trees'], // of 2.5
  lc_variety: [0.7, () => 'Varied terrain'], // of 1.4
};
export function whyWords(why: [string, number][] | undefined, r: Route): string[] {
  return (why ?? [])
    .filter(([k, v]) => WHY_BARS[k] && v >= WHY_BARS[k][0])
    .sort((a, b) => b[1] - a[1])
    .map(([k]) => WHY_BARS[k][1](r))
    .filter(Boolean);
}

// A route as GPX, for a GPS or phone app.
export function gpx(name: string, line: [number, number][]): string {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pts = line.map(([x, y]) => `<trkpt lat="${y.toFixed(6)}" lon="${x.toFixed(6)}"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Hiker Atlas" xmlns="http://www.topografix.com/GPX/1/1">
<trk><name>${esc(name)}</name><trkseg>
${pts}
</trkseg></trk>
</gpx>
`;
}
