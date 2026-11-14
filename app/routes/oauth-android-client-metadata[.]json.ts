// The Android app's OAuth client metadata (atproto OAuth; hikeratlas/android).
// As the site's own (oauth-client-metadata[.]json.ts), its client_id is this
// file's own URL. The live one,
// https://www.hikeratlas.com/oauth-android-client-metadata.json, is the app's
// identity to every PDS: approvals and sessions are bound to it, so its path
// and host must never change. Its contents (scope, name, redirect) may.
//
// A native ("public") client: no secret, and no server of ours holds its
// tokens, so sessions last at most two weeks. It asks for what the site asks
// for (scope.ts).
//
// The redirect is a custom scheme, which atproto requires to be the client
// id's host reversed: com.hikeratlas.www:/oauth/callback for the live site,
// the app's intent filter. A preview's metadata names its own host's scheme,
// which only a build of the app registering it can use.
import type { LoaderFunctionArgs } from 'react-router';
import { OAUTH_SCOPE } from '~/atproto/scope';

export const loader = ({ request }: LoaderFunctionArgs) => {
  const { origin, hostname } = new URL(request.url);
  const scheme = hostname.split('.').reverse().join('.');
  return Response.json({
    client_id: `${origin}/oauth-android-client-metadata.json`,
    client_name: 'Hiker Atlas',
    client_uri: origin,
    redirect_uris: [`${scheme}:/oauth/callback`],
    tos_uri: `${origin}/terms`,
    policy_uri: `${origin}/terms#privacy`,
    scope: OAUTH_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'native',
    dpop_bound_access_tokens: true,
  }, { headers: { 'cache-control': 'public, max-age=300' } });
};
