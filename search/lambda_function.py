import json
import math
import os
import re
import shutil
import sqlite3
import sys
import time
import unicodedata
import urllib.error
import urllib.request

# The bundled DB serves the main site.
con = sqlite3.connect('autosuggest.db')

# Basemap builds (see hikeratlas/basemap's build-area.yml) publish their own
# DB as <namespace>.autosuggest.db, e.g. pr-46/nova-scotia.autosuggest.db.
# ?build=<namespace> searches that instead.
BUILD_ROOT = 'https://public.hikeratlas.com'
# Same pattern the website uses, so a build can only be fetched from BUILD_ROOT.
NAMESPACE_RE = re.compile(r'^[a-z0-9-]+(/[a-z0-9-]+)?$')
CACHE_DIR = '/tmp/autosuggest'
# PR rebuilds overwrite a build's DB, so recheck it (cheaply, via ETag) at
# most this often.
REVALIDATE_SECONDS = 60
# Cloudflare rejects Python's default User-Agent with a 403.
USER_AGENT = 'hikeratlas-search/1.0'

# namespace -> {'con': Connection, 'etag': str | None, 'checked': float}
builds = {}


class BuildNotFound(Exception):
    pass


def connection_for(build):
    if build is None:
        return con

    entry = builds.get(build)
    now = time.time()
    if entry and now - entry['checked'] < REVALIDATE_SECONDS:
        return entry['con']

    req = urllib.request.Request(
        '{}/{}.autosuggest.db'.format(BUILD_ROOT, build),
        headers={'User-Agent': USER_AGENT},
    )
    if entry and entry['etag']:
        req.add_header('If-None-Match', entry['etag'])

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            os.makedirs(CACHE_DIR, exist_ok=True)
            # Namespaces only contain [a-z0-9-/], so '__' can't collide.
            path = os.path.join(CACHE_DIR, build.replace('/', '__') + '.db')
            tmp = path + '.tmp'
            with open(tmp, 'wb') as f:
                shutil.copyfileobj(resp, f)
            if entry:
                entry['con'].close()
            os.replace(tmp, path)
            entry = {
                'con': sqlite3.connect('file:{}?mode=ro'.format(path), uri=True),
                'etag': resp.headers.get('ETag'),
                'checked': now,
            }
            builds[build] = entry
    except urllib.error.HTTPError as e:
        if e.code == 304 and entry:
            entry['checked'] = now
        elif e.code == 404:
            # e.g. a PR build that has since been cleaned up.
            if entry:
                entry['con'].close()
                del builds[build]
            raise BuildNotFound(build)
        else:
            raise

    return entry['con']


def dict_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d

# Postal abbreviations people type after a name ("Bear Mountain BC").
ABBREVIATIONS = {
    'AB': 'Alberta', 'BC': 'British Columbia', 'MB': 'Manitoba', 'NB': 'New Brunswick',
    'NL': 'Newfoundland and Labrador', 'NS': 'Nova Scotia', 'NT': 'Northwest Territories',
    'NU': 'Nunavut', 'ON': 'Ontario', 'PE': 'Prince Edward Island', 'PEI': 'Prince Edward Island',
    'QC': 'Quebec', 'SK': 'Saskatchewan', 'YT': 'Yukon',
    'AL': 'Alabama', 'AK': 'Alaska', 'AZ': 'Arizona', 'AR': 'Arkansas', 'CA': 'California',
    'CO': 'Colorado', 'CT': 'Connecticut', 'DE': 'Delaware', 'DC': 'District of Columbia',
    'FL': 'Florida', 'GA': 'Georgia', 'HI': 'Hawaii', 'ID': 'Idaho', 'IL': 'Illinois',
    'IN': 'Indiana', 'IA': 'Iowa', 'KS': 'Kansas', 'KY': 'Kentucky', 'LA': 'Louisiana',
    'ME': 'Maine', 'MD': 'Maryland', 'MA': 'Massachusetts', 'MI': 'Michigan', 'MN': 'Minnesota',
    'MS': 'Mississippi', 'MO': 'Missouri', 'MT': 'Montana', 'NE': 'Nebraska', 'NV': 'Nevada',
    'NH': 'New Hampshire', 'NJ': 'New Jersey', 'NM': 'New Mexico', 'NY': 'New York',
    'NC': 'North Carolina', 'ND': 'North Dakota', 'OH': 'Ohio', 'OK': 'Oklahoma', 'OR': 'Oregon',
    'PA': 'Pennsylvania', 'RI': 'Rhode Island', 'SC': 'South Carolina', 'SD': 'South Dakota',
    'TN': 'Tennessee', 'TX': 'Texas', 'UT': 'Utah', 'VT': 'Vermont', 'VA': 'Virginia',
    'WA': 'Washington', 'WV': 'West Virginia', 'WI': 'Wisconsin', 'WY': 'Wyoming',
    'USA': ('country', 'United States'), 'US': ('country', 'United States'),
}


def fold(s):
    """Lowercase, without accents: "Michoacán" -> "michoacan"."""
    s = unicodedata.normalize('NFKD', s)
    return ''.join(c for c in s if not unicodedata.combining(c)).lower()


