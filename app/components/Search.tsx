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

const HIKE_LABEL: Record<string, string> = { day: 'Day hike', base: 'Base camp', multi: 'Multi-day' };

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

export default function Search(props: Props) {
  let seq = 0;
  function ComboBox() {
    const [items, setItems] = React.useState<Item[]>([])
    // Where the shown results were searched from.
    const nearRef = React.useRef<LatLon | null>(null);
    const {
      isOpen,
      getToggleButtonProps,
      getLabelProps,
      getMenuProps,
      getInputProps,
      highlightedIndex,
      getItemProps,
      selectedItem,
    } = useCombobox<Item>({
      async onInputValueChange({inputValue}) {
        seq++;
        const captured = seq;
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

        if (seq === captured)
          setItems(json)
      },
      onSelectedItemChange: (x) => {
        if (x.selectedItem) props.onSelect?.(x.selectedItem);
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
              {...getInputProps()}
            />
          </div>
        </div>
        <ul
          className={`absolute w-full bg-white mt-1 shadow-md max-h-80 p-0 overflow-scroll z-10 ${
            !(isOpen && items.length) && 'hidden'
          }`}
          {...getMenuProps()}
        >
          {isOpen &&
            items.map((item, index) => (
              <li
                className={cx(
                  highlightedIndex === index && 'bg-blue-300',
                  selectedItem === item && 'font-bold',
                  'py-2 px-3 shadow-sm flex gap-2.5 items-start',
                )}
                key={`${item.kind}/${item.osm_id}`}
                {...getItemProps({item, index})}
              >
                <span className="mt-1 shrink-0"><SearchIcon kind={item.kind} /></span>
                <span className="flex flex-col min-w-0">
                  <span>{item.name}</span>
                  <span className="text-sm text-gray-700">{[describe(item), away(item, nearRef.current)].filter(x => x).join(' · ')}</span>
                </span>
              </li>
            ))}
        </ul>
      </div>
    )
  }
  return <ComboBox />
}
