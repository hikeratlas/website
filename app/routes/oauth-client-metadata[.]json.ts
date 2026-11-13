// The site's OAuth client metadata (atproto OAuth): its client_id is this
// file's own URL, so each origin (the live site, each preview) is a client
// of its own. A browser-only ("public") client, asking only to write
// Hiker Atlas faves (lexicons/com/hikeratlas/fave.json).
import type { LoaderFunctionArgs } from 'react-router';
import { OAUTH_SCOPE } from '~/atproto/scope';

export const loader = ({ request }: LoaderFunctionArgs) => {
  const origin = new URL(request.url).origin;
  return Response.json({
    client_id: `${origin}/oauth-client-metadata.json`,
    client_name: 'Hiker Atlas',
    client_uri: origin,
    redirect_uris: [`${origin}/oauth/callback`],
    scope: OAUTH_SCOPE,
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'none',
    application_type: 'web',
    dpop_bound_access_tokens: true,
  }, { headers: { 'cache-control': 'public, max-age=300' } });
};
