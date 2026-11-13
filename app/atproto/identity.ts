// Finding an account on the AT Protocol, on the server: a handle to its DID
// (its permanent id), and a DID to its PDS (the server holding its data).
// Our own, so handle lookups for signing in don't go to a third party.

const HANDLE_RE = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$/;
const DID_RE = /^did:(plc:[a-z2-7]{24}|web:[a-zA-Z0-9.-]+)$/;

export const isHandle = (h: string) => h.length <= 253 && HANDLE_RE.test(h);
export const isDid = (d: string) => DID_RE.test(d);

// A handle's DID: its _atproto TXT record (over DNS-over-HTTPS), else
// https://<handle>/.well-known/atproto-did (the two ways atproto allows).
export async function resolveHandle(handle: string): Promise<string | null> {
  handle = handle.toLowerCase();
  if (!isHandle(handle)) return null;
  try {
    const r = await fetch(`https://cloudflare-dns.com/dns-query?name=_atproto.${handle}&type=TXT`, { headers: { accept: 'application/dns-json' } });
    if (r.ok) {
      const j = await r.json() as { Answer?: { data: string }[] };
      for (const a of j.Answer ?? []) {
        const m = a.data.replace(/"/g, '').match(/^did=(did:\S+)$/);
        if (m && isDid(m[1])) return m[1];
      }
    }
  } catch { /* try the well-known file */ }
  try {
    const r = await fetch(`https://${handle}/.well-known/atproto-did`, { redirect: 'error' });
    if (r.ok) {
      const did = (await r.text()).trim();
      if (isDid(did)) return did;
    }
  } catch { /* not found */ }
  return null;
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
