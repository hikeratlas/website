import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Map as MaplibreMap, JumpToOptions } from 'maplibre-gl';
import Map from '~/components/Map';
import RoutePlanner from '~/components/RoutePlanner';
import CuratedRoutes, { bundleIndex, parkRoutes, prefetchRoute, refreshBundle, type Crumb, type FocusPark, type FocusTrail, type RegionList, type Showing } from '~/components/CuratedRoutes';
import OsmLink from '~/components/OsmLink';
import Search, { Item } from '~/components/Search';
import { styleUrl, tilesUrl } from '~/build';
import { type Bbox, type BundleIndex, findHike, hikeEntries, hikesPath, parsePath, loadRegions, regionList, resolve } from '~/hikes';

// What a /hikes URL resolved to on the server (routes/hikes.$.tsx), to show
// once the map is ready.
export interface Initial {
  focus?: FocusPark | null;
  region?: RegionList | null;
  crumbs: { name: string; path: string }[];
  bbox?: Bbox | null;
  note?: string | null;
}

interface Props {
  build: string | null;
  // The query string (?build=...), kept on every URL the page makes.
  search: string;
  initial?: Initial | null;
  // Shown until the map is ready: the server-rendered page's content.
  summary?: ReactNode;
}

// As the basemap's export/zindex.lua shortens a park's name for search.
// Padding to fit a box beside the panel (CuratedRoutes' Sheet): on the right
// on desktop, the lower half on phones.
function besideSheet(map: MaplibreMap) {
  const { clientWidth: w, clientHeight: h } = map.getContainer();
  const panel = Math.min(480, w - 24) + 32;
  return w <= 640 ? { top: 40, left: 30, right: 30, bottom: Math.round(h / 2) + 20 }
    : { top: 60, bottom: 60, left: 60, right: w - panel - 60 >= 240 ? panel + 20 : 60 };
}

function shortPark(x: string): string {
  return x.replaceAll('National Park', 'NP').replaceAll('State Park', 'SP')
    .replaceAll('Provincial Park', 'PP').replaceAll('National Forest', 'NF');
}

