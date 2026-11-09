import React from 'react';

import { useCombobox } from 'downshift';

import SearchIcon from './SearchIcon';

function cx(...xs: unknown[]): string {
  return xs.filter(x => x).join(' ');
}

export interface Item {
  country: string | null;
  kind: string;
  lat: number;
  lon: number;
  min_lat?: number | null;
  min_lon?: number | null;
  max_lat?: number | null;
  max_lon?: number | null;
  name: string;
  osm_id: string;
  park: string | null;
  qrank: number;
  state: string | null;
  wikidata: string | null;
  // From hikeratlas/basemap's search DB when the build has them: a peak's
  // elevation (m), a trail's length (km), a lake's area (m²).
  ele?: number | null;
  km?: number | null;
  area?: number | null;
  // A curated hike's climb (m) and type (day, base or multi); a park's number
  // of curated hikes. From hikeratlas/basemap's search-add-hikes.py.
  gain?: number | null;
  hike?: string | null;
  hikes?: number | null;
}

const HIKE_LABEL: Record<string, string> = { day: 'Day hike', base: 'Base camp', multi: 'Multi-day', stop: 'Stop' };

function kmText(km: number): string {
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

const KIND_LABEL: Record<string, string> = {
  lake: 'Lake',
  waterfall: 'Waterfall',
  camp_site: 'Campsite',
  cliff: 'Cliff',
  park: 'Park',
  city: 'City',
  town: 'Town',
  village: 'Village',
};

// The second line of a result (#44): what it is or how big, then where:
// "2,830 m · Jasper NP, Alberta", "12.4 km · Jasper NP, Alberta",
// "Lake · 1.1 km² · Banff NP, Alberta", "Park · 14 hikes · Alberta",
// "Multi-day · 36 km · ↑ 1,150 m · Sleeping Giant PP, Ontario".
export function describe(item: Item): string {
  const what: string[] = [];
  if (item.kind === 'peak') {
    if (item.ele) what.push(`${item.ele.toLocaleString('en-US')} m`);
  } else if (item.kind === 'trail') {
    if (item.km) what.push(kmText(item.km));
  } else if (item.kind === 'hike') {
    what.push(HIKE_LABEL[item.hike ?? ''] ?? 'Hike');
    if (item.km) what.push(kmText(item.km));
    if (item.gain) what.push(`↑ ${item.gain.toLocaleString('en-US')} m`);
  } else if (KIND_LABEL[item.kind]) {
    what.push(KIND_LABEL[item.kind]);
    if (item.kind === 'park' && item.hikes) what.push(`${item.hikes} hike${item.hikes === 1 ? '' : 's'}`);
    if (item.kind === 'lake' && item.area && item.area >= 100_000)
      what.push(`${(item.area / 1e6).toFixed(item.area < 10e6 ? 1 : 0)} km²`);
  }
  const where = [item.park, item.state].filter(x => x).join(', ');
  return [...what, where].filter(x => x).join(' · ');
}

interface Props {
  onSelect?: (item: Item) => void;
  // A basemap build namespace (e.g. pr-46/nova-scotia) to search instead of
  // the main index.
  build?: string | null;
  // Where results should be near (the map's centre), or null for anywhere.
  near?: () => LatLon | null;
}

interface LatLon { lat: number; lon: number }

function kmBetween(a: LatLon, b: LatLon): number {
  const r = Math.PI / 180;
  const h = Math.sin(((b.lat - a.lat) * r) / 2) ** 2
    + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(((b.lon - a.lon) * r) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(Math.min(1, h)));
}

// "38 km away" for a result well away from where you're looking, so
// same-named places can be told apart; nothing for ones nearby.
export function away(item: Item, near: LatLon | null): string {
  if (!near) return '';
  const km = kmBetween(near, item);
  if (km < 25) return '';
  return `${km < 100 ? Math.round(km) : Math.round(km / 10) * 10} km away`;
}

// Lowercase, without accents, for matching typed text to names.
function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
}

// A name with the parts that match the query in bold (#44): each word's
// start that one of the query's words begins, as search matches them.
export function highlight(name: string, query: string): React.ReactNode[] {
  const tokens = fold(query).split(/[\s,]+/).filter(Boolean).sort((a, b) => b.length - a.length);
  const out: React.ReactNode[] = [];
  for (const [i, m] of [...name.matchAll(/[\p{L}\p{N}'’]+|[^\p{L}\p{N}'’]+/gu)].entries()) {
    const word = m[0];
    const t = tokens.find((t) => fold(word).startsWith(t));
    if (!t) { out.push(word); continue; }
    out.push(<strong key={i} className="font-semibold">{word.slice(0, t.length)}</strong>, word.slice(t.length));
  }
  return out;
}

// Recent picks, shown when search is focused and empty (#44). Only in this
// browser, and optional: storage can be missing or throw (private windows).
const RECENT_KEY = 'hikeratlas:recent-searches';
const RECENT_MAX = 5;

function loadRecent(): Item[] {
  try {
    const v = JSON.parse(window.localStorage.getItem(RECENT_KEY) ?? '[]');
    return Array.isArray(v) ? v.slice(0, RECENT_MAX) : [];
  } catch {
    return [];
  }
}

