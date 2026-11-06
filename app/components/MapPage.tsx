import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Map as MaplibreMap, JumpToOptions } from 'maplibre-gl';
import Map from '~/components/Map';
import RoutePlanner from '~/components/RoutePlanner';
import CuratedRoutes, { bundleIndex, parkRoutes, type Crumb, type FocusPark, type RegionList, type Showing } from '~/components/CuratedRoutes';
import OsmLink from '~/components/OsmLink';
import Search, { Item } from '~/components/Search';
import { styleUrl, tilesUrl } from '~/build';
import { type Bbox, findHike, hikeEntries, hikesPath, parsePath, regionList, regionsUrl, resolve, type Regions } from '~/hikes';

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

const regionsCache = new globalThis.Map<string, Promise<Regions | null>>();
function loadRegions(build: string): Promise<Regions | null> {
  if (!regionsCache.has(build)) {
    regionsCache.set(build, fetch(regionsUrl(build)).then((r) => (r.ok ? (r.json() as Promise<Regions>) : null)).catch(() => null));
  }
  return regionsCache.get(build)!;
}

export default function MapPage({ build, search, initial, summary }: Props) {
  const routesBuild = build ?? 'north-america';
  const [map, setMap] = useState<MaplibreMap | null>(null);
  // A park picked in search, to list its curated hikes.
  const [focusPark, setFocusPark] = useState<FocusPark | null>(null);
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
    map.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], { padding: 60, maxZoom: 13, duration: 0 });
  };

  const onInitialized = (m: MaplibreMap) => setMap(m);

  // The page the server resolved, once the map is up.
  useEffect(() => {
    if (!map || !initial) return;
    // The panel draws routes as layers, so wait for the style.
    const apply = () => {
      applying.current = true;
      setCrumbs(toCrumbs(initial.crumbs));
      setNote(initial.note ?? null);
      setRegion(initial.region ?? null);
      if (initial.focus) setFocusPark({ ...initial.focus, at: Date.now() });
      if (!hadHash) fit(initial.bbox);
    };
    if (map.isStyleLoaded()) apply();
    else map.once('load', apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map]);

  // Breadcrumbs for a park, or a hike in it, from the routes index's paths
  // and names.
  const parkCrumbs = (idx: any, path: string, parkName: string) => {
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
      const idx: any = await bundleIndex(routesBuild);
      const path = idx.paths?.[s.park];
      if (!path) { setCrumbs([]); return; } // a build from before hike paths
      const doc = await parkRoutes(routesBuild, s.park);
      const base = parkCrumbs(idx, path, doc.park?.name ?? '');
      if (s.type === 'park') {
        setCrumbs(toCrumbs(base));
        setUrl(hikesPath(path.split('/')), replace);
        return;
      }
      const entries = hikeEntries(doc);
      const e = entries.find((x) => x.id === s.id);
      if (!e) return;
      const parts = [...path.split('/'), ...e.slug.split('/')];
      const trail = [...base];
      if (e.slug.includes('/')) {
        const camp = entries.find((x) => x.slug === e.slug.split('/')[0]);
        if (camp) trail.push({ name: camp.title, path: hikesPath([...path.split('/'), camp.slug]) });
      }
      trail.push({ name: e.title, path: hikesPath(parts) });
      setCrumbs(toCrumbs(trail));
      setUrl(hikesPath(parts), replace);
    } catch {
      // No URL for it; the map still works.
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
      setRegion({ heading: l.heading, items: l.items });
      setCrumbs(toCrumbs([
        { name: 'Hikes', path: '/hikes' },
        ...(r.country ? [{ name: r.country.name, path: hikesPath([r.country.slug]) }] : []),
        ...(r.state && r.country ? [{ name: r.state.name, path: hikesPath([r.country.slug, r.state.slug]) }] : []),
      ]));
      fit(l.bbox);
      applying.current = false;
      return;
    }
    const idx: any = await bundleIndex(routesBuild);
    const want = parts.slice(0, 3).join('/');
    const park = Object.keys(idx.paths ?? {}).find((id) => idx.paths[id] === want);
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
    // A curated hike (#44): its osm_id is its route id, <park>/day/i etc.
    if (item.kind === 'hike') {
      const route = String(item.osm_id);
      setFocusPark({ id: route.split('/')[0], name: item.park ?? '', at: Date.now(), route });
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
          onShowing={onShowing}
          crumbs={crumbs}
          region={region}
          onNavigate={(p) => navigate(p)}
          closeAt={closeAt}
          note={note}
        />
      </div>

  </>
}
