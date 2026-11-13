// com.atproto.identity.resolveHandle, for signing in: the OAuth client asks
// it for the DID of the handle typed. Answered here, so handles and visitors'
// addresses aren't sent to a third party.
import type { LoaderFunctionArgs } from 'react-router';
import { resolveHandle } from '~/atproto/identity';

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const handle = new URL(request.url).searchParams.get('handle') ?? '';
  const did = await resolveHandle(handle);
  if (!did) return Response.json({ error: 'HandleNotFound', message: 'Unable to resolve handle' }, { status: 400 });
  return Response.json({ did }, { headers: { 'cache-control': 'public, max-age=60' } });
};
