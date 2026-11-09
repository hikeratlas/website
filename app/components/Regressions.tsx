// The named-regressions page for hikeratlas/routes (routes/dev.regressions):
// the trails parks list on their own websites (routes' fixtures/proposals/),
// shown on the map with the OSM trail of each one's name and the hikes routes
// offers near it. Accept one of those hikes, or draw the hike meant, and it
// becomes an entry in fixtures/expect/ with a trace; or reject the proposal.
// Decisions are kept in this browser until committed: one commit to a working
// branch in routes, and a pull request from it, so routes' CI checks them.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import type { Map as MaplibreMap, GeoJSONSource, MapLayerMouseEvent } from 'maplibre-gl';
import Map from '~/components/Map';
import { styleUrl, tilesUrl } from '~/build';
import { parkRoutes } from '~/components/CuratedRoutes';
import { useWaypoints } from '~/components/useWaypoints';
import { trailGeometry } from '~/routing/trail';
import { CoalescingSource, type Source } from '~/routing/source';
import { withZstd, type Decompress } from '~/zstd';
import type { LngLat } from '~/routing/graph';
import type { ParkDoc, Route } from '~/hikes';
import { GitHub, REPO } from '~/regressions/github';
import { entryFor, fixtureFor, key, lineKm, parseJsonl, simplify, toJsonl, walks, type Decision, type ParkFile, type Proposal } from '~/regressions/model';

declare const pmtiles: {
  FetchSource: new (url: string) => Source;
  PMTiles: new (source: string | Source, cache?: unknown, decompress?: Decompress) => {
    decompress: Decompress;
    getZxy(z: number, x: number, y: number): Promise<{ data: ArrayBuffer } | undefined>;
  };
};

const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const C = { trail: '#f59e0b', cand: '#2563eb', sel: '#dc2626', draw: '#7c3aed' };
const TOKEN_KEY = 'regressions:github-token';
const SETTINGS_KEY = 'regressions:settings';
const DECISIONS_KEY = 'regressions:decisions';

interface Settings { branch: string; base: string }
interface Offered { label: string; km: number; line: LngLat[]; share: number }
type Decisions = Record<string, Record<string, Decision>>; // stem -> proposal key -> decision

function stored<T>(k: string, fallback: T): T {
  try { const v = localStorage.getItem(k); return v ? JSON.parse(v) as T : fallback; } catch { return fallback; }
}
function store(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private window */ } }

function bounds(lines: LngLat[][]): [[number, number], [number, number]] {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const l of lines) for (const [x, y] of l) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  return [[w, s], [e, n]];
}

// Every hike routes offers in a park, with a label as the site shows it.
function offeredIn(doc: ParkDoc): { label: string; route: Route }[] {
  const name = (r: { name?: string | null }, otherwise: string) => (r.name ? r.name : otherwise);
  return [
    ...doc.day_hikes.map((h) => ({ label: name(h, `${h.dest} from ${h.from}`), route: h.route })),
    ...doc.base_camps.flatMap((b) => b.hikes.map((h) => ({ label: name(h, `${h.dest} from ${b.camp}`), route: h.route }))),
    ...doc.point_to_points.map((t) => ({ label: `${name(t, `${t.from} to ${t.to}`)} (multi-day)`, route: t.route })),
  ];
}