def fts_query(q):
    return '"{}"*'.format(' '.join(q.replace('"', ' ').strip().split()))


# Re-ranking by distance from the map's centre (website#44): a result's
# QRank is divided by (1 + km / NEAR_KM)^2. A trail with a quarter of
# another's QRank wins at a quarter of the distance-weighted distance:
# Garibaldi's Panorama Ridge (QRank ~54) beats Banff's (~2,300, 600 km away)
# when you're looking at Garibaldi, while Grand Canyon National Park still
# beats a nearby "Grand Canyon Trail" from Toronto.
NEAR_KM = 50.0
# Candidates for re-ranking: this many best by QRank anywhere, and this many
# best within NEAR_BOX_KM of the centre, so unranked nearby places can win.
NEAR_TOP = 100
NEAR_LOCAL = 50
NEAR_BOX_KM = 200.0


def km_between(lat1, lon1, lat2, lon2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371.0088 * math.asin(math.sqrt(min(1.0, h)))


def near_score(h, near):
    km = km_between(near[0], near[1], h['lat'], h['lon'])
    return (h['qrank'] or 1) / (1 + km / NEAR_KM) ** 2


# Narrowing by place (basemap#250): "granite ridge trail kil", "dawson
# creek b". Every word of a query must match, the last as a prefix: the
# first words the start of a result's name, the rest each the start of a
# word of its place (park, state or province, its abbreviation, country). A
# result matches if some split of the query into name and place fits it.
# Typing more only narrows the name, or adds or tightens a place word, so
# results only ever shrink as you type: "panorama ridge", "panorama ridge
# g" and "panorama ridge gar" are each a subset of the one before.
#
# A park named without its kind, or with it shortened, matches as well as the
# whole query ("killarney park" and "killarney pp" are Killarney Provincial
# Park). Results naming more of the query come first ("lake ontario" is the
# lake before lakes in Ontario), then by QRank, or by distance with near.

# A typed word as FTS tokens: "o'hara" -> o, hara.
TOKEN = re.compile(r'[a-z0-9]+')

# db -> whether its fts has a place column (basemap#250); older DBs' don't.
place_column_cache = {}

STATE_ABBR = {}
for _k, _v in ABBREVIATIONS.items():
    if not isinstance(_v, tuple):
        STATE_ABBR.setdefault(_v, []).append(_k.lower())


def tokens(words):
    return [t for w in words for t in TOKEN.findall(fold(w))]


def has_place_column(db):
    if db not in place_column_cache:
        cols = [r[1] for r in db.execute('pragma table_info(fts)')]
        place_column_cache[db] = 'place' in cols
    return place_column_cache[db]


def search_split(name, place, db, limit):
    """The limit best items whose names match the FTS query name and whose
    places have a word starting with each of the place tokens."""
    by_fts = has_place_column(db)
    db.row_factory = dict_factory
    if by_fts:
        # One FTS query for both: fts has each item's place words.
        match = '{name}: ' + name + ''.join(' AND {place}: ' + t + '*' for t in place)
        rows = list(db.execute('select rowid, * from items where rowid in (select rowid from fts where fts match ?)'
                               ' order by qrank desc limit ?', (match, limit)))
        db.row_factory = None
        return rows
    # An older DB: match the place columns themselves (slower).
    conds, args = [], []
    text = "(' ' || lower(coalesce(park, '') || ' ' || coalesce(state, '') || ' ' || coalesce(country, '')))"
    for t in place:
        c = '{} like ?'.format(text)
        args.append('% ' + t + '%')
        states = sorted(s for s, abbrs in STATE_ABBR.items() if any(a.startswith(t) for a in abbrs))
        if states:
            c = '({} or state in ({}))'.format(c, ','.join('?' * len(states)))
            args += states
        conds.append(c)
    cond = ' and '.join(conds)
    sql = ('select rowid, * from items where rowid in (select rowid from fts where name match ?)'
           ' and {} order by qrank desc limit ?'.format(cond))
    rows = list(db.execute(sql, (name, *args, limit)))
    db.row_factory = None
    return rows


# A park's name as people type it: "Killarney park" for Killarney Provincial
# Park (website#128), the kind of park left out, or shortened as the site and
# map shorten it (basemap's create-autosuggest-db.ts, slices/parks.lua):
# "Killarney PP".
PARK_KINDS = {'park': ('provincial', 'national', 'state', 'regional', 'county'),
              'forest': ('national', 'state', 'provincial')}
PARK_ABBREVIATIONS = {'np': ('national', 'park'), 'sp': ('state', 'park'),
                      'pp': ('provincial', 'park'), 'nf': ('national', 'forest')}


def park_phrases(words):
    """FTS phrases for a query naming a park without its kind, or with its
    kind shortened: "killarney park" is also "killarney provincial park",
    "killarney national park"...; "killarney pp" is "killarney provincial
    park". The last word stays a prefix ("killarney par"). None when the
    query names no park."""
    toks = tokens(words)
    variants = [[]]
    changed = False
    for i, t in enumerate(toks):
        last = i == len(toks) - 1
        if i > 0 and t in PARK_ABBREVIATIONS:
            variants = [v + list(PARK_ABBREVIATIONS[t]) for v in variants]
            changed = True
            continue
        # "park", or as it's typed ("par"), after the park's own name.
        kind = next((k for k in PARK_KINDS if t == k or (last and len(t) >= 3 and k.startswith(t))), None)
        if i > 0 and kind:
            variants = [v + extra + [t] for v in variants for extra in [[]] + [[k] for k in PARK_KINDS[kind]]]
            changed = True
            continue
        variants = [v + [t] for v in variants]
    if not changed:
        return None
    return ' OR '.join('"{}"*'.format(' '.join(v)) for v in variants[:50])


def search(q, db=None, near=None):
    """Up to 10 items matching q, best first. near, a (lat, lon), re-ranks
    them by distance from it as well as QRank."""
    db = db or con
    words = q.replace(',', ' ').replace('"', ' ').split()
    if not words:
        return []
    # The whole query as a name.
    hits = search_names(fts_query(q), db, limit=NEAR_TOP)
    if near:
        for h in search_names(fts_query(q), db, limit=NEAR_LOCAL, box=box_around(near, NEAR_BOX_KM)):
            hits.append(h)
    tier = {h['rowid']: len(words) for h in hits}
    # A park named without its kind ("killarney park"), or with it shortened
    # ("killarney pp"): as good a match as the whole query.
    parks = park_phrases(words)
    if parks:
        found = search_names(parks, db, limit=NEAR_TOP)
        if near:
            found += search_names(parks, db, limit=NEAR_LOCAL, box=box_around(near, NEAR_BOX_KM))
        for h in found:
            if h['rowid'] not in tier:
                hits.append(h)
                tier[h['rowid']] = len(words)
    # Then the first k words as a name and the rest as a place.
    for k in range(len(words) - 1, 0, -1):
        place = tokens(words[k:])
        if not place:
            continue
        for h in search_split(fts_query(' '.join(words[:k])), place, db, NEAR_TOP):
            if h['rowid'] not in tier:
                hits.append(h)
                tier[h['rowid']] = k
    best = {}
    for h in hits:
        best.setdefault(h['rowid'], h)
    score = (lambda h: near_score(h, near)) if near else (lambda h: h['qrank'] or 0)
    out = sorted(best.values(), key=lambda h: (tier[h['rowid']], score(h)), reverse=True)[:10]
    for h in out:
        del h['rowid']
    return out


def box_around(near, km):
    lat, lon = near
    dlat = km / 111.32
    dlon = km / (111.32 * max(0.01, math.cos(math.radians(lat))))
    return (lat - dlat, lat + dlat, lon - dlon, lon + dlon)


def search_names(q, db, limit=10, box=None):
    """The limit best items whose names match the FTS query q, optionally
    only those in box (min lat, max lat, min lon, max lon)."""
    db.row_factory = None
    if box:
        # Every match, not just the popular ones: near the map, the obscure
        # ones are what you're after.
        sql = ("select rowid, * from items where rowid in (select rowid from fts where name match ?)"
               " and lat between ? and ? and lon between ? and ? order by qrank desc limit ?")
        args = (q, *box, limit)
    else:
        count = db.execute("select count(*) from fts_popular where name match ?", (q,)).fetchone()[0]
        table = 'fts_popular' if count >= 100 else 'fts'
        # Ranked on items: the FTS tables keep no qrank (basemap#250).
        sql = ("select rowid, * from items where rowid in (select rowid from {} where name match ?)"
               " order by qrank desc limit ?".format(table))
        args = (q, limit)
    db.row_factory = dict_factory
    cur = db.cursor()
    cur.execute(sql, args)
    rv = [r for r in cur]
    cur.close()
    db.row_factory = None
    return rv

def near_param(params):
    """(lat, lon) from the lat and lon parameters, or None if they're
    missing or not a place on Earth."""
    try:
        lat, lon = float(params.get('lat')), float(params.get('lon'))
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or math.isnan(lat) or math.isnan(lon):
        return None
    return (lat, lon)


def lambda_handler(event, context):
    params = event.get('queryStringParameters') or {}
    q = params.get('q') or ''
    build = params.get('build') or None

    if build is not None and not NAMESPACE_RE.match(build):
        return {
            'statusCode': 400,
            'body': json.dumps({'error': 'invalid build'})
        }

    try:
        db = connection_for(build)
    except BuildNotFound:
        return {
            'statusCode': 404,
            'body': json.dumps([])
        }

    hits = search(q, db, near_param(params))
    return {
        'statusCode': 200,
        'body': json.dumps(hits)
    }

if __name__ == '__main__':
    # lambda_function.py QUERY... [@LAT,LON]
    args = sys.argv[1:]
    near = None
    if args and args[-1].startswith('@'):
        near = tuple(float(x) for x in args.pop()[1:].split(','))
    for h in search(' '.join(args), near=near):
        print(h['qrank'], '|', h['name'], '|', h['kind'], '|', h.get('park'), '|', h.get('state'))
