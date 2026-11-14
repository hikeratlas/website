// Where your account sends you back after signing in (the OAuth client
// metadata's redirect_uri): the client finishes signing in, then back to the
// page you signed in from.
import { useEffect, useState } from 'react';
import type { MetaFunction } from 'react-router';
import { init } from '~/atproto/session';

export const meta: MetaFunction = () => [{ title: 'Signing in | Hiker Atlas' }, { name: 'robots', content: 'noindex' }];

export default function OAuthCallback() {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    init().then((r) => {
      if (!r) { setFailed(true); return; }
      const back = r.state && r.state.startsWith('/') && !r.state.startsWith('//') ? r.state : '/map';
      window.location.replace(back);
    });
  }, []);
  return <main className='frame'>
    {failed
      ? <p>Signing in didn&apos;t work. <a href='/map'>Back to the map</a></p>
      : <p>Signing you in…</p>}
  </main>;
}