export default function Regressions({ build }: { build: string | null }) {
  const routesBuild = build ?? 'north-america';
  const [map, setMap] = useState<MaplibreMap | null>(null);
  const [token, setToken] = useState<string>('');
  const [login, setLogin] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>({ branch: 'regressions', base: 'main' });
  const [showSettings, setShowSettings] = useState(false);
  const [parks, setParks] = useState<ParkFile[]>([]);
  const [readFrom, setReadFrom] = useState<string>('');
  const [pull, setPull] = useState<{ number: number; html_url: string } | null>(null);
  const [loadMsg, setLoadMsg] = useState<string>('Loading proposals…');
  const [stem, setStem] = useState<string>('');
  const [sel, setSel] = useState<number>(0);
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const [decisions, setDecisions] = useState<Decisions>({});
  const [trail, setTrail] = useState<LngLat[][] | null>(null);
  const [offered, setOffered] = useState<Offered[]>([]);
  const [pick, setPick] = useState<number | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [km, setKm] = useState<string>('');
  const [note, setNote] = useState('');
  const [committing, setCommitting] = useState<string | null>(null);
  const draw = useWaypoints(map, tilesUrl(routesBuild), { id: 'rg-draw', color: C.draw, active: drawing });
  const archive = useRef<InstanceType<typeof pmtiles.PMTiles> | null>(null);

  useEffect(() => {
    setToken(stored(TOKEN_KEY, ''));
    setSettings(stored(SETTINGS_KEY, { branch: 'regressions', base: 'main' }));
    setDecisions(stored(DECISIONS_KEY, {}));
  }, []);
  const gh = useMemo(() => new GitHub(token || null), [token]);
  useEffect(() => { gh.user().then(setLogin).catch(() => setLogin(null)); }, [gh]);

  // Proposals: from the working branch while its pull request is open (so
  // committed decisions show), else from the base branch.
  const load = useCallback(async () => {
    setLoadMsg('Loading proposals…');
    try {
      const open = await gh.openPull(settings.branch).catch(() => null);
      setPull(open);
      const ref = open ? settings.branch : settings.base;
      const names = (await gh.list('fixtures/proposals', ref)).filter((n) => n.endsWith('.jsonl'));
      const files = await Promise.all(names.map(async (n) => {
        const ps = parseJsonl<Proposal>(await gh.read(`fixtures/proposals/${n}`, ref));
        return { stem: n.replace(/\.jsonl$/, ''), park: ps[0]?.park ?? n, park_id: String(ps[0]?.park_id ?? ''), region: ps[0]?.region ?? '', proposals: ps };
      }));
      files.sort((a, b) => a.region.localeCompare(b.region) || a.park.localeCompare(b.park));
      setParks(files);
      setReadFrom(ref);
      setStem((s) => s || files[0]?.stem || '');
      setLoadMsg('');
    } catch (e) {
      setLoadMsg(`Couldn’t load proposals: ${(e as Error).message}. Without a token GitHub allows 60 reads an hour; add one in Settings.`);
    }
  }, [gh, settings.branch, settings.base]);
  useEffect(() => { load(); }, [load]);

  const park = parks.find((p) => p.stem === stem) ?? null;
  const list = useMemo(() => (park?.proposals ?? []).map((p, i) => ({ p, i })).filter(({ p }) => filter === 'all' || p.status === 'open'), [park, filter]);
  const cur = park?.proposals[sel] ?? null;
  const dec = park && cur ? decisions[park.stem]?.[key(cur)] : undefined;

  const setDecision = (d: Decision | null) => {
    if (!park || !cur) return;
    const next = { ...decisions, [park.stem]: { ...(decisions[park.stem] ?? {}) } };
    if (d) next[park.stem][key(cur)] = d; else delete next[park.stem][key(cur)];
    if (!Object.keys(next[park.stem]).length) delete next[park.stem];
    setDecisions(next); store(DECISIONS_KEY, next);
  };

  // Map layers.
  const addLayers = useCallback(() => {
    if (!map || map.getSource('rg-trail')) return;
    for (const id of ['rg-trail', 'rg-cands']) map.addSource(id, { type: 'geojson', data: EMPTY, ...(id === 'rg-cands' ? { promoteId: 'i' } : {}) });
    const round = { 'line-join': 'round', 'line-cap': 'round' } as const;
    map.addLayer({ id: 'rg-trail', type: 'line', source: 'rg-trail', layout: round, paint: { 'line-color': C.trail, 'line-width': 12, 'line-opacity': 0.45 } });
    map.addLayer({ id: 'rg-cands', type: 'line', source: 'rg-cands', layout: round, paint: {
      'line-color': ['case', ['boolean', ['feature-state', 'sel'], false], C.sel, C.cand],
      'line-width': ['case', ['boolean', ['feature-state', 'sel'], false], 6, ['boolean', ['feature-state', 'hover'], false], 5, 3],
      'line-opacity': ['case', ['any', ['boolean', ['feature-state', 'sel'], false], ['boolean', ['feature-state', 'hover'], false]], 1, 0.6] } });
    for (const id of ['rg-draw-line-casing', 'rg-draw-line', 'rg-draw-points']) if (map.getLayer(id)) map.moveLayer(id);
  }, [map]);
  useEffect(() => { if (!map) return; if (map.isStyleLoaded()) addLayers(); else map.once('load', addLayers); }, [map, addLayers]);

  // A proposal: its OSM trail from the tiles, and the hikes routes offers
  // near it, best first.
  useEffect(() => {
    if (!map || !park || !cur) return;
    let live = true;
    setTrail(null); setOffered([]); setPick(null); setDrawing(false); draw.clear();
    setKm(String(dec?.km ?? cur.suggest_km ?? cur.km)); setNote(dec?.note ?? '');
    if (!archive.current) archive.current = new pmtiles.PMTiles(new CoalescingSource(new pmtiles.FetchSource(tilesUrl(routesBuild))), undefined, withZstd(new pmtiles.PMTiles('').decompress));
    (async () => {
      const geom = cur.osm_trail && cur.osm_bbox ? await trailGeometry(archive.current!, cur.osm_trail, cur.osm_bbox).catch(() => null) : null;
      const lines = geom?.lines ?? null;
      if (!live) return;
      setTrail(lines);
      const fit = lines?.length ? bounds(lines) : cur.osm_bbox ? [[cur.osm_bbox[0], cur.osm_bbox[1]], [cur.osm_bbox[2], cur.osm_bbox[3]]] as [[number, number], [number, number]]
        : cur.park_bbox ? [[cur.park_bbox[0], cur.park_bbox[1]], [cur.park_bbox[2], cur.park_bbox[3]]] as [[number, number], [number, number]] : null;
      if (fit) map.fitBounds(fit, { padding: 70, maxZoom: 15, duration: 0 });
      const doc = await parkRoutes(routesBuild, cur.park_id).catch(() => null);
      if (!live || !doc) return;
      const want = (cur.osm_trail ?? cur.name).toLowerCase();
      const all = offeredIn(doc).map((o) => ({
        label: o.label, km: o.route.km, line: o.route.line as LngLat[],
        share: lines ? walks(lines, o.route.line as LngLat[]) : (o.label.toLowerCase().includes(want) || o.route.via.some((v) => v.toLowerCase() === want) ? 1 : 0),
      }));
      const near = all.filter((o) => o.share >= 0.3);
      const ranked = (near.length ? near : all).sort((a, b) => b.share - a.share || Math.abs(a.km - cur.km) - Math.abs(b.km - cur.km)).slice(0, 15);
      setOffered(ranked);
    })();
    return () => { live = false; };
  }, [map, park?.stem, sel, readFrom]); // eslint-disable-line react-hooks/exhaustive-deps

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
  const accept = () => {
    if (!cur || !(kmNum > 0)) return;
    if (draw.coords.length > 1) {
      setDecision({ status: 'accepted', km: kmNum, trace: simplify(draw.coords), how: `drawn, ${(draw.metres / 1000).toFixed(1)} km`, note: note.trim() || undefined });
      setDrawing(false);
    } else if (pick !== null) {
      const o = offered[pick];
      setDecision({ status: 'accepted', km: kmNum, trace: simplify(o.line), how: `${o.label} (${o.km} km)`, note: note.trim() || undefined });
    }
  };
  const reject = () => setDecision({ status: 'rejected', note: note.trim() || undefined });

  const nDecided = Object.values(decisions).reduce((s, d) => s + Object.keys(d).length, 0);

  // Commit every decision: proposals' statuses, the entries accepted ones
  // become, and a fixture for each park that gets its first entries.
  const commit = async () => {
    if (!token) { setShowSettings(true); return; }
    setCommitting('Committing…');
    try {
      const open = await gh.openPull(settings.branch);
      // A merged or closed pull request's branch is restarted from the base.
      const base = (open && await gh.head(settings.branch)) || (await gh.head(settings.base));
      if (!base) throw new Error(`no branch ${settings.base}`);
      const files: Record<string, string> = {};
      const fixturesText = await gh.read('fixtures/parks.json', base);
      const fixtures = JSON.parse(fixturesText ?? '[]') as { key: string; id?: string; park: string; bbox: number[] }[];
      let addedFixtures = 0, accepted = 0, rejected = 0;
      for (const [st, ds] of Object.entries(decisions)) {
        const pf = parseJsonl<Proposal>(await gh.read(`fixtures/proposals/${st}.jsonl`, base));
        const entries = parseJsonl<Record<string, unknown>>(await gh.read(`fixtures/expect/${st}.jsonl`, base));
        for (const p of pf) {
          const d = ds[key(p)];
          if (!d) continue;
          p.status = d.status;
          if (d.note) p.note = d.note;
          if (d.status === 'accepted') {
            accepted++;
            const e = entryFor(p, d);
            const at = entries.findIndex((x) => (x.kind ?? 'dest') === 'trail' && x.name === p.name);
            if (at >= 0) entries[at] = e; else entries.push(e);
          } else rejected++;
        }
        files[`fixtures/proposals/${st}.jsonl`] = toJsonl(pf);
        if (entries.length) files[`fixtures/expect/${st}.jsonl`] = toJsonl(entries);
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
      const parkNames = Object.keys(decisions).map((st) => parks.find((x) => x.stem === st)?.park ?? st);
      const msg = `Named regressions: ${accepted} accepted, ${rejected} rejected (${parkNames.join(', ')})\n\nFrom the website's /dev/regressions page${login ? `, by ${login}` : ''}.` +
        (addedFixtures ? ` ${addedFixtures} park(s) added to fixtures/parks.json.` : '');
      await gh.commit(settings.branch, base, files, msg);
      const pr = open ?? await gh.createPull(settings.branch, 'Named regressions from the regressions page',
        'Proposals accepted (as trail entries with traces) and rejected on the website\'s /dev/regressions page (routes#95). Each commit says what it decided.');
      setDecisions({}); store(DECISIONS_KEY, {});
      setCommitting(`Committed to ${settings.branch}: pull request #${pr.number}.`);
      setPull(pr);
      await load();
    } catch (e) {
      setCommitting(`Couldn’t commit: ${(e as Error).message}`);
    }
  };

  const btn = 'tap px-2.5 py-1 rounded border border-gray-300 bg-white text-gray-800 hover:bg-gray-50 disabled:opacity-40';
  const counts = (pf: ParkFile) => {
    const open = pf.proposals.filter((p) => p.status === 'open').length;
    const staged = Object.keys(decisions[pf.stem] ?? {}).length;
    return `${open} open${staged ? `, ${staged} decided` : ''}`;
  };

  return <div className='flex flex-col md:flex-row h-screen'>
    <aside className='md:w-[400px] md:h-full h-1/2 overflow-y-auto border-r border-gray-200 bg-white text-sm flex flex-col order-2 md:order-1'>
      <div className='p-3 flex flex-col gap-3'>
        <div className='flex items-start justify-between gap-2'>
          <div>
            <div className='text-lg font-semibold'>Named regressions</div>
            <div className='text-gray-500 text-xs'>Trails parks list, proposed as regressions for <a className='underline' href={`https://github.com/${REPO}`} target='_blank' rel='noreferrer'>{REPO}</a>. Accept the hike meant, draw it, or reject.</div>
          </div>
          <button type='button' className={btn} onClick={() => setShowSettings(!showSettings)}>Settings</button>
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
          <select className='border border-gray-300 rounded px-2 py-1' value={stem} onChange={(e) => { setStem(e.target.value); setSel(0); }}>
            {parks.map((pf) => <option key={pf.stem} value={pf.stem}>{pf.park} ({pf.region}) — {counts(pf)}</option>)}
          </select>
          <div className='flex gap-1.5 text-xs'>
            {(['open', 'all'] as const).map((f) => <button key={f} type='button' onClick={() => setFilter(f)}
              className={`tap px-2.5 py-0.5 rounded-full border ${filter === f ? 'bg-emerald-800 border-emerald-800 text-white' : 'border-gray-300'}`}>{f === 'open' ? 'Open' : 'All'}</button>)}
          </div>
          <div className='flex flex-wrap gap-1.5'>
            {list.map(({ p, i }) => { const d = park && decisions[park.stem]?.[key(p)]; return <button key={key(p)} type='button' onClick={() => setSel(i)}
              className={`tap px-2.5 py-0.5 rounded-full border text-xs ${i === sel ? 'bg-emerald-800 border-emerald-800 text-white' : 'border-gray-300 bg-white text-gray-800'}`}>
              <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1.5 align-middle ${d ? (d.status === 'accepted' ? 'bg-emerald-500' : 'bg-red-500') : p.status === 'open' ? 'bg-gray-300' : p.status === 'accepted' ? 'bg-emerald-700' : 'bg-red-700'}`} />
              {p.name}</button>; })}
            {!list.length && <span className='text-xs text-gray-500'>Nothing open in this park.</span>}
          </div>
        </>}
        {cur && <div className='flex flex-col gap-1.5'>
          <div className='font-semibold text-base'>{cur.name} <span className='font-normal text-gray-500 text-xs'>{cur.status !== 'open' ? `(${cur.status})` : ''}</span></div>
          <div>The park says <b>{cur.km} km</b>{cur.km_basis ? ` (${cur.km_basis})` : ''}{cur.hours ? ` · ${cur.hours} h` : ''}. {cur.why}</div>
          {cur.quote && <blockquote className='border-l-2 border-gray-300 pl-2 text-xs text-gray-700 break-words'>{cur.quote}</blockquote>}
          <a className='text-emerald-800 underline text-xs break-all' href={cur.source} target='_blank' rel='noreferrer'>{cur.source.replace(/^https?:\/\/(www\.)?/, '')}</a>
          <div className='text-xs text-gray-500'>OSM trail: {cur.osm_trail ? `${cur.osm_trail}${cur.osm_km ? ` (${cur.osm_km} km)` : ''}${trail === null && cur.osm_bbox ? ' · too long to draw here' : ''}` : 'none of this name: draw it'}</div>
          {cur.suggest_why && <div className='text-xs bg-amber-50 text-amber-800 rounded px-2 py-1'>{cur.suggest_why}</div>}
        </div>}
        {cur && <>
          <div className='flex flex-wrap gap-x-3 gap-y-1 text-xs text-gray-600'>
            <span><i className='inline-block w-4 align-middle border-t-4 mr-1' style={{ borderColor: C.trail }} />OSM trail</span>
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
                <div className='text-xs text-gray-500'>{trail ? `${Math.round(o.share * 100)}% of the OSM trail` : o.share ? 'named for it' : 'nearby'}</div>
              </button></li>)}
              {!offered.length && <li className='text-xs text-gray-500'>Routes offers nothing here yet: draw it.</li>}
            </ol>
          </div>
          <div className='flex flex-col gap-1.5 border border-gray-200 rounded p-2'>
            <div className='flex items-center gap-1.5 flex-wrap'>
              <button type='button' className={drawing ? `${btn} !bg-violet-700 !border-violet-700 !text-white` : btn} onClick={() => { setDrawing(!drawing); setPick(null); }}>{drawing ? 'Drawing: click along the hike' : 'Draw it'}</button>
              <button type='button' className={btn} disabled={!draw.points.length} onClick={draw.undo}>Undo point</button>
              <button type='button' className={btn} disabled={!draw.points.length} onClick={draw.clear}>Clear</button>
            </div>
            {(drawing || draw.points.length > 0) && <div className='text-xs text-gray-600'>{draw.error ?? (draw.busy ? 'Routing…' : draw.points.length < 2 ? 'Click where the hike starts, then along it: each click is routed along trails.' : `${(draw.metres / 1000).toFixed(1)} km through ${draw.points.length} points (${lineKm(draw.coords).toFixed(1)} km of line).`)}</div>}
          </div>
        </>}
      </div>
      {cur && <div className='mt-auto sticky bottom-0 bg-white border-t border-gray-200 p-3 flex flex-col gap-1.5'>
        <div className='flex items-center gap-2'>
          <label className='text-xs text-gray-600 flex items-center gap-1'>Expect <input type='number' step='0.1' min='0' className='border border-gray-300 rounded px-1.5 py-0.5 w-20' value={km} onChange={(e) => setKm(e.target.value)} /> km</label>
          <input className='border border-gray-300 rounded px-2 py-0.5 text-sm flex-1 min-w-0' placeholder='Note (optional)' value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <div className='flex gap-1.5'>
          <button type='button' className={`${btn} flex-1 !bg-emerald-800 !border-emerald-800 !text-white`} disabled={!(kmNum > 0) || draw.busy || !(draw.coords.length > 1 || pick !== null)} onClick={accept}>Accept {draw.coords.length > 1 ? 'drawn hike' : pick !== null ? 'this hike' : ''}</button>
          <button type='button' className={btn} onClick={reject}>Reject</button>
          {dec && <button type='button' className={btn} onClick={() => setDecision(null)}>Undo</button>}
        </div>
        <div className='text-xs text-gray-600'>{dec ? <>Decided: <b>{dec.status === 'accepted' ? `accept, ${dec.km} km, ${dec.how}` : 'reject'}</b>{dec.note ? ` · ${dec.note}` : ''}</> : 'Not decided.'}</div>
        <div className='flex items-center gap-2 border-t border-gray-100 pt-1.5'>
          <button type='button' className={btn} disabled={!nDecided || !!committing?.startsWith('Committing')} onClick={commit}>Commit {nDecided} decision{nDecided === 1 ? '' : 's'}</button>
          <span className='text-xs text-gray-600'>{committing ?? (token ? `to ${settings.branch}, as a pull request` : 'needs a token (Settings)')}</span>
        </div>
      </div>}
    </aside>
    <div className='relative flex-1 order-1 md:order-2 min-h-0'>
      <Map style={styleUrl(build)} lng={-100} lat={52} zoom={4} onInitialized={setMap} />
    </div>
  </div>;
}
