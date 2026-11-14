// Someone's page, its Debug tab (/@<handle>/debug): their Hiker Atlas
// records as their PDS has them, for developers (and for seeing how AT
// Protocol records work). Read in the browser straight from the PDS: which
// collections the repository has (com.atproto.repo.describeRepo), then every
// record in each com.hikeratlas.* one (com.atproto.repo.listRecords), unfiltered
// and as stored, malformed ones included.
import { useEffect, useState, type ReactNode } from 'react';
import type { MetaFunction } from 'react-router';
import { FAVE, PROFILE, REVIEW, TRACK } from '~/atproto/scope';
import { useProfile } from './$handle';

export const meta: MetaFunction = ({ matches }) => {
  const parent = matches.find((m) => m?.id === 'routes/$handle')?.loaderData as { handle?: string | null; who?: string } | undefined;
  return [{ title: `Debug | @${parent?.handle ?? parent?.who ?? ''} | Hiker Atlas` }, { name: 'robots', content: 'noindex' }];
};

const OURS = 'com.hikeratlas.';
const LEXICONS = 'https://github.com/hikeratlas/atproto-lexicon/blob/main/lexicons';
// The collections whose schemas hikeratlas/atproto-lexicon publishes (an
// account may have others under com.hikeratlas., e.g. from the beta's spike).
const PUBLISHED = new Set([PROFILE, FAVE, TRACK, REVIEW]);

interface Rec { uri: string; cid: string; value: unknown }
interface Collection { nsid: string; url: string; records: Rec[] | null; error?: string }

function xrpc(pds: string, method: string, params: Record<string, string>): string {
  const u = new URL(`/xrpc/${method}`, pds);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

async function listAll(pds: string, did: string, nsid: string): Promise<Rec[]> {
  const out: Rec[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const r = await fetch(xrpc(pds, 'com.atproto.repo.listRecords', { repo: did, collection: nsid, limit: '100', ...(cursor ? { cursor } : {}) }));
    if (!r.ok) throw new Error(`listRecords: HTTP ${r.status}`);
    const j = await r.json() as { records: Rec[]; cursor?: string };
    out.push(...j.records);
    if (!j.cursor || !j.records.length) break;
    cursor = j.cursor;
  }
  return out;
}

// The blobs a record refers to ({$type: 'blob', ref: {$link: <CID>}}),
// anywhere in it.
function blobs(v: unknown, out: { cid: string; mimeType?: string; size?: number }[] = []) {
  if (Array.isArray(v)) v.forEach((x) => blobs(x, out));
  else if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    const link = (o.ref as { $link?: unknown } | undefined)?.$link;
    if (o.$type === 'blob' && typeof link === 'string') out.push({ cid: link, mimeType: o.mimeType as string, size: o.size as number });
    else Object.values(o).forEach((x) => blobs(x, out));
  }
  return out;
}

const mono = 'font-mono text-[13px]';
const A = ({ href, children }: { href: string; children: ReactNode }) =>
  <a href={href} target='_blank' rel='noreferrer' className={`${mono} break-all text-blue-700 hover:underline`}>{children}</a>;

