// The homepage's featured hike's elevation profile, with what it passes
// numbered at its distances, as on the map beside it (MiniMap). Measured in
// the browser from Mapterhorn's DEM, as the hike sheet's is.
import { useEffect, useState } from 'react';
import { profile } from '~/routing/elevation';
import type { Featured } from '~/featured';

type Hike = Featured['hike'];

const W = 200, H = 180;
const PX = 34, PW = W - PX - 8, PT = 40, PB = 150;

export default function HikeGraphic({ hike }: { hike: Hike }) {
  const [prof, setProf] = useState<[number, number][] | null>(null);
  useEffect(() => {
    let live = true;
    profile(hike.coords).then((p) => { if (live) setProf(p.points); }).catch(() => {});
    return () => { live = false; };
  }, [hike.coords]);

  let chart: React.ReactNode = <text x={W / 2} y={H / 2} textAnchor='middle' fontSize='11' fill='#a8a29e'>Measuring elevation…</text>;
  if (prof && prof.length > 1) {
    const total = prof[prof.length - 1][0];
    const es = prof.map(([, e]) => e);
    const lo = Math.min(...es), hi = Math.max(...es);
    const y0 = lo - Math.max(20, (hi - lo) * 0.1), y1 = hi;
    const x = (d: number) => PX + (d / total) * PW;
    const y = (e: number) => PB - ((e - y0) / Math.max(y1 - y0, 1)) * (PB - PT);
    const line = prof.map(([d, e]) => `${x(d).toFixed(1)},${y(e).toFixed(1)}`).join(' ');
    const eAt = (m: number) => prof[Math.min(prof.length - 1, Math.round((m / total) * (prof.length - 1)))][1];
    // Markers closer than a marker's width step up, so none hides another.
    let lastX = -Infinity, lift = 0;
    const marks = hike.along.map((f) => {
      const m = Math.min(f.km * 1000, total);
      lift = x(m) - lastX < 15 ? lift + 15 : 0;
      lastX = x(m);
      return { f, cx: x(m), cy: Math.max(8, y(eAt(m)) - 12 - lift) };
    });
    chart = <>
      <line x1={PX} x2={PX + PW} y1={PB} y2={PB} stroke='#d6d3d1' />
      <text x={PX} y={PB + 14} fontSize='10' fill='#78716c'>0</text>
      <text x={PX + PW} y={PB + 14} fontSize='10' fill='#78716c' textAnchor='end'>{hike.km_total.toFixed(1)} km</text>
      <text x={PX - 4} y={y(hi) + 3} fontSize='10' fill='#78716c' textAnchor='end'>{Math.round(hi).toLocaleString('en-US')}</text>
      <text x={PX - 4} y={y(lo) + 3} fontSize='10' fill='#78716c' textAnchor='end'>{Math.round(lo).toLocaleString('en-US')}</text>
      <text x={PX - 4} y={PT - 18} fontSize='9' fill='#a8a29e' textAnchor='end'>m</text>
      <polygon points={`${x(0)},${PB} ${line} ${x(total)},${PB}`} fill='#c026d3' fillOpacity='0.12' />
      <polyline points={line} fill='none' stroke='#a21caf' strokeWidth='2' strokeLinejoin='round' />
      {marks.map(({ f, cx, cy }) => <g key={f.n}>
        <circle cx={cx} cy={cy} r='7' fill='#a21caf' stroke='#ffffff' strokeWidth='1.5' />
        <text x={cx} y={cy + 3.5} textAnchor='middle' fontSize='9' fontWeight='700' fill='#ffffff'>{f.n}</text>
      </g>)}
    </>;
  }

  return <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio='xMidYMid meet' className='block h-full w-full' role='img'
    aria-label={`${hike.title}: its elevation profile${hike.along.length ? `, passing ${hike.along.map((f) => f.name).join(', ')}` : ''}`}>
    {chart}
  </svg>;
}
