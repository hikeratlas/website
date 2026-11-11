// A route's sheet (website#95's redesign): its numbers as tiles, how hard it
// is in words, its elevation, what it passes, its terrain, why it made the
// list, trip reports, and the way to the trailhead, its GPX and a link.
import { useState } from 'react';
import { slugify, type Route, type RouteReports } from '~/hikes';
import type { Profile } from '~/routing/elevation';
import { DIFF_COLORS, SAC_WORDS, TERRAIN_COLORS, difficulty, gpx, hours, timeLabel, whyWords } from '~/park';
import { ElevationChart, type Mark } from './RoutePlanner';
import RouteReportsList from './RouteReports';
import { TerrainBar } from './ParkSheet';

const m = (n: number) => `${Math.round(n).toLocaleString('en-US')} m`;

const KIND_NAMES: Record<string, string> = {
  lake: 'Lake', peak: 'Summit', waterfall: 'Waterfall', glacier: 'Glacier', pass: 'Pass', viewpoint: 'Viewpoint',
  hut: 'Hut', cave: 'Cave', arch: 'Arch', spring: 'Spring', saddle: 'Saddle', camp: 'Camp',
};

interface Props {
  title: string;
  route: Route;
  // What kind of route: loop, out and back, one way.
  shape: 'loop' | 'out-and-back' | 'one-way';
  why?: [string, number][];
  prof: Profile | null;
  reports: RouteReports | null | undefined;
  dest?: string;
  // Campsites along it, or the camp, for the elevation chart and its list.
  campLabel: string;
  onHover: (c: [number, number] | null) => void;
  // A day hike from a base camp has its camp's other hikes here.
  children?: React.ReactNode;
}