export default function MapPage({ build, search, initial, summary }: Props) {
  const routesBuild = build ?? 'north-america';
  const [map, setMap] = useState<MaplibreMap | null>(null);
  // A park picked in search, to list its curated hikes.
  const [focusPark, setFocusPark] = useState<FocusPark | null>(null);
  const [focusTrail, setFocusTrail] = useState<FocusTrail | null>(null);
  // The URL's state (#55, #56): breadcrumbs, an index page's list, a note.
  const [crumbs, setCrumbs] = useState<Crumb[]>([]);
  const [region, setRegion] = useState<RegionList | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [closeAt, setCloseAt] = useState(0);
  // Whether the page was opened at a position (#zoom/lat/lon): then don't
  // move the map to what the URL names. Read while rendering, before the map
  // writes its position into the hash.
  const [hadHash] = useState(() => typeof window !== 'undefined' && window.location.hash.length > 1);
  // Set while applying a URL (Back, a breadcrumb): the panel's report of what
  // it then shows replaces the URL (a renamed hike's) rather than adding one.
  const applying = useRef(false);
  // Whether the panel has shown anything: its "nothing" before it has isn't
  // a close (it reports that as it mounts, before the page's hike opens).
  const shown = useRef(false);

  const href = useCallback((path: string) => `${path}${search}`, [search]);
  const toCrumbs = useCallback((cs: { name: string; path: string }[]) => cs.map((c) => ({ ...c, href: href(c.path) })), [href]);
  const setUrl = (path: string, replace: boolean) => {
    if (window.location.pathname === path) return;
    const url = `${path}${window.location.search}${window.location.hash}`;
    if (replace) window.history.replaceState(null, '', url);
    else window.history.pushState(null, '', url);
  };
  const fit = (bbox: Bbox | null | undefined) => {
    if (!map || !bbox) return;
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: besideSheet(map), maxZoom: 13, duration: 0 });
  };

  const onInitialized = (m: MaplibreMap) => setMap(m);

  // A hike page's hike: its park's routes and elevation start loading now,
  // alongside the map, rather than after it (they don't need it).
  useEffect(() => {
    const f = initial?.focus;
    if (f?.route) prefetchRoute(routesBuild, f.id, f.route);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // The page the server resolved, once the map is up.
  useEffect(() => {
    if (!map || !initial) return;
    // The panel draws routes as layers, so wait for the style.
    const apply = () => {
      applying.current = true;
      setCrumbs(toCrumbs(initial.crumbs));
      setNote(initial.note ?? null);
      setRegion(initial.region ?? null);
      // With a #zoom/lat/lng hash, the map stays where the URL says.
      if (initial.focus) setFocusPark({ ...initial.focus, at: Date.now(), fit: !hadHash });
      if (!hadHash) fit(initial.bbox);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Breadcrumbs for a park, or a hike in it, from the routes index's paths
  // and names.
  const parkCrumbs = (idx: BundleIndex, path: string, parkName: string) => {
    const [c, s] = path.split('/');
    return [
      { name: 'Hikes', path: '/hikes' },
      { name: idx.regions?.[c] ?? c, path: hikesPath([c]) },
      { name: idx.regions?.[`${c}/${s}`] ?? s, path: hikesPath([c, s]) },
      { name: parkName, path: hikesPath(path.split('/')) },
    ];
  };

  // The panel says what it shows: put it in the URL.
  const onShowing = async (s: Showing) => {
    const replace = applying.current;
    applying.current = false;
    if (s === null) {
      if (!shown.current || region) return;
      shown.current = false;
      setCrumbs([]);
      setNote(null);
      if (window.location.pathname.startsWith('/hikes')) setUrl('/map', replace);
      return;
    }
    shown.current = true;
    if (s.type === 'other') { setCrumbs([]); return; }
    setRegion(null);
    try {
      // A tab kept open across a routes build holds the old index, while
      // search returns the new build's hikes: if the park or hike isn't
      // there, fetch the current index once and look again (basemap#185).
      let idx: Awaited<ReturnType<typeof bundleIndex>> & { paths?: Record<string, string> } = { bundle: '', parks: {} };
      let doc!: Awaited<ReturnType<typeof parkRoutes>>; // set wherever path is
      let path: string | undefined;
      let entries: ReturnType<typeof hikeEntries> = [];
      let e: ReturnType<typeof hikeEntries>[number] | undefined;
      for (const fresh of [false, true]) {
        if (fresh) refreshBundle(routesBuild);
        idx = await bundleIndex(routesBuild);
        path = idx.paths?.[s.park];
        if (!path) continue;
        doc = await parkRoutes(routesBuild, s.park);
        if (s.type === 'park') break;
        entries = hikeEntries(doc);
        e = entries.find((x) => x.id === s.id);
        if (e) break;
      }
      if (!path) { // a build from before hike paths
        console.warn(`No /hikes path for park ${s.park}; the URL stays as it is.`);
        setCrumbs([]);
        return;
      }
      const base = parkCrumbs(idx, path, doc.park?.name ?? '');
      if (s.type === 'park') {
        setCrumbs(toCrumbs(base));
        setUrl(hikesPath(path.split('/')), replace);
        return;
      }
      if (!e) {
        console.warn(`Hike ${s.id} isn't in park ${s.park}'s routes; the URL stays as it is.`);
        return;
      }
      const hit = e;
      const parts = [...path.split('/'), ...hit.slug.split('/')];
      const trail = [...base];
      if (hit.slug.includes('/')) {
        const camp = entries.find((x) => x.slug === hit.slug.split('/')[0]);
        if (camp) trail.push({ name: camp.title, path: hikesPath([...path.split('/'), camp.slug]) });
      }
      trail.push({ name: hit.title, path: hikesPath(parts) });
      setCrumbs(toCrumbs(trail));
      setUrl(hikesPath(parts), replace);
    } catch (err) {
      // No URL for it; the map still works.
      console.warn('Could not work out a URL for what the panel shows', err);
    }
  };

  // Go to a URL's page without reloading: from a breadcrumb, an index page's
  // list, or Back (push false: the URL is already there).
  const navigate = async (path: string, push = true) => {
    if (push) setUrl(path, false);
    applying.current = true;
    setNote(null);
    const parts = parsePath(path);
    if (!parts) { // /map
      applying.current = false;
      setRegion(null);
      setCrumbs([]);
      setCloseAt(Date.now());
      return;
    }
    if (parts.length <= 2) {
      const regions = await loadRegions(routesBuild);
      if (!regions) return;
      const r = resolve(regions, parts);
      const l = regionList(regions, r);
      setCloseAt(Date.now());
      setRegion({ heading: l.heading, items: l.items, cards: l.cards });
      setCrumbs(toCrumbs([
        { name: 'Hikes', path: '/hikes' },
        ...(r.country ? [{ name: r.country.name, path: hikesPath([r.country.slug]) }] : []),
        ...(r.state && r.country ? [{ name: r.state.name, path: hikesPath([r.country.slug, r.state.slug]) }] : []),
      ]));
      fit(l.bbox);
      applying.current = false;
      return;
    }
    const idx = await bundleIndex(routesBuild);
    const want = parts.slice(0, 3).join('/');
    const park = Object.keys(idx.paths ?? {}).find((id) => idx.paths![id] === want);
    if (!park) { window.location.assign(`${path}${window.location.search}`); return; } // let the server say
    setRegion(null);
    const doc = await parkRoutes(routesBuild, park);
    if (parts.length === 3) {
      setFocusPark({ id: park, name: doc.park?.name ?? '', at: Date.now() });
      return;
    }
    const found = findHike(hikeEntries(doc), parts.slice(3).join('/'));
    if (found) setFocusPark({ id: park, name: doc.park?.name ?? '', at: Date.now(), route: found.entry.id });
    else {
      setFocusPark({ id: park, name: doc.park?.name ?? '', at: Date.now() });
      setNote('That hike has changed since the link was made. Here are the hikes in the park.');
    }
  };

  // Back and Forward.
  useEffect(() => {
    const onPop = () => { navigate(window.location.pathname, false); };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  });

  // A park's name clicked on the map (#59): as if picked in search, its
  // hikes, and the map fitted to it (its box from regions.json).
  const onPark = useCallback((id: string, name: string) => {
    setRegion(null);
    setFocusPark({ id, name, at: Date.now() });
    loadRegions(routesBuild).then((regions) => {
      const area = regions?.countries.flatMap((c) => c.states.flatMap((s) => s.areas)).find((a) => a.id === id || a.ids?.includes(id));
      if (area?.bbox && map) map.fitBounds([[area.bbox[0], area.bbox[1]], [area.bbox[2], area.bbox[3]]], { padding: besideSheet(map), maxZoom: 13 });
    });
  }, [map, routesBuild]);

  // Where search should prefer results near (#44): the map's centre, unless
  // it's zoomed out past a region, where "near" means little.
  const near = () => {
    if (!map || map.getZoom() < 5) return null;
    const c = map.getCenter();
    return { lat: c.lat, lon: c.lng };
  };
  const onSelect = (item: Item) => {
    if (!map)
      return;

    let camera: JumpToOptions = { center: item, zoom: 13 };
    if (item.min_lon != null && item.min_lat != null && item.max_lon != null && item.max_lat != null) {
      camera = map.cameraForBounds(
        [
          [item.min_lon, item.min_lat],
          [item.max_lon, item.max_lat],
        ],
        {
          padding: {
            top: 100,
            bottom: 100,
            left: 100,
            right: 100
          }
        }
      ) || camera;
    }

    map.jumpTo(camera);
    setRegion(null);
    if (item.kind === 'park') setFocusPark({ id: String(item.osm_id), name: item.name, at: Date.now() });
    // An OSM trail (#242): its own panel, with the park's hikes that walk it.
    // Search's park is shortened ("Killarney PP"); regions.json has the
    // full name and the park's routes id.
    if (item.kind === 'trail') {
      const box: [number, number, number, number] | undefined = item.min_lon != null && item.min_lat != null && item.max_lon != null && item.max_lat != null
        ? [item.min_lon, item.min_lat, item.max_lon, item.max_lat] : undefined;
      const focus: FocusTrail = { name: item.name, km: item.km, park: item.park, state: item.state, box, at: Date.now() };
      setFocusTrail(focus);
      if (item.park) {
        loadRegions(routesBuild).then((regions) => {
          const state = regions?.countries.flatMap((c) => c.states).find((s) => s.name === item.state);
          const area = state?.areas.find((a) => shortPark(a.name) === item.park);
          if (area) setFocusTrail({ ...focus, parkId: area.id });
        }).catch(() => {});
      }
    }
    // A curated hike (#44): its osm_id is its route id, <park>/day/i etc.
    if (item.kind === 'hike') {
      const route = String(item.osm_id);
      // The map is already at its box.
      setFocusPark({ id: route.split('/')[0], name: item.park ?? '', at: Date.now(), route, fit: false });
    }
  }

  useEffect(() => {
    document.addEventListener('keydown', function(event) {
      const isTextInputFocused = (): boolean => {
          const activeElement = document.activeElement;

          // Check if the focused element is an input or textarea
          return activeElement?.tagName === 'INPUT' || activeElement?.tagName === 'TEXTAREA';
      };

      if (!isTextInputFocused() && event.key === '/') {
        event.preventDefault();
        const input = document.querySelector<HTMLInputElement>('.autosuggest input');
        input?.focus();
        input?.select();
      }
    });
  }, []);

  return <>
      {/* On phones the title bar goes and search floats on the map (see
          .map-header in map.css), so the map gets the whole screen. */}
      <div className='map-header relative'>
        <div className='map-header-osm absolute top-3 right-3'><OsmLink map={map}/></div>
        <div className='p-2'>
          <div className='map-header-title text-2xl'>
            <a href={`/map${search}`}>Hiker Atlas</a>
            {build && <span className='ml-2 text-sm text-gray-500'>preview: {build}</span>}
          </div>
          <div className='map-search'><Search onSelect={onSelect} build={build} near={near}/></div>
        </div>
      </div>
      <div className='map-wrap'>
        {/* Phones: the header's OSM link is hidden with the title bar, so it
            sits on the map instead (see .map-osm-mobile in map.css). */}
        <div className='map-osm-mobile'><OsmLink map={map}/></div>
        {/* A build only covers its own area, so don't constrain it to North
            America; start at its tiles' center instead. */}
        <Map
          style={styleUrl(build)}
          lng={-118.245}
          lat={51.537}
          zoom={6.5}
          maxBounds={build ? undefined : [-170, 20, -48, 75]}
          centerOnPmtiles={build ? tilesUrl(build) : undefined}
          onInitialized={onInitialized}
        />
        {!map && summary}
        <RoutePlanner map={map} tiles={tilesUrl(routesBuild)} />
        <CuratedRoutes
          map={map}
          build={routesBuild}
          focusPark={focusPark}
          focusTrail={focusTrail}
          onShowing={onShowing}
          crumbs={crumbs}
          region={region}
          onNavigate={(p) => navigate(p)}
          closeAt={closeAt}
          note={note}
          onPark={onPark}
        />
      </div>

  </>
}
