// A park's sheet (website#95's redesign): what's in the park at a glance,
// where to start, and its day hikes with filters, each with its shape,
// numbers, difficulty and terrain. A park with few hikes gets a compact
// version: a summary, every hike in full, and parks nearby with more.
// Base camps, multi-day trips and stops are a tab away.
import { useEffect, useMemo, useState } from 'react';
import type { ParkDoc, ParkReports, SeeAlso, Stop } from '~/hikes';
import {
  DIFFICULTIES, DIFF_COLORS, NO_FILTERS, TERRAIN_COLORS, isSmall, matches, parkHikes, picks, sorted, summary, thumb, timeBand, timeLabel, trailhead,
  type Difficulty, type Filters, type ParkHike, type Sort,
} from '~/park';

export interface NearbyPark { id: string; name: string; hikes: number; km: number }

type Tab = 'day' | 'camps' | 'multi' | 'stops';

interface Props {
  doc: ParkDoc;
  reports: ParkReports | null;
  nearby: NearbyPark[] | null;
  // Opens a route (its park and id, as CuratedRoutes' select takes).
  onOpen: (park: string, id: string) => void;
  // A route pointed at (its id), or null.
  onHover: (id: string | null) => void;
  // The day hikes the filters leave, by id, for the map; null when another
  // tab is open.
  onShown: (ids: string[] | null) => void;
  onPark?: (id: string, name: string) => void;
}

const km1 = (n: number) => `${n.toFixed(1)} km`;
const m = (n: number) => `${Math.round(n).toLocaleString('en-US')} m`;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function Thumb({ line, size = 56, className = '' }: { line: [number, number][]; size?: number; className?: string }) {
  const pts = useMemo(() => thumb(line, 56, 6), [line]);
  return <svg viewBox='0 0 56 56' width={size} height={size} aria-hidden='true' className={`shrink-0 rounded-lg bg-[#eef2ea] ${className}`}>
    <polyline points={pts} fill='none' stroke='#c026d3' strokeWidth={2.5} strokeLinejoin='round' strokeLinecap='round' />
  </svg>;
}

