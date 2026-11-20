// The named-regressions page for hikeratlas/routes (routes/dev.regressions):
// each park's proposed regressions (routes' fixtures/proposals/: trails the
// park lists on its own website) and its existing entries
// (fixtures/expect/), on the map with the OSM trail of each one's name and
// the hikes routes offers near it.
//
// A proposal: accept one of those hikes, or draw the hike meant, and it
// becomes a trail entry with a trace; or reject it. An entry: redraw or
// re-pick its trace, change the length it expects, or delete it. A hike
// routes offers (Hikes): bless it, to keep it as it is (a blessed entry,
// routes' expect.py). A trail routes doesn't offer: add it (Add a trail),
// drawn on the map, as a trail entry with that trace. Any park the site's
// search finds can be opened here, files or not.
// Changes are kept in this browser until saved, with a curator key, to the
// site's curation database (routes#252), which keeps every version; routes
// gets them by its export (fixtures/curation-export.py), as a pull request
// its CI checks.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import type { Map as MaplibreMap, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import Map from '~/components/Map';
import OsmLink from '~/components/OsmLink';
import Search, { type Item } from '~/components/Search';
import { styleUrl, tilesUrl } from '~/build';
import { regionsUrl } from '~/hikes';
import { parkRoutes } from '~/components/CuratedRoutes';
import { LABEL_FONT, endFeatures, useWaypoints } from '~/components/useWaypoints';
import { trailGeometry } from '~/routing/trail';
import { CoalescingSource, type Source } from '~/routing/source';
import { withZstd, type Decompress } from '~/zstd';
import type { LngLat } from '~/routing/graph';
import type { ParkDoc, Route } from '~/hikes';
import { Curation, CurationError, type Change, type ParkRow } from '~/curation/client';
import { changesFor, newSlot, slotsOf, type Slot } from '~/curation/rows';
import {
  blessedEntry, entryFor, entryKey, entryTraces, hikeTitle, key, norm, passes, simplify, slug, walks, withFields,
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
// routes, whose fixtures these are; they're kept in the site's curation
// database (routes#252) and exported to routes' fixtures/.
const REPO = 'hikeratlas/routes';
const KEY_KEY = 'regressions:curator-key';
const FIXTURES_URL = `https://raw.githubusercontent.com/${REPO}/main/fixtures/parks.json`;
const DECISIONS_KEY = 'regressions:decisions';
const EDITS_KEY = 'regressions:entry-edits';
const BLESS_KEY = 'regressions:blessings';
const ADD_KEY = 'regressions:added';

type Box = [number, number, number, number];
// A park: its proposals and its entries (either may be empty), by the file
// stem both directories name it by.
interface Park extends ParkFile { entries: Entry[]; bbox?: Box }
interface Offered { label: string; name: string | null; title: string; key: string | null; km: number; line: LngLat[]; share: number; check?: ReturnType<typeof passes> }
type Decisions = Record<string, Record<string, Decision>>;   // stem -> proposal key -> decision
type Edits = Record<string, Record<string, EntryEdit>>;      // stem -> entry key -> edit
type Blessings = Record<string, Record<string, Entry>>;      // stem -> route key -> blessed entry
type Added = Record<string, Record<string, Entry>>;          // stem -> name -> new entry
// What's selected: a proposal, an entry or an offered hike, by index in its list.
type Subject = { type: 'proposal'; i: number } | { type: 'entry'; i: number } | { type: 'hike'; i: number } | { type: 'new' };
type Tab = 'proposals' | 'entries' | 'hikes';

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

// Every hike routes offers in a park, with a label as the site shows it,
// the name it's offered under, if any (what routes' expect.py matches), its
// title (what a blessed entry is named, hikeTitle) and its route key.
function offeredIn(doc: ParkDoc): { label: string; name: string | null; dest: string | null; title: string; key: string | null; route: Route }[] {
  const n = (r: { name?: string | null }) => (r.name ? r.name : null);
  return [
    ...doc.day_hikes.map((h) => ({ label: n(h) ?? `${h.dest} from ${h.from}`, name: n(h), dest: h.dest ?? null, title: hikeTitle(n(h), h.dest, h.from), key: h.key ?? null, route: h.route })),
    ...doc.base_camps.flatMap((b) => b.hikes.map((h) => ({ label: n(h) ?? `${h.dest} from ${b.camp}`, name: n(h), dest: h.dest ?? null, title: hikeTitle(n(h), h.dest, b.camp), key: h.key ?? null, route: h.route }))),
    // Quick stops, a short walk from the car, as routes' expect.py checks them
    // (Bruce Peninsula's Halfway Log Dump).
    ...(doc.stops ?? []).map((h) => ({ label: `${n(h) ?? `${h.dest} from ${h.from}`} (stop)`, name: n(h), dest: h.dest ?? null, title: hikeTitle(n(h), h.dest, h.from), key: h.key ?? null, route: h.route })),
    // A base camp's walk in, as routes' expect.py checks it: a hike out to
    // the camp and back is the base camp's (Bruce Peninsula's High Dump).
    ...doc.base_camps.map((b) => ({ label: `${b.camp} from ${b.from} (walk in)`, name: null, dest: b.camp, title: hikeTitle(null, b.camp, b.from), key: null, route: b.approach })),
    ...doc.point_to_points.map((t) => ({ label: `${n(t) ?? `${t.from} to ${t.to}`} (multi-day)`, name: n(t), dest: t.to ?? null, title: hikeTitle(n(t), t.to, t.from), key: t.key ?? null, route: t.route })),
  ];
}
// An entry blessing route `k`, if the park has one.
const blessedBy = (entries: Entry[], k: string | null) => (k ? entries.find((e) => e.blessed?.key === k) : undefined);

const mergeEdits = <T,>(all: Record<string, Record<string, T>>, stem: string, k: string, v: T | null) => {
  const next = { ...all, [stem]: { ...(all[stem] ?? {}) } };
  if (v) next[stem][k] = v; else delete next[stem][k];
  if (!Object.keys(next[stem]).length) delete next[stem];
  return next;
};

export default function Regressions({ build }: { build: string | null }) {
  const routesBuild = build ?? 'north-america';
  const [map, setMap] = useState<MaplibreMap | null>(null);
  const [curatorKey, setCuratorKey] = useState<string>('');
  const [curator, setCurator] = useState<string | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  // Phones: the map takes 70% of the screen instead of half (to drag points).
  const [bigMap, setBigMap] = useState(false);
  useEffect(() => { map?.resize(); }, [map, bigMap]);
  const [parks, setParks] = useState<Park[]>([]);
  const [loadMsg, setLoadMsg] = useState<string>('Loading…');
  const [stem, setStem] = useState<string>('');
  const [tab, setTab] = useState<Tab>('proposals');
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
  const [blessings, setBlessings] = useState<Blessings>({});
  const [added, setAdded] = useState<Added>({});
  // Add a trail: its name and source (its length and note are km and note).
  const [newName, setNewName] = useState('');
  const [newSource, setNewSource] = useState('');
  // The name a hike is blessed under, and an entry's (to rename it).
  const [blessName, setBlessName] = useState('');
  const [entryName, setEntryName] = useState('');
  // A park picked in search, to open here.
  const [searchPark, setSearchPark] = useState<Item | null>(null);
  // The hikes routes offers in the park open (Hikes), by its stem.
  const [hikes, setHikes] = useState<{ stem: string; list: Offered[] } | null>(null);
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
    setCuratorKey(stored(KEY_KEY, ''));
    setDecisions(stored(DECISIONS_KEY, {}));
    setEdits(stored(EDITS_KEY, {}));
    setBlessings(stored(BLESS_KEY, {}));
    setAdded(stored(ADD_KEY, {}));
  }, []);
  const cur = useMemo(() => new Curation(curatorKey || null), [curatorKey]);

  // Proposals and entries: every file in the curation database, at once.
  const load = useCallback(async () => {
    setLoadMsg('Loading…');
    try {
      const snap = await cur.load();
      setCurator(snap.curator);
      // Routes' fixtures (which parks its CI runs): to offer the ones with
      // no rows yet, to bless their hikes.
      const fixtures = await fetch(FIXTURES_URL, { cache: 'no-store' }).then((r) => r.ok ? r.json() as Promise<{ id?: string; park: string; bbox: Box }[]> : []).catch(() => []);
      const rowsOf = <T,>(rows: typeof snap.listed, id: string) => slotsOf<T>(rows.filter((r) => r.park_id === id)).map((x) => x.row!);
      const files: Park[] = snap.parks.map((p) => {
        const ps = rowsOf<Proposal>(snap.listed, p.park_id), es = rowsOf<Entry>(snap.trails, p.park_id);
        const fx = fixtures.find((f) => String(f.id ?? '') === p.park_id || (!f.id && f.park === p.name));
        return { stem: p.stem, park: p.name, park_id: p.park_id, region: p.region, proposals: ps, entries: es, bbox: p.bbox ?? ps[0]?.park_bbox ?? fx?.bbox };
      });
      // Fixtures with no files yet, to bless their hikes: their region (for
      // the file's name) from routes' regions.json.
      const regions = await fetch(regionsUrl(routesBuild)).then((r) => r.json() as Promise<{ countries: { states: { name: string; areas: { id: string; ids?: string[]; name: string }[] }[] }[] }>).catch(() => null);
      const stateOf: Record<string, string> = {};
      const byName: Record<string, string[]> = {};
      for (const c of regions?.countries ?? []) for (const st of c.states) for (const a of st.areas) {
        for (const id of [a.id, ...(a.ids ?? [])]) stateOf[id] = st.name;
        (byName[a.name] ??= []).push(a.id);
      }
      for (const f of fixtures) {
        // Older fixtures name their park without an id: by name, if only one park has it.
        const id = String(f.id ?? (byName[f.park]?.length === 1 ? byName[f.park][0] : ''));
        if (!id || !stateOf[id] || files.some((x) => x.park_id === id)) continue;
        const st = `${slug(stateOf[id])}-${slug(f.park)}`;
        if (!files.some((x) => x.stem === st)) files.push({ stem: st, park: f.park, park_id: id, region: stateOf[id], proposals: [], entries: [], bbox: f.bbox });
      }
      files.sort((a, b) => a.park.localeCompare(b.park));
      setParks(files);
      const want = linked.current?.park;
      setStem((s) => s || (want && files.some((f) => f.stem === want) ? want : files[0]?.stem) || '');
      setLoadMsg('');
    } catch (e) {
      setLoadMsg(`Couldn’t load: ${(e as Error).message}.`);
    }
  }, [cur, routesBuild]);
  useEffect(() => { load(); }, [load]);

  const park = parks.find((p) => p.stem === stem) ?? null;
  const proposals = useMemo(() => (park?.proposals ?? []).map((p, i) => ({ p, i })).filter(({ p }) => filter === 'all' || p.status === 'open'), [park, filter]);
  const prop = park && subject?.type === 'proposal' ? park.proposals[subject.i] ?? null : null;
  const entry = park && subject?.type === 'entry' ? park.entries[subject.i] ?? null : null;
  // An entry's proposal, if it came from one: for the park's words and the OSM trail's box.
  const entryProp = entry && park ? park.proposals.find((p) => p.name === entry.name) ?? null : null;
  const dec = park && prop ? decisions[park.stem]?.[key(prop)] : undefined;
  const edit = park && entry ? edits[park.stem]?.[entryKey(entry)] : undefined;
  const parkHikes = park && hikes?.stem === park.stem ? hikes.list : null;
  const hike = park && subject?.type === 'hike' ? parkHikes?.[subject.i] ?? null : null;
  const blessing = park && hike?.key ? blessings[park.stem]?.[hike.key] : undefined;
  const hikeEntry = park && hike ? blessedBy(park.entries, hike.key) : undefined;

  // The park's hikes, for Hikes: every one routes offers, best known first.
  useEffect(() => {
    if (!park) return;
    let live = true;
    parkRoutes(routesBuild, park.park_id).then((doc) => {
      if (!live) return;
      const list: Offered[] = doc ? offeredIn(doc).map((o) => ({ label: o.label, name: o.name, title: o.title, key: o.key, km: o.route.km, line: o.route.line as LngLat[], share: 0 })) : [];
      setHikes({ stem: park.stem, list });
    }).catch(() => { if (live) setHikes({ stem: park.stem, list: [] }); });
    return () => { live = false; };
  }, [park?.stem, routesBuild]); // eslint-disable-line react-hooks/exhaustive-deps

  // Pick something sensible when the park or tab changes: what the URL
  // names, the first time, else the first in the list.
  useEffect(() => {
    if (!park) return;
    const l = linked.current;
    if (l?.park === park.stem) {
      const t = l.tab === 'entries' || l.tab === 'proposals' || l.tab === 'hikes' ? l.tab : tab;
      if (t !== tab) { setTab(t); return; }  // this runs again for the tab
      if (!(l.item && t === 'hikes' && !parkHikes)) linked.current = { park: '' };
      if (l.item && t === 'entries') {
        const i = park.entries.findIndex((e) => e.name === l.item);
        if (i >= 0) { setSubject({ type: 'entry', i }); return; }
      }
      if (l.item && t === 'hikes') {
        if (!parkHikes) return;  // this runs again when they've loaded
        const i = parkHikes.findIndex((h) => h.title === l.item);
        linked.current = { park: '' };
        if (i >= 0) { setSubject({ type: 'hike', i }); return; }
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
    else if (tab === 'entries') setSubject(park.entries.length ? { type: 'entry', i: 0 } : null);
    else setSubject(parkHikes?.length ? { type: 'hike', i: 0 } : null);
  // (Again when the park's hikes load, but only on Hikes: elsewhere that
  // would undo a pick.)
  }, [park?.stem, tab, tab === 'hikes' ? parkHikes : null]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (park && !park.proposals.length) setTab(park.entries.length ? 'entries' : 'hikes');
  }, [park?.stem]); // eslint-disable-line react-hooks/exhaustive-deps

  // The URL follows what's open (replacing, not adding, history entries).
  // Other parameters (?build=) and the map's #position are kept.
  useEffect(() => {
    if (!park || linked.current?.park) return;  // a linked page still opening
    const q = new URLSearchParams(window.location.search);
    q.set('park', park.stem);
    q.set('tab', tab);
    const name = prop?.name ?? entry?.name ?? hike?.title;
    if (name) q.set('item', name); else q.delete('item');
    // A park can list one name twice (two options): the length tells them apart.
    if (prop && park.proposals.filter((p) => p.name === prop.name).length > 1) q.set('km', String(prop.km)); else q.delete('km');
    const url = `${window.location.pathname}?${q.toString()}${window.location.hash}`;
    if (url !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.replaceState(window.history.state, '', url);
  }, [park, tab, prop, entry, hike]);

  const setDecision = (d: Decision | null) => {
    if (!park || !prop) return;
    const next = mergeEdits(decisions, park.stem, key(prop), d);
    setDecisions(next); store(DECISIONS_KEY, next);
  };
  const setBlessing = (e: Entry | null) => {
    if (!park || !hike?.key) return;
    const next = mergeEdits(blessings, park.stem, hike.key, e);
    setBlessings(next); store(BLESS_KEY, next);
  };
  const addEntry = (stem: string, name: string, e: Entry | null) => {
    const next = mergeEdits(added, stem, name, e);
    setAdded(next); store(ADD_KEY, next);
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
    const traces = entry ? entryTraces(entry) : [];
    const trace = traces[0] ?? null;
    if (prop) { setKm(String(dec?.km ?? prop.suggest_km ?? prop.km)); setNote(dec?.note ?? ''); }
    else { setKm(String((edit?.action === 'update' ? edit.km : undefined) ?? entry!.km ?? '')); setNote(edit?.note ?? ''); setEntryName((edit?.action === 'update' ? edit.name : undefined) ?? entry!.name); }
    if (map.getSource('rg-trace')) {
      map.getSource<GeoJSONSource>('rg-trace')!.setData(traces.length ? { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString', coordinates: traces } } : EMPTY);
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
      const view = trace?.length ? bounds(lines ? [...lines, ...traces] : traces)
        : entry?.start ? bounds([[entry.start]]) : lines ? bounds(lines)
        : osmBox ?? src?.near_bbox ? (([w, so, e, n]) => bounds([[[w, so], [e, n]]]))((osmBox ?? src!.near_bbox)!) : park.bbox ? bounds([[[park.bbox[0], park.bbox[1]], [park.bbox[2], park.bbox[3]]]]) : null;
      if (view) map.fitBounds(view, { padding: 70, maxZoom: entry?.start && !trace ? 14 : 15, duration: 0 });
      const doc = await parkRoutes(routesBuild, park.park_id).catch(() => null);
      if (!live || !doc) return;
      const want = norm(osmName);
      const all: Offered[] = offeredIn(doc).map((o) => {
        const line = o.route.line as LngLat[];
        // An entry with a trace: how much of it each hike follows, as routes'
        // expect.py checks it. Otherwise how much of the OSM trail it walks.
        const check = entry && trace ? passes(entry, entry.blessed ? o.title : o.name, o.route.km, line, o.dest) : undefined;
        const share = check ? check.follows : lines ? walks(lines, line) : (norm(o.label).includes(want) || o.route.via.some((v) => norm(v) === want) ? 1 : 0);
        return { label: o.label, name: o.name, title: o.title, key: o.key, km: o.route.km, line, share, check };
      });
      const near = all.filter((o) => o.share >= 0.3);
      const target = prop?.km ?? entry?.km ?? 0;
      const ranked = (near.length ? near : all).sort((a, b) => Number(!!b.check?.ok) - Number(!!a.check?.ok) || b.share - a.share || Math.abs(a.km - target) - Math.abs(b.km - target)).slice(0, 15);
      setOffered(ranked);
    })();
    return () => { live = false; };
  }, [map, park?.stem, subject, parks]); // eslint-disable-line react-hooks/exhaustive-deps

  // A hike to bless: it alone, picked, and the trace of its blessed entry if
  // it has one.
  useEffect(() => {
    if (!map || !hike || !map.getSource('rg-trace')) return;
    setTrail(null); setDrawing(false); draw.clear();
    setOffered([hike]); setPick(0); setBlessName(hike.title);
    const trace = hikeEntry?.trace;
    map.getSource<GeoJSONSource>('rg-trace')!.setData(trace ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: trace } } : EMPTY);
    map.fitBounds(bounds([hike.line]), { padding: 70, maxZoom: 15, duration: 0 });
  }, [map, hike]); // eslint-disable-line react-hooks/exhaustive-deps

  // Add a trail: a clean map to draw on, the park in view if nothing is.
  useEffect(() => {
    if (!map || subject?.type !== 'new' || !map.getSource('rg-trace')) return;
    setTrail(null); setOffered([]); setPick(null); draw.clear(); setDrawing(true);
    setNewName(''); setNewSource(''); setKm(''); setNote('');
    map.getSource<GeoJSONSource>('rg-trace')!.setData(EMPTY);
    if (park?.bbox && map.getZoom() < 11) map.fitBounds([[park.bbox[0], park.bbox[1]], [park.bbox[2], park.bbox[3]]], { padding: 40, duration: 0 });
  }, [map, subject]); // eslint-disable-line react-hooks/exhaustive-deps

  // The start and end of the entry's trace (or a dest entry's trailhead),
  // and of the hike picked, labelled.
  useEffect(() => {
    if (!map || !map.getSource('rg-ends')) return;
    const traces = entry ? entryTraces(entry) : hikeEntry?.trace ? [hikeEntry.trace] : [];
    const features = [
      ...(traces.length ? traces.flatMap((t, i) => endFeatures(t, traces.length > 1 ? `Trace ${i + 1}` : 'Trace', { of: 'trace' }))
        : entry?.start ? endFeatures([entry.start], 'Trailhead', { of: 'trace' }).map((f) => ({ ...f, properties: { ...f.properties, label: 'Trailhead' } })) : []),
      ...(pick !== null && offered[pick] ? endFeatures(offered[pick].line, 'Hike', { of: 'hike' }) : []),
    ];
    map.getSource<GeoJSONSource>('rg-ends')!.setData({ type: 'FeatureCollection', features });
  }, [map, entry, hikeEntry, pick, offered]);

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
  const saveEntry = (addTrace = false) => {
    if (!entry) return;
    const t = newTrace();
    if (addTrace && !t) return;
    const kmChanged = kmNum > 0 && kmNum !== entry.km;
    const name = entryName.trim();
    const renamed = !!name && name !== entry.name;
    if (!t && !kmChanged && !renamed && !note.trim()) return;
    setEdit({ action: 'update', ...(renamed ? { name } : {}), ...(kmChanged ? { km: kmNum } : {}), ...(t ? { trace: t[0], how: t[1], ...(addTrace ? { addTrace } : {}) } : {}), note: note.trim() || undefined });
    setDrawing(false);
  };

  const nChanges = [decisions, edits, blessings, added].reduce((n, all) => n + Object.values(all).reduce((s, d) => s + Object.keys(d).length, 0), 0);

  // Save every change: proposals' statuses, the entries accepted ones
  // become, edited and deleted entries, blessed and added ones. Applied to
  // the rows as they are now (read again first), and only rows that changed
  // are sent, each from the rev read: one changed by someone else in
  // between is refused, and nothing is saved. A park saved for the first
  // time is sent too (routes' export makes it a fixture).
  const commit = async () => {
    if (!curatorKey) { setShowSettings(true); return; }
    setCommitting('Saving…');
    try {
      const snap = await cur.load();
      const known = new Set(snap.parks.map((p) => p.park_id));
      const changes: Change[] = [];
      const newParks: ParkRow[] = [];
      let accepted = 0, rejected = 0, updated = 0, deleted = 0, blessed = 0, nAdded = 0;
      const stems = [...new Set([...Object.keys(decisions), ...Object.keys(edits), ...Object.keys(blessings), ...Object.keys(added)])];
      for (const st of stems) {
        const pk = parks.find((x) => x.stem === st);
        if (!pk) continue;
        const listed = slotsOf<Proposal>(snap.listed.filter((r) => r.park_id === pk.park_id));
        const pf = listed.map((x) => x.row!);
        const slots: Slot<Entry>[] = slotsOf<Entry>(snap.trails.filter((r) => r.park_id === pk.park_id));
        const live = () => slots.filter((x) => x.row);
        const find = (f: (e: Entry) => boolean) => live().find((x) => f(x.row!));
        // In place of the entry of the same name (or by `f`), else added.
        const put = (e: Entry, f: (x: Entry) => boolean = (x) => entryKey(x) === entryKey(e)) => {
          const at = find(f);
          if (at) at.row = e; else slots.push(newSlot(e));
        };
        for (let pi = 0; pi < pf.length; pi++) {
          const d = decisions[st]?.[key(pf[pi])];
          if (!d) continue;
          const p = pf[pi] = withFields(pf[pi], { status: d.status, ...(d.note ? { note: d.note } : {}) });
          if (d.status === 'accepted') { accepted++; put(entryFor(p, d) as Entry); } else rejected++;
        }
        for (const [k, x] of Object.entries(edits[st] ?? {})) {
          const at = find((e) => entryKey(e) === k);
          if (!at) continue;  // gone since: nothing to change
          if (x.action === 'delete') {
            // Its proposal, if it came from one, is open again.
            pf.forEach((p, pi) => { if (p.name === at.row!.name && p.status === 'accepted') pf[pi] = withFields(p, { status: 'open' }); });
            at.row = null;
            deleted++;
            continue;
          }
          const e = { ...at.row! };
          if (x.name) e.name = x.name;
          if (x.km !== undefined) e.km = x.km;
          if (x.trace && x.addTrace) e.traces = [...(e.traces ?? []), x.trace];
          else if (x.trace) e.trace = x.trace;
          if (x.note) e.trace_note = x.note;
          at.row = e;
          updated++;
        }
        // Blessed: in place of the entry blessing the same route, or of one
        // of the same name, else added.
        for (const e of Object.values(blessings[st] ?? {})) {
          put(e, (x) => x.blessed?.key === e.blessed!.key || entryKey(x) === entryKey(e));
          blessed++;
        }
        for (const e of Object.values(added[st] ?? {})) { put(e); nAdded++; }
        pf.forEach((p, i) => { listed[i].row = p; });
        const mine = [...changesFor('listed', pk.park_id, listed), ...changesFor('trail', pk.park_id, slots)];
        if (mine.length && !known.has(pk.park_id)) newParks.push({ park_id: pk.park_id, name: pk.park, region: pk.region, stem: pk.stem, bbox: pk.bbox ?? null });
        changes.push(...mine);
      }
      if (!changes.length) throw new Error('nothing changed (already saved?)');
      const parkNames = stems.map((st) => parks.find((x) => x.stem === st)?.park ?? st);
      const what = [accepted && `${accepted} accepted`, rejected && `${rejected} rejected`, updated && `${updated} entr${updated === 1 ? 'y' : 'ies'} edited`, deleted && `${deleted} deleted`, blessed && `${blessed} blessed`, nAdded && `${nAdded} added`].filter(Boolean).join(', ');
      await cur.save(newParks, changes, `${what} (${parkNames.join(', ')})`);
      setDecisions({}); store(DECISIONS_KEY, {});
      setBlessings({}); store(BLESS_KEY, {});
      setAdded({}); store(ADD_KEY, {});
      setEdits({}); store(EDITS_KEY, {});
      setCommitting(`Saved ${changes.length} row${changes.length === 1 ? '' : 's'}. Routes gets them with the next export.`);
      await load();
    } catch (e) {
      const stale = e instanceof CurationError && e.status === 409;
      setCommitting(stale ? 'Not saved: someone changed this park since. Reload, check, and save again.' : `Couldn’t save: ${(e as Error).message}`);
    }
  };

  const btn = 'tap px-2.5 py-1 rounded border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-40';
  const chip = (on: boolean) => `tap px-2.5 py-0.5 rounded-full border text-xs ${on ? 'bg-emerald-800 border-emerald-800 text-white' : 'border-gray-300 bg-white text-gray-800'}`;
  const counts = (pf: Park) => {
    const open = pf.proposals.filter((p) => p.status === 'open').length;
    const changed = Object.keys(decisions[pf.stem] ?? {}).length + Object.keys(edits[pf.stem] ?? {}).length + Object.keys(blessings[pf.stem] ?? {}).length + Object.keys(added[pf.stem] ?? {}).length;
    return [pf.proposals.length && `${open} open`, pf.entries.length && `${pf.entries.length} entries`, changed && `${changed} changed`].filter(Boolean).join(', ') || 'no entries yet';
  };
  const t = newTrace();
  const editSummary = (x: EntryEdit) => x.action === 'delete' ? 'delete' : [x.name && `renamed ${x.name}`, x.trace && `${x.addTrace ? 'another' : 'new'} trace (${x.how})`, x.km !== undefined && `${x.km} km`].filter(Boolean).join(', ') || 'note only';

  // Search (as on the map page): results near the map's centre, and a pick
  // framed by its box, or at zoom 13.
  const searchNear = () => {
    if (!map || map.getZoom() < 5) return null;
    const c = map.getCenter();
    return { lat: c.lat, lon: c.lng };
  };
  const goTo = (item: Item) => {
    setSearchPark(item.kind === 'park' && item.state ? item : null);
    if (!map) return;
    if (item.min_lon != null && item.min_lat != null && item.max_lon != null && item.max_lat != null) {
      map.fitBounds([[item.min_lon, item.min_lat], [item.max_lon, item.max_lat]], { padding: 70, maxZoom: 15, duration: 0 });
    } else {
      map.jumpTo({ center: [item.lon, item.lat], zoom: 13 });
    }
  };

  // Open a park search found: as it is here, else as a new one (no files
  // yet; the first commit with entries makes them, and its fixture).
  const openPark = (item: Item) => {
    const id = String(item.osm_id);
    const have = parks.find((x) => x.park_id === id);
    if (have) { setStem(have.stem); setSearchPark(null); return; }
    const box: Box | undefined = item.min_lon != null && item.min_lat != null && item.max_lon != null && item.max_lat != null
      ? [item.min_lon, item.min_lat, item.max_lon, item.max_lat] : undefined;
    const pk: Park = { stem: `${slug(item.state!)}-${slug(item.name)}`, park: item.name, park_id: id, region: item.state!, proposals: [], entries: [], bbox: box };
    setParks((ps) => [...ps.filter((x) => x.stem !== pk.stem), pk].sort((a, b) => a.park.localeCompare(b.park)));
    setStem(pk.stem);
    setSearchPark(null);
  };
  const isNew = subject?.type === 'new';
  const pendingAdds = park ? Object.values(added[park.stem] ?? {}) : [];

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
          <label className='flex flex-col gap-1'>Curator key. Kept in this browser.
            <input type='password' className='border border-gray-300 rounded px-2 py-1' value={curatorKey} onChange={(e) => { setCuratorKey(e.target.value.trim()); store(KEY_KEY, e.target.value.trim()); }} />
          </label>
          <div className='text-gray-600'>{curatorKey ? (curator ? `Saving as ${curator}.` : 'Not a curator key (or still checking).') : 'No key: you can look, but not save.'}</div>
        </div>}
        {loadMsg && <div className='text-gray-600 text-xs'>{loadMsg}</div>}
        {parks.length > 0 && <>
          <div className='text-xs text-gray-500'>From the curation database; routes gets changes with each export.</div>
          <select className='border border-gray-300 rounded px-2 py-1' value={stem} onChange={(e) => setStem(e.target.value)}>
            {parks.map((pf) => <option key={pf.stem} value={pf.stem}>{pf.park} — {counts(pf)}</option>)}
          </select>
          <div className='flex gap-1.5 text-xs items-center'>
            <button type='button' className={chip(tab === 'proposals')} disabled={!park?.proposals.length} onClick={() => setTab('proposals')}>Proposals ({park?.proposals.length ?? 0})</button>
            <button type='button' className={chip(tab === 'entries')} disabled={!park?.entries.length} onClick={() => setTab('entries')}>Entries ({park?.entries.length ?? 0})</button>
            <button type='button' className={chip(tab === 'hikes')} disabled={!parkHikes?.length} onClick={() => setTab('hikes')}>Hikes ({parkHikes?.length ?? '…'})</button>
            <button type='button' className={chip(isNew)} disabled={!park} onClick={() => setSubject({ type: 'new' })}>+ Add a trail</button>
            {tab === 'proposals' && <span className='ml-auto flex gap-1'>
              {(['open', 'all'] as const).map((f) => <button key={f} type='button' onClick={() => setFilter(f)} className={`tap px-2 rounded border ${filter === f ? 'border-gray-500' : 'border-transparent text-gray-500'}`}>{f === 'open' ? 'Open' : 'All'}</button>)}
            </span>}
          </div>
          <div className='flex flex-wrap gap-1.5'>
            {tab === 'proposals' && proposals.map(({ p, i }) => { const d = park && decisions[park.stem]?.[key(p)]; return <button key={key(p)} type='button' onClick={() => setSubject({ type: 'proposal', i })} className={chip(subject?.type === 'proposal' && subject.i === i)}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${d ? (d.status === 'accepted' ? 'bg-emerald-500' : 'bg-red-500') : p.status === 'open' ? 'bg-gray-300' : p.status === 'accepted' ? 'bg-emerald-700' : 'bg-red-700'}`} />
              {p.name}</button>; })}
            {tab === 'proposals' && !proposals.length && <span className='text-xs text-gray-500'>Nothing open in this park.</span>}
            {tab === 'entries' && park?.entries.map((e, i) => { const x = edits[park.stem]?.[entryKey(e)];
              // A featured entry checks the homepage's pick, not a hike on
              // the map: shown, not opened (routes' expect.py).
              if (e.kind === 'featured') return <span key={entryKey(e)} className='text-xs text-gray-600 px-2 py-1 rounded border border-dashed'
                title={[e.not?.length && `not ${e.not.join(', ')}`, e.one_of?.length && `one of ${e.one_of.join(', ')}`].filter(Boolean).join('; ')}>
                {e.name} (featured{e.not?.length ? `: not ${e.not.join(', ')}` : ''})</span>;
              return <button key={entryKey(e)} type='button' onClick={() => setSubject({ type: 'entry', i })} className={chip(subject?.type === 'entry' && subject.i === i)}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${x ? (x.action === 'delete' ? 'bg-red-500' : 'bg-amber-500') : 'bg-gray-300'}`} />
              {e.name}{(e.kind ?? 'dest') === 'dest' ? ' (dest)' : e.blessed ? ' (blessed)' : ''}</button>; })}
            {tab === 'hikes' && park && parkHikes?.map((h, i) => { const b = h.key && blessings[park.stem]?.[h.key]; const has = blessedBy(park.entries, h.key); return <button key={`${h.key ?? h.label}|${i}`} type='button' onClick={() => setSubject({ type: 'hike', i })} className={chip(subject?.type === 'hike' && subject.i === i)}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${b ? 'bg-emerald-500' : has ? 'bg-emerald-700' : 'bg-gray-300'}`} />
              {h.label} · {h.km} km</button>; })}
            {tab === 'hikes' && parkHikes && !parkHikes.length && <span className='text-xs text-gray-500'>Routes offers nothing in this park.</span>}
          </div>
        </>}
        {prop && <div className='flex flex-col gap-1.5'>
          <div className='font-semibold text-base'>{prop.name} <span className='font-normal text-gray-500 text-xs'>{prop.status !== 'open' ? `(${prop.status})` : ''}</span></div>
          <div>The park says <b>{prop.km} km</b>{prop.km_basis ? ` (${prop.km_basis})` : ''}{prop.shape ? `, a ${prop.shape}` : ''}{prop.hours ? ` · ${prop.hours} h` : ''}. {prop.why}</div>
          {prop.quote && <blockquote className='border-l-2 border-gray-300 pl-2 text-xs text-gray-700 break-words'>{prop.quote}</blockquote>}
          <a className='text-emerald-800 underline text-xs break-all' href={prop.source} target='_blank' rel='noreferrer'>{prop.source.replace(/^https?:\/\/(www\.)?/, '')}</a>
          <div className='text-xs text-gray-500'>OSM trail: {prop.osm_trail ? `${prop.osm_trail}${prop.osm_km ? ` (${prop.osm_km} km)` : ''}${trail === null && prop.osm_bbox ? ' · too long to draw here' : ''}` : `none of this name: draw it${prop.near_bbox ? ` (shown: around ${prop.near})` : ''}`}</div>
          {prop.suggest_why && <div className='text-xs bg-amber-50 text-amber-800 rounded px-2 py-1'>{prop.suggest_why}</div>}
        </div>}
        {entry && <div className='flex flex-col gap-1.5'>
          {(entry.kind ?? 'dest') === 'trail' && <label className='flex items-center gap-2 text-xs text-gray-600'>Name
            <input className='border border-gray-300 rounded px-2 py-0.5 text-sm text-gray-900 flex-1 min-w-0' value={entryName} onChange={(e) => setEntryName(e.target.value)} /></label>}
          <div className='font-semibold text-base'>{entry.name} <span className='font-normal text-gray-500 text-xs'>{entry.blessed ? `blessed ${entry.blessed.date ?? ''} (${entry.blessed.build ?? 'routes'})` : `${entry.kind ?? 'dest'} entry · ${entry.issue ?? ''}`}</span></div>
          {(entry.kind ?? 'dest') === 'trail'
            ? <div>Expects <b>{entry.km} km</b> (±{Math.round((entry.km_tolerance ?? (entry.blessed ? 0.15 : 0.3)) * 100)}%){entry.trace ? `, following its trace (${entry.trace.length} points, dashed, its start and end labelled; to move them, press Edit the trace and drag)` : entry.trail ? `, walking the OSM trail ${entry.trail}` : ', walking the OSM trail of its name'}. {entry.why}</div>
            : <div>Expects a route to <b>{entry.dest}</b> from within {entry.start_within_m ?? '?'} m of the dot, at most {entry.max_km} km, named {entry.name}. {entry.why}</div>}
          {entry.trace_note && <div className='text-xs text-gray-600'>Note: {entry.trace_note}</div>}
          {(entry.source || entryProp?.source) && <a className='text-emerald-800 underline text-xs break-all' href={entry.source ?? entryProp!.source} target='_blank' rel='noreferrer'>{(entry.source ?? entryProp!.source).replace(/^https?:\/\/(www\.)?/, '')}</a>}
          {entryProp?.quote && <blockquote className='border-l-2 border-gray-300 pl-2 text-xs text-gray-700 break-words'>{entryProp.quote}</blockquote>}
          {(entry.kind ?? 'dest') === 'dest' && <div className='text-xs text-gray-500'>This page edits trail entries; a dest entry can only be deleted here.</div>}
        </div>}
        {isNew && park && <div className='flex flex-col gap-1.5'>
          <div className='font-semibold text-base'>Add a trail to {park.park}</div>
          <div className='text-xs text-gray-600'>For a hike routes should offer and doesn’t: name it as it’s known, give its length, and draw it on the map from its trailhead to where it ends. It becomes a trail entry with that trace, so the checks flag it until routes offers it.</div>
          <label className='flex flex-col gap-0.5 text-xs text-gray-600'>Name
            <input className='border border-gray-300 rounded px-2 py-1 text-sm text-gray-900' value={newName} onChange={(e) => setNewName(e.target.value)} placeholder='e.g. Lion’s Head Lookout' /></label>
          <label className='flex flex-col gap-0.5 text-xs text-gray-600'>Source (optional: where it’s listed)
            <input className='border border-gray-300 rounded px-2 py-1 text-sm text-gray-900' value={newSource} onChange={(e) => setNewSource(e.target.value)} placeholder='https://…' /></label>
          <div className='flex flex-col gap-1.5 border border-gray-200 rounded p-2'>
            <div className='flex items-center gap-1.5 flex-wrap'>
              <button type='button' className={drawing ? `${btn} !bg-violet-700 !border-violet-700 !text-white` : btn} onClick={() => setDrawing(!drawing)}>{drawing ? 'Drawing: click along the hike' : 'Draw it'}</button>
              <button type='button' className={btn} disabled={!draw.points.length} onClick={draw.undo}>Undo point</button>
              <button type='button' className={btn} disabled={!draw.points.length} onClick={draw.clear}>Clear</button>
              {draw.coords.length > 1 && <button type='button' className={btn} onClick={() => setKm((draw.metres / 1000).toFixed(1))}>Use its length</button>}
            </div>
            <div className='text-xs text-gray-600'>{draw.error ?? (draw.busy ? 'Routing…' : draw.points.length < 2 ? 'Click exactly where the hike starts (its trailhead), then along it: each click is routed along trails.' : `${(draw.metres / 1000).toFixed(1)} km through ${draw.points.length} points. Drag any point to move it.`)}</div>
          </div>
          {pendingAdds.length > 0 && <div className='text-xs text-gray-600'>To add here: {pendingAdds.map((e) => <span key={e.name} className='inline-flex items-center gap-1 mr-2'><b>{e.name}</b> ({e.km} km)<button type='button' className='underline' onClick={() => addEntry(park.stem, e.name, null)}>undo</button></span>)}</div>}
        </div>}
        {hike && <div className='flex flex-col gap-1.5'>
          <div className='font-semibold text-base'>{hike.label} <span className='font-normal text-gray-500 text-xs'>{hike.km} km</span></div>
          <div>Bless it to keep it as routes offers it now: an entry named <b>{hike.title}</b>, its line the trace, expecting {hike.km} km (±15%). The checks then flag it if it’s renamed, gets longer or shorter, starts or ends elsewhere, takes another line, or goes.</div>
          {hike.key ? <div className='text-xs text-gray-500 break-all'>Route key: {hike.key}</div> : <div className='text-xs text-amber-800 bg-amber-50 rounded px-2 py-1'>This build has no route keys, so it can’t be blessed.</div>}
          <label className='flex flex-col gap-0.5 text-xs text-gray-600'>Bless it under this name (change it to the name it should have)
            <input className='border border-gray-300 rounded px-2 py-1 text-sm text-gray-900' value={blessName} onChange={(e) => setBlessName(e.target.value)} /></label>
          <div className='flex flex-col gap-1.5 border border-gray-200 rounded p-2'>
            <div className='flex items-center gap-1.5 flex-wrap'>
              {!draw.points.length && <button type='button' className={btn} onClick={() => editLine(hike.line)}>Edit this hike</button>}
              <button type='button' className={btn} disabled={!draw.points.length} onClick={draw.undo}>Undo point</button>
              <button type='button' className={btn} disabled={!draw.points.length} onClick={() => { draw.clear(); setDrawing(false); setPick(0); }}>Back to as offered</button>
            </div>
            <div className='text-xs text-gray-600'>{draw.points.length ? (draw.error ?? (draw.busy ? 'Routing…' : `Adjusted: ${(draw.metres / 1000).toFixed(1)} km. Drag any point to move it; Start and End stay where you drop them.`)) : 'To bless it along a better line, press Edit this hike and drag its points.'}</div>
          </div>
          {hikeEntry && <div className='text-xs text-gray-600'>Blessed already{hikeEntry.blessed?.date ? ` on ${hikeEntry.blessed.date}` : ''}, as {hikeEntry.name} ({hikeEntry.km} km): blessing it again replaces that.</div>}
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
                  ? <>{o.check.ok ? <b className='text-emerald-700'>passes this entry</b> : 'doesn’t pass'}{o.check.trace !== undefined ? ` (trace ${o.check.trace + 1})` : ''} · name {o.check.name ? '✓' : '✗'} · length {o.check.length ? (o.check.byTrace ? '✓ (by the trace)' : '✓') : '✗'}{o.check.start !== null && <> · start {o.check.start ? '✓' : `✗ (${Math.round(o.check.startOff ?? 0)} m off)`}</>}{o.check.end !== null && <> · end {o.check.end ? '✓' : `✗ (${Math.round(o.check.endOff ?? 0)} m off)`}</>}{o.check.stays !== null && <> · stays {o.check.stays ? '✓' : `✗ (${Math.round(o.check.offM ?? 0)} m off the trace)`}</>} · follows {Math.round(o.check.follows * 100)}% of the trace</>
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
      {(prop || entry || hike || isNew) && <div className='mt-auto md:sticky md:bottom-0 bg-white border-t border-gray-200 p-2 md:p-3 flex flex-col gap-1.5'>
        {(prop || isNew || (entry?.kind ?? 'dest') === 'trail') && <div className='flex items-center gap-2'>
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
            {(entry.kind ?? 'dest') === 'trail' && <button type='button' className={`${btn} flex-1 !bg-emerald-800 !border-emerald-800 !text-white`} disabled={draw.busy || !(t || (kmNum > 0 && kmNum !== entry.km) || (entryName.trim() && entryName.trim() !== entry.name) || note.trim())} onClick={() => saveEntry()}>
              {t ? `Use ${draw.coords.length > 1 ? 'drawn hike' : 'this hike'} as its trace` : 'Save changes'}</button>}
            {(entry.kind ?? 'dest') === 'trail' && t && entry.trace && <button type='button' className={btn} disabled={draw.busy} onClick={() => saveEntry(true)}
              title='The same hike another way, e.g. from another lot: the entry passes on any of its traces'>Add as another trace</button>}
            <button type='button' className={btn} onClick={() => setEdit({ action: 'delete', note: note.trim() || undefined })}>Delete entry</button>
            {edit && <button type='button' className={btn} onClick={() => setEdit(null)}>Undo</button>}
          </div>
          <div className='text-xs text-gray-600'>{edit ? <>Changed: <b>{editSummary(edit)}</b>{edit.note ? ` · ${edit.note}` : ''}</> : 'Unchanged.'}</div>
        </>}
        {isNew && park && <>
          <div className='flex gap-1.5'>
            <button type='button' className={`${btn} flex-1 !bg-emerald-800 !border-emerald-800 !text-white`} disabled={!newName.trim() || !(kmNum > 0) || draw.busy || draw.coords.length < 2}
              onClick={() => {
                const name = newName.trim();
                addEntry(park.stem, name, {
                  kind: 'trail', park: park.park, park_id: park.park_id, issue: 'routes#95',
                  ...(newSource.trim() ? { source: newSource.trim() } : {}), name, km: kmNum, trace: simplify(draw.coords),
                  ...(note.trim() ? { trace_note: note.trim() } : {}),
                });
                draw.clear(); setNewName(''); setNewSource(''); setKm(''); setNote('');
              }}>Add this trail</button>
          </div>
          <div className='text-xs text-gray-600'>{!newName.trim() ? 'Name it' : !(kmNum > 0) ? 'Give its length' : draw.coords.length < 2 ? 'Draw it' : 'Ready to add.'}</div>
        </>}
        {hike && park && <>
          <div className='flex gap-1.5'>
            <button type='button' className={`${btn} flex-1 !bg-emerald-800 !border-emerald-800 !text-white`}
              disabled={!hike.key || !hike.line.length || draw.busy || (draw.points.length > 0 && draw.coords.length < 2)}
              onClick={() => {
                const adjusted = draw.coords.length > 1;
                setBlessing(blessedEntry(park, { title: hike.title, key: hike.key!, km: hike.km, line: hike.line }, routesBuild,
                  { name: blessName.trim() || undefined, ...(adjusted ? { line: draw.coords, km: +(draw.metres / 1000).toFixed(1) } : {}) }));
              }}>{blessName.trim() && blessName.trim() !== hike.title ? `Bless as “${blessName.trim()}”` : hikeEntry ? 'Bless it again' : 'Bless this hike'}{draw.coords.length > 1 ? ' (adjusted)' : ''}</button>
            {blessing && <button type='button' className={btn} onClick={() => setBlessing(null)}>Undo</button>}
          </div>
          <div className='text-xs text-gray-600'>{blessing ? <>To bless: <b>{blessing.name}, {blessing.km} km</b></> : 'Not blessed.'}</div>
        </>}
        <div className='flex items-center gap-2 border-t border-gray-100 pt-1.5'>
          <button type='button' className={btn} disabled={!nChanges || !!committing?.startsWith('Saving')} onClick={commit}>Save {nChanges} change{nChanges === 1 ? '' : 's'}</button>
          <span className='text-xs text-gray-600'>{committing ?? (curator ? `as ${curator}` : 'needs a curator key (Settings)')}</span>
        </div>
      </div>}
    </aside>
    <div className='relative flex-1 order-1 md:order-2 min-h-0'>
      <Map style={styleUrl(build)} lng={-100} lat={52} zoom={4} onInitialized={setMap} />
      {/* The site's search, to go where a trail is thought to be, and this
          view on openstreetmap.org, to check what's mapped. */}
      <div className='absolute left-2 top-2 flex flex-col items-start gap-1.5 w-72 max-w-[calc(100%-4rem)]' style={{ zIndex: 2 }}>
        <div className='w-full'><Search onSelect={goTo} build={build} near={searchNear} /></div>
        {searchPark && searchPark.state && String(searchPark.osm_id) !== park?.park_id && <button type='button' className='bg-white rounded shadow px-2 py-1 text-sm text-emerald-800 underline' onClick={() => openPark(searchPark)}>Open {searchPark.name} here</button>}
        <div className='bg-white/90 rounded shadow px-2 py-0.5'><OsmLink map={map} /></div>
      </div>
    </div>
  </div>;
}
