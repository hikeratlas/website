import { useEffect, useState } from 'react';

// The Android app (hikeratlas/android). It opens the site's /hikes pages
// itself, but doesn't claim the site's links: on Android, a hike page's
// sheet offers "Open in app" where Chrome sees the app installed (the web
// manifest's related_applications, and the app's asset_statements naming
// this site), else "Get the Android app". Other platforms see neither.
export const ANDROID_PACKAGE = 'com.hikeratlas.android';
// The newest main build's APK (the android repo's CI publishes it there).
export const ANDROID_RELEASE = 'https://github.com/hikeratlas/android/releases/latest';
// The host the app takes links for: previews' own hosts wouldn't open it.
const APP_HOST = 'www.hikeratlas.com';

type Related = { platform: string; id?: string };
type State = 'none' | 'open' | 'get';

function useAndroidApp(): State {
  const [state, setState] = useState<State>('none');
  useEffect(() => {
    if (!/Android/i.test(navigator.userAgent)) return;
    const related = (navigator as Navigator & { getInstalledRelatedApps?: () => Promise<Related[]> }).getInstalledRelatedApps;
    // Without the check (browsers other than Chrome), offer the download.
    if (!related) { setState('get'); return; }
    let live = true;
    related.call(navigator)
      .then((apps) => { if (live) setState(apps.some((a) => a.id === ANDROID_PACKAGE) ? 'open' : 'get'); })
      .catch(() => { if (live) setState('get'); });
    return () => { live = false; };
  }, []);
  return state;
}

// Chrome's intent: URL for a page, naming the app, so it opens there
// without the app claiming the site's links; if it's gone, the download.
export function intentUrl(pathname: string): string {
  return `intent://${APP_HOST}${pathname}#Intent;scheme=https;package=${ANDROID_PACKAGE};`
    + `S.browser_fallback_url=${encodeURIComponent(ANDROID_RELEASE)};end`;
}

// The page's own URL (the sheet keeps it on what's showing), read when tapped.
export default function AppLink() {
  const state = useAndroidApp();
  if (state === 'none') return null;
  // A 44px tap target on phones (.tap), with the pill drawn inside it.
  const cls = 'tap flex items-center text-xs text-blue-700 whitespace-nowrap';
  const pill = (label: string) => <span className='border border-blue-200 rounded-full px-2 py-0.5 hover:bg-blue-50'>{label}</span>;
  if (state === 'open') {
    return <a className={cls} href={intentUrl('/hikes')}
      onClick={(e) => { e.currentTarget.href = intentUrl(window.location.pathname); }}>{pill('Open in app')}</a>;
  }
  return <a className={cls} href={ANDROID_RELEASE} target='_blank' rel='noopener noreferrer'
    title='A preview build, installed from GitHub'>{pill('Get the Android app')}</a>;
}