function Pill({ diff }: { diff: Difficulty }) {
  return <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${DIFF_COLORS[diff]}`}>{diff}</span>;
}

export function TerrainBar({ landcover, className = 'h-[5px] w-36' }: { landcover: [string, number][]; className?: string }) {
  const parts = landcover.filter(([, s]) => s >= 0.01);
  const sum = parts.reduce((t, [, s]) => t + s, 0) || 1;
  if (!parts.length) return null;
  return <span className={`flex overflow-hidden rounded-full bg-stone-200 ${className}`} aria-hidden='true'>
    {parts.map(([k, s]) => <span key={k} className='block h-full' style={{ width: `${(100 * s) / sum}%`, background: TERRAIN_COLORS[k] ?? '#d6d3d1' }} />)}
  </span>;
}

function stats(h: ParkHike): string {
  return `${km1(h.route.km)} · ↑ ${m(h.route.gain)} · ${timeLabel(h.hours, h.route)} · ${h.shape}`;
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return <button type='button' aria-pressed={on} onClick={onClick}
    className={`tap h-9 rounded-full border px-3.5 text-[13px] font-medium ${on ? 'border-green-900 bg-green-900 text-white' : 'border-stone-300 bg-white text-stone-900 hover:bg-stone-50'}`}>
    {children}
  </button>;
}

function HikeRow({ h, onOpen, onHover }: { h: ParkHike; onOpen: () => void; onHover: (on: boolean) => void }) {
  return <li>
    <button type='button' onClick={onOpen} onMouseEnter={() => onHover(true)} onMouseLeave={() => onHover(false)} onFocus={() => onHover(true)} onBlur={() => onHover(false)}
      className='tap-row flex w-full items-center gap-3.5 rounded-xl border-b border-stone-100 px-2 py-3 text-left hover:bg-fuchsia-50'>
      <Thumb line={h.route.line} />
      <span className='flex min-w-0 flex-1 flex-col gap-1'>
        <span className='flex items-center gap-2'>
          <span className='text-[15px] font-semibold leading-tight text-stone-900'>{h.title}</span>
          <Pill diff={h.diff} />
        </span>
        <span className='text-[13px] text-stone-700'>{stats(h)}</span>
        <TerrainBar landcover={h.route.landcover} />
        <span className='text-xs text-stone-600'>from {h.from}{h.features.length > 0 && ` · ${h.features.slice(0, 2).join(', ')}`}</span>
      </span>
      {h.reports > 0 && <span className='shrink-0 self-start rounded-full bg-lime-100 px-2 py-0.5 text-xs text-lime-800'>{plural(h.reports, 'report')}</span>}
    </button>
  </li>;
}

export default function ParkSheet({ doc, reports, nearby, onOpen, onHover, onShown, onPark }: Props) {
  const park = String(doc.park?.id ?? '');
  const hikes = useMemo(() => parkHikes(doc, reports), [doc, reports]);
  const [tab, setTab] = useState<Tab>('day');
  const [f, setF] = useState<Filters>(NO_FILTERS);
  const [sort, setSort] = useState<Sort>('best');
  const small = isSmall(doc);
  const shown = useMemo(() => sorted(hikes.filter((h) => matches(h, f)), sort), [hikes, f, sort]);
  const filtered = JSON.stringify(f) !== JSON.stringify(NO_FILTERS);
  // The map shows what the list does: all the park's day hikes, those not
  // matching in grey.
  useEffect(() => { onShown(tab === 'day' && !small ? shown.map((h) => h.id) : null); }, [shown, tab, small, onShown]);
  const hover = (id: string) => (on: boolean) => onHover(on ? id : null);

  const multi = [
    ...doc.point_to_points.map((t, i) => ({ id: `${park}/multi/${i}`, park, title: t.name || `${trailhead(t.from)} to ${trailhead(t.to)}`, km: t.route.km, gain: t.route.gain, loop: t.kind === 'loop', camps: t.route.stopovers.length, inPark: '' })),
    ...((doc.see_also ?? []) as SeeAlso[]).map((e) => ({ id: e.id, park: String(e.park), title: e.name || `${trailhead(e.from)} to ${trailhead(e.to)}`, km: e.km, gain: e.gain, loop: e.kind === 'loop', camps: 0, inPark: e.park_name })),
  ];
  const stops = (doc.stops ?? []) as Stop[];
  const tabs: { tab: Tab; n: number; label: string }[] = [
    { tab: 'day' as Tab, n: hikes.length, label: hikes.length === 1 ? 'day hike' : 'day hikes' },
    { tab: 'camps' as Tab, n: doc.base_camps.length, label: doc.base_camps.length === 1 ? 'base camp' : 'base camps' },
    { tab: 'multi' as Tab, n: multi.length, label: multi.length === 1 ? 'multi-day trip' : 'multi-day trips' },
    { tab: 'stops' as Tab, n: stops.length, label: stops.length === 1 ? 'quick stop' : 'quick stops' },
  ].filter((t) => t.n > 0);

  if (small) {
    const total = hikes.reduce((t, h) => t + h.route.km, 0);
    const climb = Math.max(0, ...hikes.map((h) => h.route.gain));
    const reps = hikes.reduce((t, h) => t + h.reports, 0);
    const walk = hikes.reduce((t, h) => t + (h.route.km / 4 + h.route.gain / 600), 0);
    return <div className='mt-2 flex flex-col gap-4'>
      {hikes.length > 0 && <div className='flex flex-col gap-3 rounded-2xl bg-[#f7f4ec] p-4'>
        <p className='m-0 text-[15px] leading-relaxed'>{summary(hikes)}</p>
        <div className='grid grid-cols-4 gap-2'>
          {[[String(hikes.length), hikes.length === 1 ? 'day hike' : 'day hikes'], [km1(total), 'of trail in all'], [`≤ ${m(climb)}`, 'of climbing'], [String(reps), reps === 1 ? 'trip report' : 'trip reports']]
            .map(([v, l]) => <div key={l} className='rounded-xl bg-white p-2.5'>
              <div className='font-display text-lg font-bold leading-tight text-green-900'>{v}</div>
              <div className='mt-1 text-xs text-stone-600'>{l}</div>
            </div>)}
        </div>
      </div>}
      <ol className='flex flex-col gap-2.5'>
        {hikes.map((h, i) => <li key={h.id} onMouseEnter={() => onHover(h.id)} onMouseLeave={() => onHover(null)}
          className='rounded-2xl border border-stone-200 px-4 py-3.5 hover:border-fuchsia-500 hover:bg-fuchsia-50'>
          <div className='flex items-center gap-3.5'>
            <span className='flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-green-900 font-display text-sm font-bold text-white'>{i + 1}</span>
            <Thumb line={h.route.line} size={48} />
            <span className='flex min-w-0 flex-1 flex-col gap-0.5'>
              <button type='button' onClick={() => onOpen(park, h.id)} className='tap text-left text-base font-semibold text-stone-900 hover:underline'>{h.title}</button>
              <span className='text-[13px] text-stone-700'>{stats(h)}</span>
              <span className='text-xs text-stone-600'>from {h.from}{h.route.min_ele ? ` · ${m(h.route.min_ele)}–${m(h.route.max_ele)}` : ''}</span>
            </span>
            <Pill diff={h.diff} />
          </div>
          {(reports?.[doc.day_hikes[i].key ?? h.id]?.reports ?? []).length > 0 && <ul className='mt-2 ml-[42px] flex flex-col gap-1'>
            {reports![doc.day_hikes[i].key ?? h.id].reports!.slice(0, 3).map((p) => <li key={p.url} className='text-[13px]'>
              {/* eslint-disable-next-line react/jsx-no-target-blank */}
              <a href={p.url} target='_blank' rel='noopener' className='text-blue-700 hover:underline'>{p.title || p.site}</a>
              <span className='text-stone-600'> · {p.site.replace(/^www\./, '')}</span>
            </li>)}
          </ul>}
        </li>)}
      </ol>
      {hikes.length >= 2 && walk <= 3.5 && <div className='flex items-center gap-3 rounded-2xl border border-dashed border-stone-400 px-4 py-3.5'>
        <span className='flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#eef2ea] font-display font-bold text-lime-800'>{hikes.length}</span>
        <span className='flex flex-col gap-0.5'>
          <span className='text-[15px] font-semibold'>Do them all</span>
          <span className='text-[13px] text-stone-700'>{km1(total)} and about {walk < 1 ? `${Math.round((walk * 60) / 5) * 5} minutes` : `${Math.round(walk * 2) / 2} hours`} of walking in all{new Set(hikes.map((h) => h.from)).size > 1 ? ', plus getting between trailheads' : ''}.</span>
        </span>
      </div>}
      {stops.length > 0 && <Others title='Quick stops' blurb='A short walk from the car to a view.' items={stops.map((s, i) => ({ key: `${park}/stop/${i}`, badge: '', title: s.dest, meta: quickStop(s), open: () => onOpen(park, `${park}/stop/${i}`) }))} />}
      {nearby && nearby.length > 0 && <div>
        <h3 className='mb-1 font-display text-base font-bold'>More hiking nearby</h3>
        <ul>{nearby.map((p) => <li key={p.id}>
          <button type='button' onClick={() => onPark?.(p.id, p.name)} className='tap-row flex w-full items-center justify-between border-b border-stone-100 px-1 py-3 text-left'>
            <span className='flex flex-col gap-0.5'>
              <span className='text-[15px] font-semibold text-blue-700'>{p.name}</span>
              <span className='text-[13px] text-stone-600'>{plural(p.hikes, 'hike')} · {p.km} km away</span>
            </span>
            <span aria-hidden='true' className='text-stone-500'>›</span>
          </button>
        </li>)}</ul>
      </div>}
    </div>;
  }

  const top = picks(hikes);
  const count = (pred: (h: ParkHike) => boolean) => hikes.filter(pred).length;
  const toggle = (d: Difficulty) => setF({ ...f, diffs: f.diffs.includes(d) ? f.diffs.filter((x) => x !== d) : [...f.diffs, d] });
  return <div className='mt-3 flex flex-col gap-4'>
    {tabs.length > 1 && <div className='grid gap-2' style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((t) => <button key={t.tab} type='button' aria-pressed={tab === t.tab} onClick={() => setTab(t.tab)}
        className={`tap rounded-2xl border p-3 text-left text-green-900 ${tab === t.tab ? 'border-green-900 bg-green-50' : 'border-stone-200 bg-white hover:bg-stone-50'}`}>
        <span className='block font-display text-2xl font-bold leading-none'>{t.n}</span>
        <span className='mt-1 block text-xs'>{t.label}</span>
      </button>)}
    </div>}

    {tab === 'day' && <>
      {top.length > 0 && <div>
        <h3 className='mb-2 font-display text-base font-bold'>Start here</h3>
        <div className='flex gap-2.5 overflow-x-auto pb-1'>
          {top.map((p) => <button key={p.hike.id} type='button' onClick={() => onOpen(park, p.hike.id)} onMouseEnter={() => onHover(p.hike.id)} onMouseLeave={() => onHover(null)}
            className='tap flex w-[136px] shrink-0 flex-col gap-1.5 rounded-2xl border border-stone-200 bg-stone-50 p-3 text-left hover:border-fuchsia-500'>
            <span className='text-[11px] font-semibold uppercase tracking-wider text-lime-800'>{p.tag}</span>
            <Thumb line={p.hike.route.line} size={56} className='h-14 w-full' />
            <span className='text-sm font-semibold leading-tight'>{p.hike.title}</span>
            <span className='text-xs text-stone-600'>{km1(p.hike.route.km)} · ↑ {m(p.hike.route.gain)}</span>
          </button>)}
        </div>
      </div>}

      <div className='flex flex-col gap-2.5'>
        <div className='flex items-baseline justify-between'>
          <h3 className='font-display text-base font-bold'>Find a hike</h3>
          <label className='flex items-center gap-1.5 text-[13px] text-stone-600'>Sort
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} className='rounded-lg border border-stone-300 bg-white px-2 py-1 text-stone-900'>
              <option value='best'>Best first</option><option value='shortest'>Shortest</option><option value='least-climb'>Least climbing</option><option value='highest'>Highest point</option>
            </select>
          </label>
        </div>
        <div className='flex flex-wrap gap-1.5' role='group' aria-label='How long'>
          {(['any', 'short', 'half', 'full'] as const).map((t) => <Chip key={t} on={f.time === t} onClick={() => setF({ ...f, time: t })}>
            {{ any: 'Any length', short: 'Under 2 h', half: '2–5 h', full: 'Full day' }[t]}{t !== 'any' && ` · ${count((h) => timeBand(h.hours) === t)}`}
          </Chip>)}
        </div>
        <div className='flex flex-wrap gap-1.5' role='group' aria-label='Difficulty'>
          {DIFFICULTIES.filter((d) => count((h) => h.diff === d) > 0).map((d) => <Chip key={d} on={f.diffs.includes(d)} onClick={() => toggle(d)}>{d} · {count((h) => h.diff === d)}</Chip>)}
        </div>
        <div className='flex flex-wrap gap-1.5' role='group' aria-label="What you'll see">
          {count((h) => h.lake) > 0 && <Chip on={f.lakes} onClick={() => setF({ ...f, lakes: !f.lakes })}>Lakes</Chip>}
          {count((h) => h.summit) > 0 && <Chip on={f.summits} onClick={() => setF({ ...f, summits: !f.summits })}>Summits</Chip>}
          {count((h) => h.loop) > 0 && <Chip on={f.loops} onClick={() => setF({ ...f, loops: !f.loops })}>Loops</Chip>}
          {count((h) => h.reports > 0) > 0 && <Chip on={f.reports} onClick={() => setF({ ...f, reports: !f.reports })}>Trip reports</Chip>}
        </div>
      </div>

      <div className='flex justify-between text-[13px] text-stone-600'>
        <span>{shown.length} {shown.length === 1 ? 'hike' : 'hikes'}{filtered ? ' match' : sort === 'best' ? ', best first' : ''}</span>
        {filtered && <button type='button' className='tap text-blue-700 hover:underline' onClick={() => setF(NO_FILTERS)}>Clear filters</button>}
      </div>
      <ul className='-mx-2 flex flex-col'>
        {shown.map((h) => <HikeRow key={h.id} h={h} onOpen={() => onOpen(park, h.id)} onHover={hover(h.id)} />)}
      </ul>
      {shown.length === 0 && <div className='text-stone-600'>No hikes match. <button type='button' className='tap text-blue-700 hover:underline' onClick={() => setF(NO_FILTERS)}>Clear filters</button></div>}
    </>}

    {tab === 'camps' && <Others title='Base camps' blurb='Walk in once, camp, and do day hikes from camp.'
      items={doc.base_camps.map((b, i) => ({ key: `${park}/base/${i}`, badge: String(b.hikes.length), title: b.camp,
        meta: `${km1(b.approach.km)} walk in from ${trailhead(b.from)} · ↑ ${m(b.approach.gain)} · ${plural(b.hikes.length, 'day hike')} from camp`,
        open: () => onOpen(park, `${park}/base/${i}`), hover: hover(`${park}/base/${i}`) }))} />}
    {tab === 'multi' && <Others title='Multi-day trips' blurb='Backpacking routes, campground to campground.'
      items={multi.map((t) => ({ key: t.id, badge: String(Math.round(t.km)), title: t.title,
        meta: `${t.km.toFixed(0)} km · ↑ ${m(t.gain)} · ${t.loop ? 'loop' : 'one way'}${t.camps ? ` · ${plural(t.camps, 'campground')} along it` : ''}${t.inPark ? ` · in ${t.inPark}` : ''}`,
        open: () => onOpen(t.park, t.id), hover: t.park === park ? hover(t.id) : undefined }))} />}
    {tab === 'stops' && <Others title='Quick stops' blurb='A short walk from the car to a view: for a road trip or a rest day.'
      items={stops.map((s, i) => ({ key: `${park}/stop/${i}`, badge: '', title: s.dest, meta: quickStop(s), open: () => onOpen(park, `${park}/stop/${i}`), hover: hover(`${park}/stop/${i}`) }))} />}
  </div>;
}

function quickStop(s: Stop): string {
  const km = s.route.one_way_km ?? s.route.km / 2;
  if (km < 0.05) return s.from === "Road's end" ? 'By the road' : `By the road at ${trailhead(s.from)}`;
  return `${(km * 2).toFixed(1)} km there and back from ${s.from === "Road's end" ? "the road's end" : trailhead(s.from)}`;
}

function Others({ title, blurb, items }: { title: string; blurb: string; items: { key: string; badge: string; title: string; meta: string; open: () => void; hover?: (on: boolean) => void }[] }) {
  return <div>
    <h3 className='font-display text-base font-bold'>{title}</h3>
    <p className='mt-1 text-sm text-stone-600'>{blurb}</p>
    <ul className='-mx-2 mt-1'>
      {items.map((it) => <li key={it.key}>
        <button type='button' onClick={it.open} onMouseEnter={() => it.hover?.(true)} onMouseLeave={() => it.hover?.(false)}
          className='tap-row flex w-full items-center gap-3 border-b border-stone-100 px-2 py-3 text-left hover:bg-fuchsia-50'>
          {it.badge && <span className='flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#eef2ea] font-display font-bold text-lime-800'>{it.badge}</span>}
          <span className='flex flex-col gap-0.5'>
            <span className='text-[15px] font-semibold text-stone-900'>{it.title}</span>
            <span className='text-[13px] text-stone-700'>{it.meta}</span>
          </span>
        </button>
      </li>)}
    </ul>
  </div>;
}
