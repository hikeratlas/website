// Units for distances and elevations, as the reader likes them: their Hiker
// Atlas profile's (com.hikeratlas.temp.actor.profile `units`, set on their
// Settings tab), read when they sign in and remembered in this browser so a
// page shows them from its first paint after that; metric otherwise. Data
// stays metric everywhere: these only format it for display.
//
// Server-rendered pages are metric (the server doesn't know who's reading);
// useUnits() gives metric until the page has hydrated, then the reader's.
import { useSyncExternalStore } from 'react';

export type DistanceUnit = 'km' | 'mi';
export type ElevationUnit = 'm' | 'ft';
export interface Units { distance: DistanceUnit; elevation: ElevationUnit }

export const METRIC: Units = { distance: 'km', elevation: 'm' };
const KEY = 'hikeratlas:units';
const KM_PER_MI = 1.609344;
const M_PER_FT = 0.3048;

// Units from a profile record's `units` (other values are ignored).
export function unitsOf(u: { distance?: unknown; elevation?: unknown } | undefined | null): Units {
  return {
    distance: u?.distance === 'mi' ? 'mi' : 'km',
    elevation: u?.elevation === 'ft' ? 'ft' : 'm',
  };
}

let current: Units = METRIC;
let loaded = false;
const listeners = new Set<() => void>();

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const v = window.localStorage.getItem(KEY);
    if (v) current = unitsOf(JSON.parse(v));
  } catch { /* no storage: metric until signed in */ }
}

export function setUnits(u: Units) {
  load();
  if (u.distance === current.distance && u.elevation === current.elevation) return;
  current = u;
  try { window.localStorage.setItem(KEY, JSON.stringify(u)); } catch { /* not remembered */ }
  listeners.forEach((l) => l());
}

// Signed out: back to metric, and forgotten here.
export function resetUnits() {
  try { window.localStorage.removeItem(KEY); } catch { /* nothing to forget */ }
  setUnits(METRIC);
}

// The reader's units now, for text made outside rendering (in an effect or
// event); metric on the server.
export function getUnits(): Units {
  load();
  return current;
}

export function useUnits(): Units {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => { load(); return current; },
    () => METRIC,
  );
}

const group = (n: number) => Math.round(n).toLocaleString('en-US');

// A distance given in km: "12.4 km" or "7.7 mi". digits: decimals (by
// default one below 10, else none).
export function distance(km: number, u: Units, digits?: number): string {
  const v = u.distance === 'mi' ? km / KM_PER_MI : km;
  const d = digits ?? (v < 10 ? 1 : 0);
  return `${v.toFixed(d)} ${u.distance}`;
}

// A distance's number alone, in the reader's unit (for chart ticks).
export const distanceValue = (km: number, u: Units) => (u.distance === 'mi' ? km / KM_PER_MI : km);
export const kmPerUnit = (u: Units) => (u.distance === 'mi' ? KM_PER_MI : 1);

// An elevation or climb given in metres: "1,150 m" or "3,773 ft".
export function elevation(m: number, u: Units): string {
  return `${group(u.elevation === 'ft' ? m / M_PER_FT : m)} ${u.elevation}`;
}

// An area given in m², for lakes: "1.1 km²" or "0.4 mi²".
export function area(m2: number, u: Units): string {
  const v = u.distance === 'mi' ? m2 / (KM_PER_MI * KM_PER_MI * 1e6) : m2 / 1e6;
  return `${v.toFixed(v < 10 ? 1 : 0)} ${u.distance}²`;
}

// The formatters, bound to the reader's units.
export function useFormat() {
  const u = useUnits();
  return {
    units: u,
    dist: (km: number, digits?: number) => distance(km, u, digits),
    elev: (m: number) => elevation(m, u),
    area: (m2: number) => area(m2, u),
  };
}