export default function HikeSheet({ title, route: r, shape, why, prof, reports, dest, campLabel, onHover, children }: Props) {
  const diff = difficulty(r);
  const h = hours(r);
  const sac = r.max_sac ?? 0;
  const words = whyWords(why, r);
  const terrain = r.landcover.filter(([, s]) => s >= 0.03);
  // What it passes: in order and numbered, from builds that say where.
  const feats = alongOf(r);
  const [shared, setShared] = useState(false);
  const start = r.line[0];
  const share = async () => {
    const url = window.location.href;
    try {
      if (navigator.share) await navigator.share({ title, url });
      else { await navigator.clipboard.writeText(url); setShared(true); setTimeout(() => setShared(false), 2000); }
    } catch { /* cancelled */ }
  };
  const download = () => {
    const blob = new Blob([gpx(title, r.line)], { type: 'application/gpx+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${slugify(title) || 'route'}.gpx`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };
  const tiles: [string, string][] = [
    [`${r.km.toFixed(1)} km`, { loop: 'loop', 'out-and-back': 'there and back', 'one-way': 'one way' }[shape]],
    [`↑ ${m(r.gain)}`, 'climbing'],
    [timeLabel(h, r).replace(/^about /, '~'), 'walking time'],
    [m(r.max_ele), 'high point'],
  ];
  return <div className='flex flex-col gap-4'>
    <div className='mt-2 grid grid-cols-4 gap-2'>
      {tiles.map(([v, l]) => <div key={l} className='rounded-xl border border-stone-200 px-2.5 py-2'>
        <div className='font-display text-lg font-bold leading-tight'>{v}</div>
        <div className='mt-0.5 text-xs text-stone-600'>{l}</div>
      </div>)}
    </div>
    <div className='-mt-1 flex items-start gap-2 text-[13px] text-stone-700'>
      <span className={`mt-px shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${DIFF_COLORS[diff]}`}>{diff}</span>
      {sac > 0 && <span>{SAC_WORDS[sac] ?? `SAC T${sac}`}</span>}
    </div>
    {sac >= 4 && <div className='rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900'>
      Includes scrambling (SAC T4, alpine hiking): expect to use your hands on rock, exposed sections, and possibly snow. Some sections may need route-finding.
    </div>}

    <section>
      <h2 className='font-display text-base font-bold'>Elevation</h2>
      {prof
        ? <ElevationChart
            points={prof.points}
            lo={Math.min(...prof.points.map(([, e]) => e))}
            hi={Math.max(...prof.points.map(([, e]) => e))}
            marks={r.stopovers.map((c): Mark => ({ at: c.km * 1000, label: c.name }))}
            pins={feats.filter((f) => f.km !== undefined).map((f) => ({ at: f.km! * 1000, n: f.n }))}
            onHover={(i) => onHover(i === null ? null : prof.coords[i])}
          />
        : <div className='flex h-[150px] items-center text-stone-400'>Measuring elevation…</div>}
    </section>

    {r.stopovers.length > 0 && <section>
      <h2 className='font-display text-base font-bold'>{campLabel}</h2>
      <ul className='mt-1'>{r.stopovers.map((c) => <li key={`${c.name}-${c.km}`} className='flex justify-between border-b border-stone-100 py-2 text-sm'>
        <span className='font-semibold'>{c.name}</span><span className='text-stone-600'>km {c.km.toFixed(1)}</span>
      </li>)}</ul>
    </section>}

    {feats.length > 0 && <section>
      <h2 className='font-display text-base font-bold'>Along the way</h2>
      <ol className='mt-1'>{feats.map((f) => <li key={`${f.kind}-${f.name}`} className='flex items-center gap-2.5 border-b border-stone-100 py-2 text-sm'
        onMouseEnter={() => f.at && onHover(f.at)} onMouseLeave={() => onHover(null)}>
        {f.km !== undefined && <span className='flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-fuchsia-700 text-xs font-bold text-white'>{f.n}</span>}
        <span className='flex-1 font-semibold'>{f.name}</span>
        <span className='text-stone-600'>{KIND_NAMES[f.kind] ?? f.kind.replace(/_/g, ' ')}{f.km !== undefined && ` · km ${f.km.toFixed(1)}`}</span>
      </li>)}</ol>
    </section>}

    {terrain.length > 0 && <section className='flex flex-col gap-2'>
      <h2 className='font-display text-base font-bold'>Terrain</h2>
      <TerrainBar landcover={r.landcover} className='h-2.5 w-full' />
      <div className='flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-stone-700'>
        {terrain.map(([k, s]) => <span key={k} className='flex items-center gap-1.5'>
          <span className='inline-block h-2.5 w-2.5 rounded-sm' style={{ background: TERRAIN_COLORS[k] ?? '#d6d3d1' }} />{k} {Math.round(s * 100)}%
        </span>)}
      </div>
    </section>}

    {(words.length > 0 || r.via.length > 0) && <section className='flex flex-col gap-2'>
      <h2 className='font-display text-base font-bold'>Why it made the list</h2>
      {words.length > 0 && <div className='flex flex-wrap gap-1.5'>
        {words.map((w) => <span key={w} className='rounded-full bg-green-50 px-3 py-1 text-[13px] text-green-900'>{w}</span>)}
      </div>}
      {r.via.length > 0 && <div className='text-[13px] text-stone-600'>Follows {list(r.via.slice(0, 6))}{r.via.length > 6 ? ' and more' : ''}.</div>}
    </section>}

    {children}

    <RouteReportsList reports={reports} dest={dest} />

    <div className='sticky bottom-0 -mx-1 flex gap-2 bg-white px-1 pt-2 pb-1'>
      {/* eslint-disable-next-line react/jsx-no-target-blank */}
      <a href={`https://www.google.com/maps/dir/?api=1&destination=${start[1].toFixed(5)},${start[0].toFixed(5)}`} target='_blank' rel='noopener'
        className='tap flex h-11 flex-1 items-center justify-center rounded-xl bg-green-900 text-sm font-semibold text-white hover:bg-green-800'>Directions to the trailhead</a>
      <button type='button' onClick={download} className='tap h-11 rounded-xl border border-stone-300 px-4 text-sm font-semibold hover:bg-stone-50'>GPX</button>
      <button type='button' onClick={share} className='tap h-11 rounded-xl border border-stone-300 px-4 text-sm font-semibold hover:bg-stone-50'>{shared ? 'Copied' : 'Share'}</button>
    </div>
  </div>;
}

export interface AlongFeature { n: number; kind: string; name: string; km?: number; at?: [number, number] }

// What a route passes: from "along" (in order, with where), else "passes"
// (builds before hikeratlas/routes#170). Unnamed ones and repeats left out;
// at most 12.
export function alongOf(r: Route): AlongFeature[] {
  const ok = (n: string) => !!n && !/^unnamed$/i.test(n);
  const seen = new Set<string>();
  const fresh = (n: string) => !seen.has(n) && !!seen.add(n);
  const out: Omit<AlongFeature, 'n'>[] = r.along
    ? r.along.filter(([, n]) => ok(n) && fresh(n)).map(([kind, name, km, at]) => ({ kind, name, km, at }))
    : r.passes.flatMap(([kind, names]) => names.filter((n) => ok(n) && fresh(n)).map((name) => ({ kind, name })));
  return out.slice(0, 12).map((f, i) => ({ ...f, n: i + 1 }));
}

function list(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`;
}
