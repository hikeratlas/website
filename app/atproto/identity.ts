// Finding an account on the AT Protocol, on the server: a handle to its DID
// (its permanent id), and a DID to its PDS (the server holding its data).

const HANDLE_RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const DID_RE = /^did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.-]+)$/;

export const isHandle = (h: string) => h.length <= 253 && HANDLE_RE.test(h);
export const isDid = (d: string) => DID_RE.test(d);

// A handle's DID, by Bluesky's public API (which follows the handle's DNS
// record or well-known file, as atproto has it).
export async function resolveHandle(handle: string): Promise<string | null> {
  handle = handle.toLowerCase();
  if (!isHandle(handle)) return null;
  try {
    const r = await fetch(`https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`);
    if (!r.ok) return null;
    const { did } = await r.json() as { did?: string };
    return did && isDid(did) ? did : null;
  } catch {
    return null;
  }
}

// A DID's document: its handle and its PDS.
export async function describeDid(did: string): Promise<{ pds: string; handle?: string } | null> {
  if (!isDid(did)) return null;
  const url = did.startsWith('did:plc:')
    ? `https://plc.directory/${did}`
    : `https://${did.slice('did:web:'.length)}/.well-known/did.json`;
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    const doc = await r.json() as { alsoKnownAs?: string[]; service?: { id: string; type: string; serviceEndpoint: string }[] };
    const pds = doc.service?.find((s) => s.id.endsWith('#atproto_pds') && s.type === 'AtprotoPersonalDataServer')?.serviceEndpoint;
    if (!pds || !/^https:\/\//.test(pds)) return null;
    const handle = doc.alsoKnownAs?.find((a) => a.startsWith('at://'))?.slice('at://'.length);
    return { pds, handle };
  } catch {
    return null;
  }
}
