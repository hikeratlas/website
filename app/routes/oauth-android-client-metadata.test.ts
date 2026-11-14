// The Android app's OAuth client metadata: what a PDS checks before it lets
// the app sign anyone in.
import { describe, expect, it } from 'vitest';
import { OAUTH_SCOPE } from '~/atproto/scope';
import { loader } from './oauth-android-client-metadata[.]json';

const LIVE = 'https://www.hikeratlas.com/oauth-android-client-metadata.json';

const metadata = async (url: string) =>
  (await loader({ request: new Request(url) } as Parameters<typeof loader>[0]).json()) as Record<string, unknown>;

describe('the Android app’s OAuth client metadata', () => {
  // The app's identity to every PDS, once people sign in: it must never move.
  it('names its own URL as the client id, on the live site', async () => {
    expect((await metadata(LIVE)).client_id).toBe(LIVE);
  });

  // A PDS rejects a native client whose scheme isn't its host reversed; the
  // app's intent filter registers this one.
  it('redirects to the scheme the app registers: the host reversed', async () => {
    expect((await metadata(LIVE)).redirect_uris).toEqual(['com.hikeratlas.www:/oauth/callback']);
  });

  it('gives a preview its own client id and scheme', async () => {
    const m = await metadata('https://abc123.website.pages.dev/oauth-android-client-metadata.json');
    expect(m.client_id).toBe('https://abc123.website.pages.dev/oauth-android-client-metadata.json');
    expect(m.redirect_uris).toEqual(['dev.pages.website.abc123:/oauth/callback']);
  });

  it('asks for what the site asks for, as a native public client', async () => {
    expect(await metadata(LIVE)).toMatchObject({
      scope: OAUTH_SCOPE,
      application_type: 'native',
      token_endpoint_auth_method: 'none',
      dpop_bound_access_tokens: true,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
    });
  });
});