export default function Debug() {
  const { did, pds, name } = useProfile();
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [others, setOthers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!did || !pds) return;
    let live = true;
    (async () => {
      try {
        const r = await fetch(xrpc(pds, 'com.atproto.repo.describeRepo', { repo: did }));
        if (!r.ok) throw new Error(`describeRepo: HTTP ${r.status}`);
        const all = ((await r.json()) as { collections?: string[] }).collections ?? [];
        const ours = all.filter((c) => c.startsWith(OURS)).sort();
        if (!live) return;
        setOthers(all.filter((c) => !c.startsWith(OURS)));
        setCollections(ours.map((nsid) => ({ nsid, url: xrpc(pds, 'com.atproto.repo.listRecords', { repo: did, collection: nsid }), records: null })));
        for (const nsid of ours) {
          listAll(pds, did, nsid)
            .then((records) => live && setCollections((cs) => cs!.map((c) => (c.nsid === nsid ? { ...c, records } : c))))
            .catch((e) => live && setCollections((cs) => cs!.map((c) => (c.nsid === nsid ? { ...c, records: [], error: String(e?.message ?? e) } : c))));
        }
      } catch (e) {
        if (live) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => { live = false; };
  }, [did, pds]);

  if (!did || !pds) return null;
  const didDoc = did.startsWith('did:plc:') ? `https://plc.directory/${did}` : `https://${did.slice('did:web:'.length)}/.well-known/did.json`;
  return <div className='mt-4 flex flex-col gap-6'>
    <p className='text-sm italic text-stone-500'>This page is meant for developers.</p>

    <section>
      <h2 className='!mt-0'>Account</h2>
      <dl className='mt-2 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm'>
        <dt className='text-stone-500'>Handle</dt><dd className={mono}>@{name}</dd>
        <dt className='text-stone-500'>DID</dt><dd><A href={didDoc}>{did}</A></dd>
        <dt className='text-stone-500'>PDS</dt><dd><A href={pds}>{pds}</A></dd>
        <dt className='text-stone-500'>Repository</dt><dd><A href={xrpc(pds, 'com.atproto.repo.describeRepo', { repo: did })}>describeRepo</A></dd>
      </dl>
      <p className='mt-2 text-sm text-stone-600'>
        The DID is the account’s permanent id; its document says which PDS (server) holds its repository. Each record
        in it is at <code className={mono}>at://&lt;DID&gt;/&lt;collection&gt;/&lt;record key&gt;</code>, and the CID is
        the hash of its content.
      </p>
    </section>

    {error && <p role='alert' className='text-sm text-red-700'>{error}</p>}
    {!collections && !error && <p className='text-sm text-stone-500'>Reading the repository…</p>}
    {collections && collections.length === 0 && <p className='text-sm text-stone-600'>No Hiker Atlas records in this repository.</p>}

    {collections?.map((c) => <section key={c.nsid}>
      <h2 className={`!mt-0 ${mono} !text-base`}>{c.nsid}</h2>
      <div className='mt-1 flex flex-wrap gap-x-4 text-sm'>
        <span className='text-stone-600'>{c.records ? `${c.records.length} record${c.records.length === 1 ? '' : 's'}` : 'Loading…'}</span>
        {PUBLISHED.has(c.nsid)
          ? <A href={`${LEXICONS}/${c.nsid.replace(/\./g, '/')}.json`}>lexicon</A>
          : <span className='text-stone-500'>no published lexicon (not used by Hiker Atlas)</span>}
        <A href={c.url}>listRecords</A>
      </div>
      {c.error && <p className='text-sm text-red-700'>{c.error}</p>}
      <div className='mt-2 flex flex-col gap-2'>
        {c.records?.map((r) => {
          const bs = blobs(r.value);
          return <details key={r.uri} className='rounded-lg border border-stone-200 bg-stone-50'>
            <summary className={`cursor-pointer px-3 py-2 ${mono} break-all`}>{r.uri.split('/').pop()}</summary>
            <div className='flex flex-col gap-1 border-t border-stone-200 px-3 py-2 text-sm'>
              <div><span className='text-stone-500'>URI </span><span className={`${mono} break-all`}>{r.uri}</span></div>
              <div><span className='text-stone-500'>CID </span><span className={`${mono} break-all`}>{r.cid}</span></div>
              <div><A href={xrpc(pds, 'com.atproto.repo.getRecord', { repo: did, collection: c.nsid, rkey: r.uri.split('/').pop() ?? '' })}>getRecord</A></div>
              {bs.map((b) => <div key={b.cid}><span className='text-stone-500'>Blob </span>
                <A href={xrpc(pds, 'com.atproto.sync.getBlob', { did, cid: b.cid })}>{b.cid}</A>
                <span className='text-stone-500'> {b.mimeType}{typeof b.size === 'number' ? `, ${b.size.toLocaleString('en-US')} bytes` : ''}</span></div>)}
              <pre className={`mt-1 overflow-x-auto rounded bg-white p-2 ${mono} leading-snug`}>{JSON.stringify(r.value, null, 2)}</pre>
            </div>
          </details>;
        })}
      </div>
    </section>)}

    {others.length > 0 && <p className='text-xs text-stone-500'>
      The repository has {others.length} other collection{others.length === 1 ? '' : 's'}, from other apps: {others.join(', ')}.
    </p>}
  </div>;
}
