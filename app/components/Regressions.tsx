// The named-regressions page for hikeratlas/routes (routes/dev.regressions):
// each park's proposed regressions (routes' fixtures/proposals/: trails the
// park lists on its own website) and its existing entries
// (fixtures/expect/), on the map with the OSM trail of each one's name and
// the hikes routes offers near it.
//
// A proposal: accept one of those hikes, or draw the hike meant, and it
// becomes a trail entry with a trace; or reject it. An entry: redraw or
// re-pick its trace, change the length it expects, or delete it.
// Changes are kept in this browser until committed: one commit to a working
// branch in routes, and a pull request from it, so routes' CI checks them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import type { Map as MaplibreMap, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import Map from '~/components/Map';
import { styleUrl, tilesUrl } from '~/build';
import { parkRoutes } from '~/components/CuratedRoutes';
import { LABEL_FONT, endFeatures, useWaypoints } from '~/components/useWaypoints';
import { trailGeometry } from '~/routing/trail';
import { CoalescingSource, type Source } from '~/routing/source';
import { withZstd, type Decompress } from '~/zstd';
import type { LngLat } from '~/routing/graph';
import type { ParkDoc, Route } from '~/hikes';
import { GitHub, REPO } from '~/regressions/github';
import {
  entryFor, entryKey, fixtureFor, key, norm, parseJsonl, passes, simplify, toJsonl, walks, withFields,
  type Decision, type Entry, type EntryEdit, type ParkFile, type Proposal,
} from '~/regressions/model';

declare const pmtiles: {
  FetchSource: new (url: string) => Source;
  PMTiles: new (source: string | Source, cache?: unknown, decompress?: Decompress) => {
    decompress: Decompress;
    getZxy(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined>;
  };
};

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const C = { trail: '#f59e0b', cand: '#2563eb', sel: '#dc2626', draw: '#7c3aed', trace: '#111827' };
const TOKEN_KEY = 'regressions:github-token';
const SETTINGS_KEY = 'regressions:settings';
const DECISIONS_KEY = 'regressions:decisions';
const EDITS_KEY = 'regressions:entry-edits';

interface Settings { branch: string; base: string }
type Box = [number, number, number, number];
// A park: its proposals and its entries (either may be empty), by the file
// stem both directories name it by.
interface Park extends ParkFile { entries: Entry[]; bbox?: Box }
interface Offered { label: string; name: string | null; km: number; line: LngLat[]; share: number; check?: ReturnType<typeof passes> }
type Decisions = Record<string, Record<string, Decision>>;   // stem -> proposal key -> decision
type Edits = Record<string, Record<string, EntryEdit>>;      // stem -> entry key -> edit
// What's selected: a proposal or an entry, by index in its park's list.
type Subject = { type: 'proposal'; i: number } | { type: 'entry'; i: number };

function stored<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}
function store(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } }

function bounds(lines: LngLat[][]): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const l of lines) for (const [x, y] of l) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [[w, s], [e, n]];
}
const pad = (b: [[number, number], [number, number]], d: number): Box => [b[0][0] - d, b[0][1] - d, b[1][0] + d, b[1][1] + d];

// Every hike routes offers in a park, with a label as the site shows it and
// the name it's offered under, if any (what routes' expect.py matches).
function offeredIn(doc: ParkDoc): { label: string; name: string | null; route: Route }[] {
  const n = (r: { name?: string | null }) => (r.name ? r.name : null);
  return [
    ...doc.day_hikes.map((h) => ({ label: n(h) ?? `${h.dest} from ${h.from}`, name: n(h), route: h.route })),
    ...doc.base_camps.flatMap((b) => b.hikes.map((h) => ({ label: n(h) ?? `${h.dest} from ${b.camp}`, name: n(h), route: h.route }))),
    ...doc.point_to_points.map((t) => ({ label: `${n(t) ?? `${t.from} to ${t.to}`} (multi-day)`, name: n(t), route: t.route })),
  ];
}

const mergeEdits = <T,>(all: Record<string, Record<string, T>>, stem: string, k: string, v: T | null) => {
  const next = { ...all, [stem]: { ...(all[stem] ?? {}) } };
  if (v) next[stem][k] = v; else delete next[stem][k];
  if (!Object.keys(next[stem]).length) delete next[stem];
  return next;
};

