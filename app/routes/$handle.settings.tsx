// Your page's Settings tab (/@<handle>/settings): the units distances and
// elevations show in, and the licence your new posts are shared under, in
// your profile record (actor.profile/self). Only yours to see.
import { useEffect, useState } from 'react';
import { Link, useRevalidator, type MetaFunction } from 'react-router';
import { profilePath } from '~/atproto/identity';
import { DEFAULT_LICENSE, LICENSES, saveSettings } from '~/atproto/posts';
import { setUnits, unitsOf, type Units } from '~/units';
import { useProfile } from './$handle';

export const meta: MetaFunction = ({ matches }) => {
  const parent = matches.find((m) => m?.id === 'routes/$handle')?.loaderData as { handle?: string | null; who?: string } | undefined;
  return [{ title: `Settings | @${parent?.handle ?? parent?.who ?? ''} | Hiker Atlas` }, { name: 'robots', content: 'noindex' }];
};

export default function Settings() {
  const { name, pds, license, units, session } = useProfile();
  const revalidator = useRevalidator();
  if (!session || !pds) return <p className='mt-4 text-stone-600'>
    These are @{name}’s settings: sign in as @{name} to see them. <Link to={profilePath(name)}>Back to their hikes</Link>.
  </p>;
  return <>
    <UnitsSetting current={unitsOf(units)} onSave={async (u) => {
      await saveSettings(session, pds, { units: u });
      setUnits(u);
      revalidator.revalidate();
    }} />
    <LicenseSetting current={license} onSave={async (l) => { await saveSettings(session, pds, { license: l }); revalidator.revalidate(); }} />
  </>;
}

// The units distances and elevations show in, everywhere on Hiker Atlas.
function UnitsSetting({ current, onSave }: { current: Units; onSave: (u: Units) => Promise<void> }) {
  const [value, setValue] = useState(current);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  useEffect(() => { setValue(current); }, [current.distance, current.elevation]); // eslint-disable-line react-hooks/exhaustive-deps
  const save = async (u: Units) => {
    setValue(u); setState('saving');
    try { await onSave(u); setState('saved'); } catch (e) { setState(e instanceof Error ? e.message : String(e)); }
  };
  const choice = (name: string, options: [string, string][], v: string, set: (x: string) => void) =>
    <fieldset className='flex flex-col gap-1.5'>
      <legend className='mb-1 font-semibold'>{name}</legend>
      {options.map(([k, label]) => <label key={k} className='flex items-center gap-2'>
        <input type='radio' name={name} value={k} checked={v === k} onChange={() => set(k)} disabled={state === 'saving'} />
        <span>{label}</span>
      </label>)}
    </fieldset>;
  return <section>
    <h2>Units</h2>
    <div className='mt-2 flex flex-wrap gap-x-12 gap-y-4'>
      {choice('Distance', [['km', 'Kilometres (km)'], ['mi', 'Miles (mi)']], value.distance,
        (d) => save({ ...value, distance: d as Units['distance'] }))}
      {choice('Elevation', [['m', 'Metres (m)'], ['ft', 'Feet (ft)']], value.elevation,
        (e) => save({ ...value, elevation: e as Units['elevation'] }))}
    </div>
    <p className='mt-2 text-sm text-stone-500'>{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved.' : state === 'idle' ? 'For distances, climbs and heights across Hiker Atlas.' : state}</p>
  </section>;
}

// Your own page: the licence your new posts are shared under.
function LicenseSetting({ current, onSave }: { current: string | null; onSave: (l: string) => Promise<void> }) {
  const [value, setValue] = useState(current ?? DEFAULT_LICENSE);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | string>('idle');
  useEffect(() => { setValue(current ?? DEFAULT_LICENSE); }, [current]);
  const save = async (l: string) => {
    setValue(l); setState('saving');
    try { await onSave(l); setState('saved'); } catch (e) { setState(e instanceof Error ? e.message : String(e)); }
  };
  return <section>
    <h2>Licence</h2>
    <fieldset className='mt-2 flex flex-col gap-2'>
      <legend className='mb-2 text-stone-700'>What others may do with your new posts (you keep ownership; <a href='/terms#what-you-post'>details</a>):</legend>
      {LICENSES.map((l) => <label key={l} className='flex items-center gap-2'>
        <input type='radio' name='license' value={l} checked={value === l} onChange={() => save(l)} disabled={state === 'saving'} />
        <span>{l === 'CC0-1.0' ? 'Anything: public domain (CC0)' : l === 'CC-BY-4.0' ? 'Anything, crediting you (CC BY 4.0)' : 'Nothing beyond Hiker Atlas showing them'}</span>
      </label>)}
      <span className='text-sm text-stone-500'>{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved. Posts you’ve already made keep their existing license.' : state === 'idle' ? 'Posts you’ve already made keep their existing license.' : state}</span>
    </fieldset>
  </section>;
}
