// Your page's Settings tab (/@<handle>/settings): the licence your new posts
// are shared under, in your profile record (actor.profile/self). Only yours
// to see: someone else's settings show in what they post.
import { useEffect, useState } from 'react';
import { Link, useRevalidator, type MetaFunction } from 'react-router';
import { profilePath } from '~/atproto/identity';
import { DEFAULT_LICENSE, LICENSES, saveSettings } from '~/atproto/posts';
import { useProfile } from './$handle';

export const meta: MetaFunction = ({ matches }) => {
  const parent = matches.find((m) => m?.id === 'routes/$handle')?.loaderData as { handle?: string | null; who?: string } | undefined;
  return [{ title: `Settings | @${parent?.handle ?? parent?.who ?? ''} | Hiker Atlas` }, { name: 'robots', content: 'noindex' }];
};

export default function Settings() {
  const { name, pds, license, session } = useProfile();
  const revalidator = useRevalidator();
  if (!session || !pds) return <p className='mt-4 text-stone-600'>
    These are @{name}’s settings: sign in as @{name} to see them. <Link to={profilePath(name)}>Back to their hikes</Link>.
  </p>;
  return <LicenseSetting current={license} onSave={async (l) => { await saveSettings(session, pds, { license: l }); revalidator.revalidate(); }} />;
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
      <span className='text-sm text-stone-500'>{state === 'saving' ? 'Saving…' : state === 'saved' ? 'Saved. Posts you’ve already made keep theirs.' : state === 'idle' ? 'Posts you’ve already made keep theirs.' : state}</span>
    </fieldset>
  </section>;
}