export default function Regressions({ build }: { build: string | null }) {
  const routesBuild = build ?? 'north-america';
  const [map, setMap] = useState<MaplibreMap | null>(null);
  const [token, setToken] = useState<string>('');
  const [login, setLogin] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({ branch: 'regressions', base: 'main' });
  const [showSettings, setShowSettings] = useState(false);
  // Phones: the map takes 70% of the screen instead of half (to drag points).
  const [bigMap, setBigMap] = useState(false);
  useEffect(() => { map?.resize(); }, [map, bigMap]);
  const [parks, setParks] = useState<Park[]>([]);
  const [readFrom, setReadFrom] = useState<string>('');
  const [pull, setPull] = useState<{ number: number; html_url: string } | null>(null);
  const [loadMsg, setLoadMsg] = useState<string>('Loading…');
  const [stem, setStem] = useState<string>('');
  const [tab, setTab] = useState<'proposals' | 'entries'>('proposals');
  const [subject, setSubject] = useState<Subject | null>(null);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  // What the URL names (?park=<file stem>&tab=entries&item=<name>[&km=<km>]),
  // opened once the parks have loaded; the URL then follows what's open, so
  // a page can be bookmarked or shared.
  const linked = useRef<{ park: string; tab?: string; item?: string; km?: number } | null>(null);
  if (typeof window !== 'undefined' && linked.current === null) {
    const q = new URLSearchParams(window.location.search);
    const park = q.get('park');
    linked.current = park ? { park, tab: q.get('tab') ?? undefined, item: q.get('item') ?? undefined, km: q.get('km') ? Number(q.get('km')) : undefined } : { park: '' };
  }
  const [decisions, setDecisions] = useState<Decisions>({});
  const [edits, setEdits] = useState<Edits>({});
  const [trail, setTrail] = useState<LngLat[][] | null>(null);
  const [offered, setOffered] = useState<Offered[]>([]);
  const [pick, setPick] = useState<number | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [km, setKm] = useState<string>('');
  const [note, setNote] = useState('');
  const [committing, setCommitting] = useState<string | null>(null);
  // A trace's start and end stay where they're put: routes' expect.py checks both.
  const draw = useWaypoints(map, tilesUrl(routesBuild), { id: 'rg-draw', color: C.draw, active: drawing, exactEnds: true });
  const archive = useRef<InstanceType<typeof pmtiles.PMTiles> | null>(null);

  useEffect(() => {
    setToken(stored(TOKEN_KEY, ''));
    setSettings(stored(SETTINGS_KEY, { branch: 'regressions', base: 'main' }));
    setDecisions(stored(DECISIONS_KEY, {}));
    setEdits(stored(EDITS_KEY, {}));
  }, []);
  const gh = useMemo(() => new GitHub(token || null), [token]);
  useEffect(() => { gh.user().then(setLogin).catch(() => setLogin(null)); }, [gh]);

  // Proposals and entries: from the working branch while its pull request is
  // open (so committed changes show), else from the base branch.
  const load = useCallback(async () => {
    setLoadMsg('Loading…');
    try {
      const open = await gh.openPull(settings.branch).catch(() => null);
      setPull(open);
      const branch = open ? settings.branch : settings.base;
      // The branch's latest commit, and every file read at it: a commit's
      // files never change, so GitHub's file CDN (which caches a branch's
      // files for 5 minutes) can't serve them stale, and a reload right after
      // a merge shows it. Not a branch (a commit given in Settings): read as is.
      const ref = (await gh.head(branch)) ?? branch;
      const [pNames, eNames, fixturesText] = await Promise.all([
        gh.list('fixtures/proposals', ref).catch((): string[] => []), gh.list('fixtures/expect', ref), gh.read('fixtures/parks.json', ref),
      ]);
      const fixtures = JSON.parse(fixturesText ?? '[]') as { id?: string; park: string; bbox: Box }[];
      const stems = [...new Set([...pNames, ...eNames].filter((n) => n.endsWith('.jsonl')).map((n) => n.replace(/\.jsonl$/, '')))];
      const files = await Promise.all(stems.map(async (st): Promise<Park> => {
        const [ps, es] = await Promise.all([
          pNames.includes(`${st}.jsonl`) ? gh.read(`fixtures/proposals/${st}.jsonl`, ref).then((t) => parseJsonl<Proposal>(t)) : [],
          eNames.includes(`${st}.jsonl`) ? gh.read(`fixtures/expect/${st}.jsonl`, ref).then((t) => parseJsonl<Entry>(t)) : [],
        ]);
        const any = (ps[0] ?? es[0]) as { park: string; park_id: string } | undefined;
        const park = any?.park ?? st, park_id = String(any?.park_id ?? '');
        const fx = fixtures.find((f) => String(f.id ?? '') === park_id || (!f.id && f.park === park));
        return { stem: st, park, park_id, region: ps[0]?.region ?? '', proposals: ps, entries: es, bbox: ps[0]?.park_bbox ?? fx?.bbox };
      }));
      files.sort((a, b) => a.park.localeCompare(b.park));
      setParks(files);
      setReadFrom(ref === branch ? branch : `${branch} @ ${ref.slice(0, 7)}`);
      const want = linked.current?.park;
      setStem((s) => s || (want && files.some((f) => f.stem === want) ? want : files[0]?.stem) || '');
      setLoadMsg('');
    } catch (e) {
      setLoadMsg(`Couldn’t load: ${(e as Error).message}. Without a token GitHub allows 60 reads an hour; add one in Settings.`);
    }
  }, [gh, settings.branch, settings.base]);
  useEffect(() => { load(); }, [load]);

  const park = parks.find((p) => p.stem === stem) ?? null;
  const proposals = useMemo(() => (park?.proposals ?? []).map((p, i) => ({ p, i })).filter(({ p }) => filter === 'all' || p.status === 'open'), [park, filter]);
  const prop = park && subject?.type === 'proposal' ? park.proposals[subject.i] ?? null : null;
  const entry = park && subject?.type === 'entry' ? park.entries[subject.i] ?? null : null;
  // An entry's proposal, if it came from one: for the park's words and the OSM trail's box.
  const entryProp = entry && park ? park.proposals.find((p) => p.name === entry.name) ?? null : null;
  const dec = park && prop ? decisions[park.stem]?.[key(prop)] : undefined;
  const edit = park && entry ? edits[park.stem]?.[entryKey(entry)] : undefined;

  // Pick something sensible when the park or tab changes: what the URL
  // names, the first time, else the first in the list.
  useEffect(() => {
    if (!park) return;
    const l = linked.current;
    if (l?.park === park.stem) {
      const t = l.tab === 'entries' || l.tab === 'proposals' ? l.tab : tab;
      if (t !== tab) { setTab(t); return; }  // this runs again for the tab
      linked.current = { park: '' };
      if (l.item && t === 'entries') {
        const i = park.entries.findIndex((e) => e.name === l.item);
        if (i >= 0) { setSubject({ type: 'entry', i }); return; }
      }
      if (l.item && t === 'proposals') {
        const i = park.proposals.findIndex((p) => p.name === l.item && (l.km === undefined || p.km === l.km));
        if (i >= 0) {
          if (park.proposals[i].status !== 'open') setFilter('all');
          setSubject({ type: 'proposal', i });
          return;
        }
      }
    }
    if (tab === 'proposals') setSubject(proposals.length ? { type: 'proposal', i: proposals[0].i } : null);
    else setSubject(park.entries.length ? { type: 'entry', i: 0 } : null);
  }, [park?.stem, tab]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (park && !park.proposals.length && park.entries.length) setTab('entries'); }, [park?.stem]); // eslint-disable-line react-hooks/exhaustive-deps

  // The URL follows what's open (replacing, not adding, history entries).
  // Other parameters (?build=) and the map's #position are kept.
  useEffect(() => {
    if (!park || linked.current?.park) return;  // a linked page still opening
    const q = new URLSearchParams(window.location.search);
    q.set('park', park.stem);
    q.set('tab', tab);
    const name = prop?.name ?? entry?.name;
    if (name) q.set('item', name); else q.delete('item');
    // A park can list one name twice (two options): the length tells them apart.
    if (prop && park.proposals.filter((p) => p.name === prop.name).length > 1) q.set('km', String(prop.km)); else q.delete('km');
    const url = `${window.location.pathname}?${q.toString()}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', url);
  }, [park, tab, prop, entry]);

  const setDecision = (d: Decision | null) => {
    if (!park || !prop) return;
    const next = mergeEdits(decisions, park.stem, key(prop), d);
    setDecisions(next); store(DECISIONS_KEY, next);
  };
  const setEdit = (x: EntryEdit | null) => {
    if (!park || !entry) return;
    const next = mergeEdits(edits, park.stem, entryKey(entry), x);
    setEdits(next); store(EDITS_KEY, next);
  };

  // Map layers.
  const addLayers = useCallback(() => {
    if (!map || map.getSource('rg-trail')) return;
    for (const id of ['rg-trail', 'rg-cands', 'rg-trace', 'rg-ends']) map.addSource(id, { type: 'geojson', data: EMPTY, ...(id === 'rg-cands' ? { promoteId: 'i' } : {}) });
    const round = { 'line-join': 'round', 'line-cap': 'round' } as const;
    map.addLayer({ id: 'rg-trail', type: 'line', source: 'rg-trail', layout: round, paint: { 'line-color': C.trail, 'line-width': 12, 'line-opacity': 0.45 } });
    map.addLayer({ id: 'rg-cands', type: 'line', source: 'rg-cands', layout: round, paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'sel'], false], C.sel, C.cand],
      'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 6, ['boolean', ['feature-state', 'hover'], false], 5, 3],
      'line-opacity': ['case', ['any', ['boolean', ['feature-state', 'sel'], false], ['boolean', ['feature-state', 'hover'], false]], 1, 0.6] } });
    map.addLayer({ id: 'rg-trace', type: 'line', source: 'rg-trace', layout: round, paint: { 'line-color': C.trace, 'line-width': 3, 'line-dasharray': [2, 2] } });
    // Where the trace, and the hike picked, start and end: green and red,
    // labelled, the trace's ringed in its own near-black.
    map.addLayer({ id: 'rg-ends', type: 'circle', source: 'rg-ends', paint: {
      'circle-radius': ['match', ['get', 'of'], 'trace', 9, 7], 'circle-color': ['get', 'color'],
      'circle-stroke-color': ['match', ['get', 'of'], 'trace', C.trace, '#ffffff'], 'circle-stroke-width': 3 } });
    map.addLayer({ id: 'rg-ends-labels', type: 'symbol', source: 'rg-ends', layout: {
      'text-field': ['get', 'label'], 'text-font': LABEL_FONT, 'text-size': 13, 'text-offset': [0, 1.3], 'text-anchor': 'top', 'text-allow-overlap': true },
      paint: { 'text-color': ['get', 'color'], 'text-halo-color': '#ffffff', 'text-halo-width': 2 } });
    for (const id of ['rg-draw-line-casing', 'rg-draw-line', 'rg-draw-points']) if (map.getLayer(id)) map.moveLayer(id);
  }, [map]);
  useEffect(() => { if (!map) return; if (map.isStyleLoaded()) addLayers(); else map.once('load', addLayers); }, [map, addLayers]);

  // What's selected: its OSM trail from the tiles, the hikes routes offers
  // near it (best first), and, for an entry, its trace and where it starts.
  useEffect(() => {
    if (!map || !park || !subject || !(prop || entry)) return;
    let live = true;
    setTrail(null); setOffered([]); setPick(null); setDrawing(false); draw.clear();
    const name = prop?.name ?? entry!.name;
    const trace = entry?.trace ?? null;
    if (prop) { setKm(String(dec?.km ?? prop.suggest_km ?? prop.km)); setNote(dec?.note ?? ''); }
    else { setKm(String((edit?.action === 'update' ? edit.km : undefined) ?? entry!.km ?? '')); setNote(edit?.note ?? ''); }
    if (map.getSource('rg-trace')) {
      map.getSource<GeoJSONSource>('rg-trace')!.setData(trace ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trace } } : EMPTY);
    }
    if (!archive.current) archive.current = new pmtiles.PMTiles(new CoalescingSource(new pmtiles.FetchSource(tilesUrl(routesBuild))), undefined, withZstd(new pmtiles.PMTiles('').decompress));
    (async () => {
      // The OSM trail: the proposal's, or for an entry, its proposal's, or
      // the trail of its name (`trail`, else its name) around its trace.
      const src = prop ?? entryProp;
      const osmName = src?.osm_trail ?? entry?.trail ?? name;
      const osmBox = src?.osm_bbox ?? (trace ? pad(bounds([trace]), 0.01) : undefined);
      const geom = osmBox ? await trailGeometry(archive.current!, osmName, osmBox).catch(() => null) : null;
      const lines = geom?.lines?.length ? geom.lines : null;
      if (!live) return;
      setTrail(lines);
      const view = trace?.length ? bounds(lines ? [...lines, trace] : [trace])
        : entry?.start ? bounds([[entry.start]]) : lines ? bounds(lines)
        : osmBox ? bounds([[[osmBox[0], osmBox[1]], [osmBox[2], osmBox[3]]]]) : park.bbox ? bounds([[[park.bbox[0], park.bbox[1]], [park.bbox[2], park.bbox[3]]]]) : null;
      if (view) map.fitBounds(view, { padding: 70, maxZoom: entry?.start && !trace ? 14 : 15, duration: 0 });
      const doc = await parkRoutes(routesBuild, park.park_id).catch(() => null);
      if (!live || !doc) return;
      const want = norm(osmName);
      const all: Offered[] = offeredIn(doc).map((o) => {
        const line = o.route.line as LngLat[];
        // An entry with a trace: how much of it each hike follows, as routes'
        // expect.py checks it. Otherwise how much of the OSM trail it walks.
        const check = entry && trace ? passes(entry, o.name, o.route.km, line) : undefined;
        const share = check ? check.follows : lines ? walks(lines, line) : (norm(o.label).includes(want) || o.route.via.some((v) => norm(v) === want) ? 1 : 0);
        return { label: o.label, name: o.name, km: o.route.km, line, share, check };
      });
      const near = all.filter((o) => o.share >= 0.3);
      const target = prop?.km ?? entry?.km ?? 0;
      const ranked = (near.length ? near : all).sort((a, b) => Number(!!b.check?.ok) - Number(!!a.check?.ok) || b.share - a.share || Math.abs(a.km - target) - Math.abs(b.km - target)).slice(0, 15);
      setOffered(ranked);
    })();
    return () => { live = false; };
  }, [map, park?.stem, subject, readFrom]); // eslint-disable-line react-hooks/exhaustive-deps

  // The start and end of the entry's trace (or a dest entry's trailhead),
  // and of the hike picked, labelled.
  useEffect(() => {
    if (!map || !map.getSource('rg-ends')) return;
    const trace = entry?.trace ?? null;
    const features = [
      ...(trace ? endFeatures(trace, 'Trace', { of: 'trace' })
        : entry?.start ? endFeatures([entry.start], 'Trailhead', { of: 'trace' }).map((f) => ({ ...f, properties: { ...f.properties, label: 'Trailhead' } })) : []),
      ...(pick !== null && offered[pick] ? endFeatures(offered[pick].line, 'Hike', { of: 'hike' }) : []),
    ];
    map.getSource<GeoJSONSource>('rg-ends')!.setData({ type: 'FeatureCollection', features });
  }, [map, entry, pick, offered]);

  // A line as a few points to drag: its start, its end, and the turns that
  // keep its shape within ~100 m or more, at most a dozen. Dragging re-routes
  // between them along the trails.
  const editLine = (line: LngLat[]) => {
    let pts = simplify(line, 100);
    for (let tol = 200; pts.length > 12 && tol < 5000; tol *= 2) pts = simplify(line, tol);
    setPick(null);
    setDrawing(true);
    draw.set(pts);
  };

  // Draw what's selected.
  useEffect(() => {
    if (!map || !map.getSource('rg-trail')) return;
    map.getSource<GeoJSONSource>('rg-trail')!.setData(trail ? { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: trail } } : EMPTY);
    map.getSource<GeoJSONSource>('rg-cands')!.setData({ type: 'FeatureCollection', features: offered.map((o, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'LineString', coordinates: o.line } })) });
  }, [map, trail, offered]);
  useEffect(() => {
    if (!map || !map.getSource('rg-cands')) return;
    offered.forEach((_, i) => map.setFeatureState({ source: 'rg-cands', id: i }, { sel: i === pick }));
  }, [map, offered, pick]);

  // Hover and click hikes on the map, unless drawing.
  useEffect(() => {
    if (!map || drawing) return;
    let hovered: number | null = null;
    const unhover = () => { if (hovered !== null) map.setFeatureState({ source: 'rg-cands', id: hovered }, { hover: false }); hovered = null; };
    const onMove = (e: MapLayerMouseEvent) => {
      const i = e.features?.[0]?.id as number | undefined;
      if (i === undefined || i === hovered) return;
      unhover(); hovered = i; map.setFeatureState({ source: 'rg-cands', id: i }, { hover: true }); map.getCanvas().style.cursor = 'pointer';
    };
    const onLeave = () => { unhover(); map.getCanvas().style.cursor = ''; };
    const onClick = (e: MapLayerMouseEvent) => { const i = e.features?.[0]?.id as number | undefined; if (i !== undefined) setPick((p) => (p === i ? null : i)); };
    map.on('mousemove', 'rg-cands', onMove); map.on('mouseleave', 'rg-cands', onLeave); map.on('click', 'rg-cands', onClick);
    return () => { map.off('mousemove', 'rg-cands', onMove); map.off('mouseleave', 'rg-cands', onLeave); map.off('click', 'rg-cands', onClick); unhover(); };
  }, [map, drawing]);

  const kmNum = parseFloat(km);
  // The new trace, if one is drawn or picked: [trace, how].
  const newTrace = (): [LngLat[], string] | null => {
    if (draw.coords.length > 1) return [simplify(draw.coords), `drawn, ${(draw.metres / 1000).toFixed(1)} km`];
    if (pick !== null) { const o = offered[pick]; return [simplify(o.line), `${o.label} (${o.km} km)`]; }
    return null;
  };
  const accept = () => {
    const t = newTrace();
    if (!prop || !t || !(kmNum > 0)) return;
    setDecision({ status: 'accepted', km: kmNum, trace: t[0], how: t[1], note: note.trim() || undefined });
    setDrawing(false);
  };
  const saveEntry = () => {
    if (!entry) return;
    const t = newTrace();
    const kmChanged = kmNum > 0 && kmNum !== entry.km;
    if (!t && !kmChanged && !note.trim()) return;
    setEdit({ action: 'update', ...(kmChanged ? { km: kmNum } : {}), ...(t ? { trace: t[0], how: t[1] } : {}), note: note.trim() || undefined });
    setDrawing(false);
  };

  const nChanges = Object.values(decisions).reduce((s, d) => s + Object.keys(d).length, 0) + Object.values(edits).reduce((s, d) => s + Object.keys(d).length, 0);

  // Commit every change: proposals' statuses, the entries accepted ones
  // become, edited and deleted entries, and a fixture for each park that
  // gets its first entries.
  const commit = async () => {
    if (!token) { setShowSettings(true); return; }
    setCommitting('Committing…');
    try {
      const open = await gh.openPull(settings.branch);
      // A merged or closed pull request's branch is restarted from the base.
      const base = (open && await gh.head(settings.branch)) || (await gh.head(settings.base));
      if (!base) throw new Error(`no branch ${settings.base}`);
      const files: Record<string, string> = {};
      const fixtures = JSON.parse(await gh.read('fixtures/parks.json', base) ?? '[]') as { key: string; id?: string; park: string; bbox: number[] }[];
      let addedFixtures = 0, accepted = 0, rejected = 0, updated = 0, deleted = 0;
      for (const st of new Set([...Object.keys(decisions), ...Object.keys(edits)])) {
        const pText = await gh.read(`fixtures/proposals/${st}.jsonl`, base);
        const pf = parseJsonl<Proposal>(pText);
        let entries = parseJsonl<Entry>(await gh.read(`fixtures/expect/${st}.jsonl`, base));
        const before = toJsonl(entries);
        for (let pi = 0; pi < pf.length; pi++) {
          const d = decisions[st]?.[key(pf[pi])];
          if (!d) continue;
          // A copy: a changed row is written anew (model.ts' toJsonl).
          const p = pf[pi] = withFields(pf[pi], { status: d.status, ...(d.note ? { note: d.note } : {}) });
          if (d.status === 'accepted') {
            accepted++;
            const e = entryFor(p, d) as Entry;
            const at = entries.findIndex((x) => entryKey(x) === entryKey(e));
            if (at >= 0) entries[at] = e; else entries.push(e);
          } else rejected++;
        }
        for (const [k, x] of Object.entries(edits[st] ?? {})) {
          const at = entries.findIndex((e) => entryKey(e) === k);
          if (at < 0) continue;  // gone since: nothing to change
          if (x.action === 'delete') {
            // Its proposal, if it came from one, is open again.
            pf.forEach((p, pi) => { if (p.name === entries[at].name && p.status === 'accepted') pf[pi] = withFields(p, { status: 'open' }); });
            entries = entries.filter((_, i) => i !== at);
            deleted++;
            continue;
          }
          const e = { ...entries[at] };
          if (x.km !== undefined) e.km = x.km;
          if (x.trace) e.trace = x.trace;
          if (x.note) e.trace_note = x.note;
          entries[at] = e;
          updated++;
        }
        if (pText !== null && toJsonl(pf) !== toJsonl(parseJsonl(pText))) files[`fixtures/proposals/${st}.jsonl`] = toJsonl(pf);
        if (toJsonl(entries) !== before) files[`fixtures/expect/${st}.jsonl`] = entries.length ? toJsonl(entries) : '';
        const pk = parks.find((x) => x.stem === st);
        const bbox = pf[0]?.park_bbox;
        // Older fixtures name their park without an id.
        if (pk && bbox && entries.length && !fixtures.some((f) => String(f.id ?? '') === pk.park_id || (!f.id && f.park === pk.park))) {
          const fx = fixtureFor(pk, bbox);
          if (fixtures.some((f) => f.key === fx.key)) fx.key = `${fx.key}-${pk.park_id}`;
          fixtures.push(fx); addedFixtures++;
        }
      }
      if (addedFixtures) files['fixtures/parks.json'] = JSON.stringify(fixtures, null, 2) + '\n';
      const parkNames = [...new Set([...Object.keys(decisions), ...Object.keys(edits)])].map((st) => parks.find((x) => x.stem === st)?.park ?? st);
      const what = [accepted && `${accepted} accepted`, rejected && `${rejected} rejected`, updated && `${updated} entr${updated === 1 ? 'y' : 'ies'} edited`, deleted && `${deleted} deleted`].filter(Boolean).join(', ');
      const msg = `Named regressions: ${what} (${parkNames.join(', ')})\n\nFrom the website's /dev/regressions page${login ? `, by ${login}` : ''}.` +
        (addedFixtures ? ` ${addedFixtures} park(s) added to fixtures/parks.json.` : '');
      await gh.commit(settings.branch, base, files, msg);
      const pr = open ?? await gh.createPull(settings.branch, 'Named regressions from the regressions page',
        'Proposals accepted (as trail entries with traces) or rejected, and entries edited, on the website\'s /dev/regressions page (routes#95). Each commit says what it changed.');
      setDecisions({}); store(DECISIONS_KEY, {});
      setEdits({}); store(EDITS_KEY, {});
      setCommitting(`Committed to ${settings.branch}: pull request #${pr.number}.`);
      setPull(pr);
      await load();
    } catch (e) {
      setCommitting(`Couldn’t commit: ${(e as Error).message}`);
    }
  };

  const btn = 'tap px-2.5 py-1 rounded border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-40';
  const chip = (on: boolean) => `tap px-2.5 py-0.5 rounded-full border text-xs ${on ? 'bg-emerald-800 border-emerald-800 text-white' : 'border-gray-300 bg-white text-gray-800'}`;
  const counts = (pf: Park) => {
    const open = pf.proposals.filter((p) => p.status === 'open').length;
    const changed = Object.keys(decisions[pf.stem] ?? {}).length + Object.keys(edits[pf.stem] ?? {}).length;
    return [pf.proposals.length && `${open} open`, pf.entries.length && `${pf.entries.length} entries`, changed && `${changed} changed`].filter(Boolean).join(', ');
  };
  const t = newTrace();
  const editSummary = (x: EntryEdit) => x.action === 'delete' ? 'delete' : [x.trace && `new trace (${x.how})`, x.km !== undefined && `${x.km} km`].filter(Boolean).join(', ') || 'note only';

  return <div className='flex flex-col md:flex-row h-[100dvh]'>
    <aside className={`md:w-[400px] md:h-full ${bigMap ? 'h-[30%]' : 'h-1/2'} overflow-y-auto border-r border-gray-200 bg-white text-sm flex flex-col order-2 md:order-1`}>
      <div className='p-2 md:p-3 flex flex-col gap-2 md:gap-3'>
        <div className='flex items-start justify-between gap-2'>
          <div>
            <div className='text-lg font-semibold'>Named regressions</div>
            <div className='text-gray-500 text-xs'>For <a className='underline' href={`https://github.com/${REPO}`} target='_blank' rel='noreferrer'>{REPO}</a>: turn trails parks list into regressions, and check the ones there are.</div>
          </div>
          <div className='flex gap-1.5 shrink-0'>
            <button type='button' className={`${btn} md:hidden`} onClick={() => setBigMap(!bigMap)}>{bigMap ? 'Smaller map' : 'Bigger map'}</button>
            <button type='button' className={btn} onClick={() => setShowSettings(!showSettings)}>Settings</button>
          </div>
        </div>
        {showSettings && <div className='border border-gray-200 rounded p-2 flex flex-col gap-2 text-xs'>
          <label className='flex flex-col gap-1'>GitHub token (fine-grained: {REPO} only, Contents and Pull requests read and write). Kept in this browser.
            <input type='password' className='border border-gray-300 rounded px-2 py-1' value={token} onChange={(e) => { setToken(e.target.value.trim()); store(TOKEN_KEY, e.target.value.trim()); }} placeholder='github_pat_…' />
          </label>
          <div className='text-gray-600'>{token ? (login ? `Signed in as ${login}.` : 'Checking the token…') : 'No token: you can look, but not commit.'}</div>
          <label className='flex items-center gap-2'>Working branch <input className='border border-gray-300 rounded px-2 py-0.5 flex-1' value={settings.branch} onChange={(e) => { const s = { ...settings, branch: e.target.value.trim() }; setSettings(s); store(SETTINGS_KEY, s); }} /></label>
          <label className='flex items-center gap-2'>Start from <input className='border border-gray-300 rounded px-2 py-0.5 flex-1' value={settings.base} onChange={(e) => { const s = { ...settings, base: e.target.value.trim() }; setSettings(s); store(SETTINGS_KEY, s); }} /></label>
        </div>}
        {loadMsg && <div className='text-gray-600 text-xs'>{loadMsg}</div>}
        {parks.length > 0 && <>
          <div className='text-xs text-gray-500'>Reading from <b>{readFrom}</b>{pull && <> · open: <a className='underline' href={pull.html_url} target='_blank' rel='noreferrer'>#{pull.number}</a></>}</div>
          <select className='border border-gray-300 rounded px-2 py-1' value={stem} onChange={(e) => setStem(e.target.value)}>
            {parks.map((pf) => <option key={pf.stem} value={pf.stem}>{pf.park} — {counts(pf)}</option>)}
          </select>
          <div className='flex gap-1.5 text-xs items-center'>
            <button type='button' className={chip(tab === 'proposals')} disabled={!park?.proposals.length} onClick={() => setTab('proposals')}>Proposals ({park?.proposals.length ?? 0})</button>
            <button type='button' className={chip(tab === 'entries')} disabled={!park?.entries.length} onClick={() => setTab('entries')}>Entries ({park?.entries.length ?? 0})</button>
            {tab === 'proposals' && <span className='ml-auto flex gap-1'>
              {(['open', 'all'] as const).map((f) => <button key={f} type='button' onClick={() => setFilter(f)} className={`tap px-2 rounded border ${filter === f ? 'border-gray-500' : 'border-transparent text-gray-500'}`}>{f === 'open' ? 'Open' : 'All'}</button>)}
            </span>}
          </div>
          <div className='flex flex-wrap gap-1.5'>
            {tab === 'proposals' && proposals.map(({ p, i }) => { const d = park && decisions[park.stem]?.[key(p)]; return <button key={key(p)} type='button' onClick={() => setSubject({ type: 'proposal', i })} className={chip(subject?.type === 'proposal' && subject.i === i)}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${d ? (d.status === 'accepted' ? 'bg-emerald-500' : 'bg-red-500') : p.status === 'open' ? 'bg-gray-300' : p.status === 'accepted' ? 'bg-emerald-700' : 'bg-red-700'}`} />
              {p.name}</button>; })}
            {tab === 'proposals' && !proposals.length && <span className='text-xs text-gray-500'>Nothing open in this park.</span>}
            {tab === 'entries' && park?.entries.map((e, i) => { const x = edits[park.stem]?.[entryKey(e)]; return <button key={entryKey(e)} type='button' onClick={() => setSubject({ type: 'entry', i })} className={chip(subject?.type === 'entry' && subject.i === i)}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${x ? (x.action === 'delete' ? 'bg-red-500' : 'bg-amber-500') : 'bg-gray-300'}`} />
              {e.name}{(e.kind ?? 'dest') === 'dest' ? ' (dest)' : ''}</button>; })}
          </div>
        </>}
        {prop && <div className='flex flex-col gap-1.5'>
          <div className='font-semibold text-base'>{prop.name} <span className='font-normal text-gray-500 text-xs'>{prop.status !== 'open' ? `(${prop.status})` : ''}</span></div>
          <div>The park says <b>{prop.km} km</b>{prop.km_basis ? ` (${prop.km_basis})` : ''}{prop.hours ? ` · ${prop.hours} h` : ''}. {prop.why}</div>
          {prop.quote && <blockquote className='border-l-2 border-gray-300 pl-2 text-xs text-gray-700 break-words'>{prop.quote}</blockquote>}
          <a className='text-emerald-800 underline text-xs break-all' href={prop.source} target='_blank' rel='noreferrer'>{prop.source.replace(/^https?:\/\/(www\.)?/, '')}</a>
          <div className='text-xs text-gray-500'>OSM trail: {prop.osm_trail ? `${prop.osm_trail}${prop.osm_km ? ` (${prop.osm_km} km)` : ''}${trail === null && prop.osm_bbox ? ' · too long to draw here' : ''}` : 'none of this name: draw it'}</div>
          {prop.suggest_why && <div className='text-xs bg-amber-50 text-amber-800 rounded px-2 py-1'>{prop.suggest_why}</div>}
        </div>}
        {entry && <div className='flex flex-col gap-1.5'>
          <div className='font-semibold text-base'>{entry.name} <span className='font-normal text-gray-500 text-xs'>{entry.kind ?? 'dest'} entry · {entry.issue}</span></div>
          {(entry.kind ?? 'dest') === 'trail'
            ? <div>Expects <b>{entry.km} km</b> (±{Math.round((entry.km_tolerance ?? 0.3) * 100)}%){entry.trace ? `, following its trace (${entry.trace.length} points, dashed, its start and end labelled; to move them, press Edit the trace and drag)` : entry.trail ? `, walking the OSM trail ${entry.trail}` : ', walking the OSM trail of its name'}. {entry.why}</div>
            : <div>Expects a route to <b>{entry.dest}</b> from within {entry.start_within_m ?? '?'} m of the dot, at most {entry.max_km} km, named {entry.name}. {entry.why}</div>}
          {entry.trace_note && <div className='text-xs text-gray-600'>Note: {entry.trace_note}</div>}
          {(entry.source || entryProp?.source) && <a className='text-emerald-800 underline text-xs break-all' href={entry.source ?? entryProp!.source} target='_blank' rel='noreferrer'>{(entry.source ?? entryProp!.source).replace(/^https?:\/\/(www\.)?/, '')}</a>}
          {entryProp?.quote && <blockquote className='border-l-2 border-gray-300 pl-2 text-xs text-gray-700 break-words'>{entryProp.quote}</blockquote>}
          {(entry.kind ?? 'dest') === 'dest' && <div className='text-xs text-gray-500'>This page edits trail entries; a dest entry can only be deleted here.</div>}
        </div>}
        {(prop || entry) && <>
          <div className='flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600'>
            <span><i className='inline-block w-4 align-middle border-t-4 mr-1' style={{ borderColor: C.trail }} />OSM trail</span>
            {entry && <span><i className='inline-block w-4 align-middle border-t-4 border-dashed mr-1' style={{ borderColor: C.trace }} />current trace</span>}
            <span><i className='inline-block w-4 align-middle border-t-4 mr-1' style={{ borderColor: C.cand }} />offered hike</span>
            <span><i className='inline-block w-4 align-middle border-t-4 mr-1' style={{ borderColor: C.sel }} />picked</span>
            <span><i className='inline-block w-4 align-middle border-t-4 mr-1' style={{ borderColor: C.draw }} />drawn</span>
          </div>
          <div>
            <div className='text-xs uppercase tracking-wide text-gray-500 mb-1'>Hikes routes offers near it</div>
            <ol className='flex flex-col gap-1'>
              {offered.map((o, i) => <li key={i}><button type='button' onClick={() => { setDrawing(false); draw.clear(); setPick(pick === i ? null : i); if (pick !== i) map?.fitBounds(bounds([o.line]), { padding: 60, maxZoom: 15 }); }}
                className={`tap w-full text-left rounded border px-2 py-1.5 ${pick === i ? 'border-red-500 bg-red-50' : 'border-gray-200 bg-gray-50 hover:border-blue-400'}`}>
                <div className='flex justify-between gap-2'><span className='font-medium break-words min-w-0'>{o.label}</span><span className='tabular-nums whitespace-nowrap'>{o.km} km</span></div>
                <div className='text-xs text-gray-500'>{o.check
                  ? <>{o.check.ok ? <b className='text-emerald-700'>passes this entry</b> : 'doesn’t pass'} · name {o.check.name ? '✓' : '✗'} · length {o.check.length ? (o.check.byTrace ? '✓ (by the trace)' : '✓') : '✗'}{o.check.start !== null && <> · start {o.check.start ? '✓' : `✗ (${Math.round(o.check.startOff ?? 0)} m off)`}</>}{o.check.end !== null && <> · end {o.check.end ? '✓' : `✗ (${Math.round(o.check.endOff ?? 0)} m off)`}</>} · follows {Math.round(o.check.follows * 100)}% of the trace</>
                  : trail ? `${Math.round(o.share * 100)}% of the OSM trail` : o.share ? 'named for it' : 'nearby'}</div>
              </button></li>)}
              {!offered.length && <li className='text-xs text-gray-500'>Routes offers nothing here yet: draw it.</li>}
            </ol>
          </div>
          {(prop || (entry?.kind ?? 'dest') === 'trail') && <div className='flex flex-col gap-1.5 border border-gray-200 rounded p-2'>
            <div className='flex items-center gap-1.5 flex-wrap'>
              <button type='button' className={drawing ? `${btn} !bg-violet-700 !border-violet-700 !text-white` : btn} onClick={() => { setDrawing(!drawing); setPick(null); }}>{drawing ? 'Drawing: click along the hike' : entry ? 'Redraw it' : 'Draw it'}</button>
              {!drawing && !draw.points.length && (pick !== null || entry?.trace) && <button type='button' className={btn}
                onClick={() => editLine(pick !== null ? offered[pick].line : entry!.trace!)}>{pick !== null ? 'Edit this hike' : 'Edit the trace'}</button>}
              <button type='button' className={btn} disabled={!draw.points.length} onClick={draw.undo}>Undo point</button>
              <button type='button' className={btn} disabled={!draw.points.length} onClick={draw.clear}>Clear</button>
            </div>
            {(drawing || draw.points.length > 0) && <div className='text-xs text-gray-600'>{draw.error ?? (draw.busy ? 'Routing…' : draw.points.length < 2 ? 'Click exactly where the hike starts (its trailhead), then along it: each click is routed along trails.' : `${(draw.metres / 1000).toFixed(1)} km through ${draw.points.length} points. Drag any point to move it; Start and End stay exactly where you drop them, the rest snap to the trails.`)}</div>}
          </div>}
        </>}
      </div>
      {(prop || entry) && <div className='mt-auto md:sticky md:bottom-0 bg-white border-t border-gray-200 p-2 md:p-3 flex flex-col gap-1.5'>
        {(prop || (entry?.kind ?? 'dest') === 'trail') && <div className='flex items-center gap-2'>
          <label className='text-xs text-gray-600 flex items-center gap-1'>Expect <input type='number' step='0.1' min='0' className='border border-gray-300 rounded px-1.5 py-0.5 w-20' value={km} onChange={(e) => setKm(e.target.value)} /> km</label>
          <input className='border border-gray-300 rounded px-2 py-0.5 text-sm flex-1 min-w-0' placeholder='Note (optional)' value={note} onChange={(e) => setNote(e.target.value)} />
        </div>}
        {prop && <>
          <div className='flex gap-1.5'>
            <button type='button' className={`${btn} flex-1 !bg-emerald-800 !border-emerald-800 !text-white`} disabled={!(kmNum > 0) || draw.busy || !t} onClick={accept}>Accept {draw.coords.length > 1 ? 'drawn hike' : pick !== null ? 'this hike' : ''}</button>
            <button type='button' className={btn} onClick={() => setDecision({ status: 'rejected', note: note.trim() || undefined })}>Reject</button>
            {dec && <button type='button' className={btn} onClick={() => setDecision(null)}>Undo</button>}
          </div>
          <div className='text-xs text-gray-600'>{dec ? <>Decided: <b>{dec.status === 'accepted' ? `accept, ${dec.km} km, ${dec.how}` : 'reject'}</b>{dec.note ? ` · ${dec.note}` : ''}</> : 'Not decided.'}</div>
        </>}
        {entry && <>
          <div className='flex gap-1.5'>
            {(entry.kind ?? 'dest') === 'trail' && <button type='button' className={`${btn} flex-1 !bg-emerald-800 !border-emerald-800 !text-white`} disabled={draw.busy || !(t || (kmNum > 0 && kmNum !== entry.km) || note.trim())} onClick={saveEntry}>
              {t ? `Use ${draw.coords.length > 1 ? 'drawn hike' : 'this hike'} as its trace` : 'Save changes'}</button>}
            <button type='button' className={btn} onClick={() => setEdit({ action: 'delete', note: note.trim() || undefined })}>Delete entry</button>
            {edit && <button type='button' className={btn} onClick={() => setEdit(null)}>Undo</button>}
          </div>
          <div className='text-xs text-gray-600'>{edit ? <>Changed: <b>{editSummary(edit)}</b>{edit.note ? ` · ${edit.note}` : ''}</> : 'Unchanged.'}</div>
        </>}
        <div className='flex items-center gap-2 border-t border-gray-100 pt-1.5'>
          <button type='button' className={btn} disabled={!nChanges || !!committing?.startsWith('Committing')} onClick={commit}>Commit {nChanges} change{nChanges === 1 ? '' : 's'}</button>
          <span className='text-xs text-gray-600'>{committing ?? (token ? `to ${settings.branch}, as a pull request` : 'needs a token (Settings)')}</span>
        </div>
      </div>}
    </aside>
    <div className='relative flex-1 order-1 md:order-2 min-h-0'>
      <Map style={styleUrl(build)} lng={-100} lat={52} zoom={4} onInitialized={setMap} />
    </div>
  </div>;
}