function saveRecent(item: Item): void {
  try {
    const key = (x: Item) => `${x.kind}/${x.osm_id}`;
    const v = [item, ...loadRecent().filter((x) => key(x) !== key(item))].slice(0, RECENT_MAX);
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(v));
  } catch {
    // Not remembered; search still works.
  }
}

function latLonText(p: LatLon): string {
  return `${Math.abs(p.lat).toFixed(1)}° ${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(1)}° ${p.lon >= 0 ? 'E' : 'W'}`;
}

// Each result's second line. Where two would read the same (two "Lake
// Agnes" lakes, both "Lake · 0.5 km² · Ontario"), add their countries if
// those differ, else roughly where they are, so they can be told apart.
function secondLines(items: Item[], near: LatLon | null): string[] {
  const lines = items.map((item) => [describe(item), away(item, near)].filter(x => x).join(' · '));
  const groups = new Map<string, number[]>();
  items.forEach((item, i) => {
    const k = `${item.name}\n${lines[i]}`;
    groups.set(k, [...(groups.get(k) ?? []), i]);
  });
  for (const idx of groups.values()) {
    if (idx.length < 2) continue;
    const countries = new Set(idx.map((i) => items[i].country));
    for (const i of idx)
      lines[i] = [lines[i], countries.size === idx.length ? items[i].country : latLonText(items[i])].filter(x => x).join(' · ');
  }
  return lines;
}

export default function Search(props: Props) {
  let seq = 0;
  function ComboBox() {
    const [items, setItems] = React.useState<Item[]>([])
    // Showing recent picks rather than results.
    const [recent, setRecent] = React.useState(false);
    // Whether the box is being focused by a click (see onFocus).
    const pointerDown = React.useRef(false);
    // Where the shown results were searched from.
    const nearRef = React.useRef<LatLon | null>(null);
    const {
      isOpen,
      getMenuProps,
      getInputProps,
      highlightedIndex,
      getItemProps,
      selectedItem,
      inputValue,
      openMenu,
    } = useCombobox<Item>({
      async onInputValueChange({inputValue}) {
        seq++;
        const captured = seq;
        if (!inputValue) {
          setRecent(true);
          setItems(loadRecent());
          return;
        }
        const params = new URLSearchParams({ q: inputValue || '' });
        if (props.build)
          params.set('build', props.build);
        const near = props.near?.() ?? null;
        nearRef.current = near;
        if (near) {
          params.set('lat', near.lat.toFixed(3));
          params.set('lon', near.lon.toFixed(3));
        }
        const response = await fetch(
          `https://lono5me4vqwi2h6dmm66oldkie0hwewm.lambda-url.us-east-1.on.aws/?${params}`
        );

        const json = await response.json() as Item[];

        if (seq === captured) {
          setRecent(false);
          setItems(json);
        }
      },
      onSelectedItemChange: (x) => {
        if (!x.selectedItem) return;
        saveRecent(x.selectedItem);
        props.onSelect?.(x.selectedItem);
      },
      items,
      itemToString(item) {
        return item ? item.name : ''
      },
    })

    return (
      <div className='autosuggest relative'>
        <div className="w-full flex flex-col gap-1">
          <div className="flex shadow-sm bg-white gap-0.5">
            <input
              placeholder="Search..."
              className="w-full p-1.5 border"
              {...getInputProps({
                // Recent picks for an empty box. A click opens the menu itself
                // (Downshift toggles it), so only keyboard focus opens it here.
                onFocus: () => {
                  if (inputValue) return;
                  const r = loadRecent();
                  if (!r.length) return;
                  setRecent(true);
                  setItems(r);
                  if (!pointerDown.current) openMenu();
                },
                onPointerDown: () => { pointerDown.current = true; },
                onBlur: () => { pointerDown.current = false; },
              })}
            />
          </div>
        </div>
        <ul
          className={`absolute w-full bg-white mt-1 shadow-md max-h-80 p-0 overflow-scroll z-10 ${
            !(isOpen && items.length) && 'hidden'
          }`}
          {...getMenuProps()}
        >
          {isOpen && recent && items.length > 0 &&
            <li className="px-3 pt-2 pb-1 text-xs uppercase tracking-wide text-gray-500">Recent</li>}
          {isOpen &&
            (() => { const lines = secondLines(items, recent ? null : nearRef.current); return items.map((item, index) => (
              <li
                className={cx(
                  highlightedIndex === index && 'bg-blue-300',
                  selectedItem === item && 'font-bold',
                  'py-2 px-3 shadow-sm flex gap-3 items-center',
                )}
                key={`${item.kind}/${item.osm_id}`}
                {...getItemProps({item, index})}
              >
                <span className="shrink-0"><SearchIcon kind={item.kind} /></span>
                <span className="flex flex-col min-w-0">
                  <span>{recent ? item.name : highlight(item.name, inputValue)}</span>
                  <span className="text-sm text-gray-700">{lines[index]}</span>
                </span>
              </li>
            )); })()}
        </ul>
      </div>
    )
  }
  return <ComboBox />
}
