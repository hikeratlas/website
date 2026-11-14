# Hiker Atlas's lexicons

The AT Protocol schemas of the records Hiker Atlas writes to people's own
accounts (website#130, where the proposal is discussed and versioned). All
are under `com.hikeratlas.temp.*` while in beta: atproto's convention for
schemas that can still change in breaking ways. Stable `com.hikeratlas.*`
names come when they settle.

| File | Record | Written by the site |
|---|---|---|
| `com/hikeratlas/temp/actor/profile.json` | that an account uses Hiker Atlas, and its settings (`self`) | on first sign-in |
| `com/hikeratlas/temp/fave.json` | a faved route; record key = its route key | the hike sheet's heart |
| `com/hikeratlas/temp/track.json` | a GPX trace of an outing | not yet |
| `com/hikeratlas/temp/review.json` | a review of a hike | not yet |
| `com/hikeratlas/temp/defs.json` | shared: route key, point, photo | |
| `com/hikeratlas/authFull.json` | the permission set signing in will ask for | |

## Route keys

A route's identity, computed from its line (recipe v1): `route_key.py` is the
reference implementation, `route_key_vectors.json` real routes and their keys,
and the website's `app/atproto/routeKey.ts` must agree with both (`npm test`).
On the 13 November 2026 north-america build, the two agree on all 59,256 routes.

    python3 lexicons/route_key.py check lexicons/route_key_vectors.json

## Signing in

Sign-in asks for (`app/atproto/scope.ts`):

    atproto repo:com.hikeratlas.temp.actor.profile repo:com.hikeratlas.temp.fave
      repo:com.hikeratlas.temp.track repo:com.hikeratlas.temp.review blob:*/*

`blob:*/*` (uploading GPX traces and photos) can't be part of a permission
set, so it's always asked for directly.

## Publishing (not done yet)

Publishing makes the schemas resolvable by anyone, and lets sign-in ask for
the permission set (`include:com.hikeratlas.authFull`) instead of each
collection. A PDS then shows "Hiker Atlas" and its description when asking,
and adding a collection under `com.hikeratlas.*` (tracks' successors, the
stable names) only needs the published set updated, not everyone to approve
again.

1. An atproto account for Hiker Atlas itself, e.g. `@hikeratlas.com` on
   Bluesky. Its DID (`did:plc:...`) holds the schemas, as
   `com.atproto.lexicon.schema` records keyed by NSID.
2. DNS TXT records pointing each namespace at that DID, one per distinct
   prefix:

       _lexicon.hikeratlas.com             TXT "did=did:plc:..."   (com.hikeratlas.authFull)
       _lexicon.temp.hikeratlas.com        TXT "did=did:plc:..."   (com.hikeratlas.temp.fave, ...)
       _lexicon.actor.temp.hikeratlas.com  TXT "did=did:plc:..."   (com.hikeratlas.temp.actor.profile)

3. Publish with [goat](https://github.com/bluesky-social/goat), logged in as
   that account: `goat lex lint`, then `goat lex publish` from this folder's
   parent.
4. Then switch the `repo:` scopes in `scope.ts` to
   `include:com.hikeratlas.authFull` (keeping `atproto` and `blob:*/*`). The
   client metadata's scope is the most a sign-in may ask for, so it changes in
   the same deploy. People signed in already keep their sessions.
