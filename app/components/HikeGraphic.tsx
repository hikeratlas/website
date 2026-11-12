// The homepage's featured hike as an infographic: its route's shape, with
// what it passes numbered, beside its elevation profile with the same
// numbers at their distances. The profile is measured in the browser from
// Mapterhorn's DEM, as the hike sheet's is; until then the shape stands alone.
import { useEffect, useState } from 'react';
import { profile } from '~/routing/elevation';
import type { Featured } from '~/featured';

type Hike = Featured['hike'];

const W = 320, H = 180;
// The profile's box, right of the shape's.
const PX = 132, PW = W - PX - 10, PT = 22, PB = 146;

export default function HikeGraphic({ hike }: { hike: Hike }) {
  const [prof, setProf] = useState<[number, number][] | null>(null);
  useEffect(() => {
    let live = true;
    profile(hike.coords).then((p) => { if (live) setProf(p.points); }).catch(() => {});
    return () => { live = false; };
  }, [hike.coords]);

  // The shape, in its 120x120 box, left of the profile.
  const ox = 4, oy = 30;
  const shape = hike.line.split(' ').map((p) => { const [x, y] = p.split(',').map(Number); return `${(x + ox).toFixed(1)},${(y + oy).toFixed(1)}`; }).join(' ');
  const at = (x: number, y: number) => [x + ox, y + oy];
  const start = hike.line.split(' ')[0]?.split(',').map(Number) ?? [0, 0];

  let chart: React.ReactNode = <text x={PX + PW / 2} y={(PT + PB) / 2} textAnchor='middle' fontSize='11' fill='#a8a29e'>Measuring elevation…</text>;
  if (prof && prof.length > 1) {
    const total = prof[prof.length - 1][0];
    const es = prof.map(([, e]) => e);
    const lo = Math.min(...es), hi = Math.max(...es);
    const y0 = Math.floor((lo - 30) / 100) * 100, y1 = Math.ceil((hi + 30) / 100) * 100;
    const x = (d: number) => PX + (d / total) * PW;
    const y = (e: number) => PB - ((e - y0) / Math.max(y1 - y0, 1)) * (PB - PT);
    const line = prof.map(([d, e]) => `${x(d).toFixed(1)},${y(e).toFixed(1)}`).join(' ');
    const eAt = (m: number) => prof[Math.min(prof.length - 1, Math.round((m / total) * (prof.length - 1)))][1];
    chart = <>
      <line x1={PX} x2={PX + PW} y1={PB} y2={PB} stroke='#d6d3d1' />
      <text x={PX} y={PB + 13} fontSize='10' fill='#78716c'>0</text>
      <text x={PX + PW} y={PB + 13} fontSize='10' fill='#78716c' textAnchor='end'>{hike.km_total.toFixed(1)} km</text>
      <text x={PX - 3} y={y(hi) + 3} fontSize='10' fill='#78716c' textAnchor='end'>{Math.round(hi).toLocaleString('en-US')} m</text>
      <text x={PX - 3} y={y(lo) + 3} fontSize='10' fill='#78716c' textAnchor='end'>{Math.round(lo).toLocaleString('en-US')}</text>
      <polygon points={`${x(0)},${PB} ${line} ${x(total)},${PB}`} fill='#c026d3' fillOpacity='0.12' />
      <polyline points={line} fill='none' stroke='#a21caf' strokeWidth='2' strokeLinejoin='round' />
      {hike.along.map((f) => {
        const m = Math.min(f.km * 1000, total);
        const cy = Math.max(PT - 8, y(eAt(m)) - 12);
        return <g key={f.n}>
          <circle cx={x(m)} cy={cy} r='7' fill='#a21caf' stroke='#ffffff' strokeWidth='1.5' />
          <text x={x(m)} y={cy + 3.5} textAnchor='middle' fontSize='9' fontWeight='700' fill='#ffffff'>{f.n}</text>
        </g>;
      })}
    </>;
  }

  return <svg viewBox={`0 0 ${W} ${H}`} className='block h-auto w-full' role='img'
    aria-label={`${hike.title}: its route and elevation profile${hike.along.length ? `, passing ${hike.along.map((f) => f.name).join(', ')}` : ''}`}>
    <polyline points={shape} fill='none' stroke='#ffffff' strokeWidth='6' strokeLinejoin='round' strokeLinecap='round' />
    <polyline points={shape} fill='none' stroke='#c026d3' strokeWidth='3' strokeLinejoin='round' strokeLinecap='round' />
    {(() => { const [sx, sy] = at(start[0], start[1]); return <circle cx={sx} cy={sy} r='5' fill='#15803d' stroke='#ffffff' strokeWidth='1.5' />; })()}
    {hike.along.map((f) => {
      const [fx, fy] = at(f.x, f.y);
      return <g key={f.n}>
        <circle cx={fx} cy={fy} r='7' fill='#a21caf' stroke='#ffffff' strokeWidth='1.5' />
        <text x={fx} y={fy + 3.5} textAnchor='middle' fontSize='9' fontWeight='700' fill='#ffffff'>{f.n}</text>
      </g>;
    })}
    {chart}
  </svg>;
}
