// The site's OAuth client metadata (atproto OAuth): its client_id is this
// file's own URL, so each origin (the live site, each preview) is a client
// of its own. The live site's, https://www.hikeratlas.com/oauth-client-metadata.json,
// is Hiker Atlas's identity to every PDS: sessions and approvals are bound
// to it, so it must never change (hikeratlas.com redirects to www).
//
// A browser-only ("public") client: no secret, so sessions last at most two
// weeks (atproto's limit for public clients). Asking to write Hiker Atlas's
// records and upload files (scope.ts).
import type { LoaderFunctionArgs } from 'react-router';
import { OAUTH_SCOPE } from '~/atproto/scope';

export const loader = ({ request }: LoaderFunctionArgs) => {
  const origin = new URL(request.url).origin;
  return Response.json({
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: 'Hiker Atlas',
    client_uri: origin,
    redirect_uris: [`${origin}/oauth/callback`],
    tos_uri: `${origin}/terms`,
    policy_uri: `${origin}/terms#privacy`,
    scope: OAUTH_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  }, { headers: { 'cache-control': 'public, max-age=300' } });
};
