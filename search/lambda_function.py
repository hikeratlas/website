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


# db -> {folded place name: (column, value)}
places_cache = {}


def places(db):
    if db not in places_cache:
        out = {}
        for col in ('country', 'state'):
            for (v,) in db.execute('select distinct {} from items where {} is not null'.format(col, col)):
                out[fold(v)] = (col, v)
        for k, v in ABBREVIATIONS.items():
            col, v = v if isinstance(v, tuple) else ('state', v)
            out.setdefault(fold(k), (col, v))
        places_cache[db] = out
    return places_cache[db]


def split_place(q, db):
    """("Bear Mountain", ('state', 'British Columbia')) for "Bear Mountain,
    British Columbia" or "Bear Mountain BC"; None if q doesn't end in a
    state, province or country. The longest match wins ("New Brunswick", not
    "Brunswick")."""
    words = q.replace(',', ' ').split()
    known = places(db)
    for n in (4, 3, 2, 1):
        if len(words) <= n:
            continue
        place = known.get(fold(' '.join(words[-n:])))
        if place:
            return ' '.join(words[:-n]), place
    return None


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


def search(q, db=None, near=None):
    """Up to 10 items matching q, best first. near, a (lat, lon), re-ranks
    them by distance from it as well as QRank."""
    db = db or con
    if near:
        hits = search_names(fts_query(q), db, limit=NEAR_TOP)
        seen = {h['rowid'] for h in hits}
        for h in search_names(fts_query(q), db, limit=NEAR_LOCAL, box=box_around(near, NEAR_BOX_KM)):
            if h['rowid'] not in seen:
                hits.append(h)
                seen.add(h['rowid'])
        hits.sort(key=lambda h: near_score(h, near), reverse=True)
        hits = hits[:10]
    else:
        hits = search_names(fts_query(q), db)
    # Too few hits: the query may end with where it is, e.g. "Bear Mountain
    # British Columbia" (website#38), which matches no names. Fill up with
    # that name in that place, after the plain matches ("Lake Ontario" is a
    # lake, not lakes in Ontario).
    if len(hits) < 10:
        split = split_place(q, db)
        if split:
            name, (col, value) = split
            seen = {h['rowid'] for h in hits}
            for h in search_names(fts_query(name), db, col, value):
                if h['rowid'] not in seen and len(hits) < 10:
                    hits.append(h)
    for h in hits:
        del h['rowid']
    return hits


def box_around(near, km):
    lat, lon = near
    dlat = km / 111.32
    dlon = km / (111.32 * max(0.01, math.cos(math.radians(lat))))
    return (lat - dlat, lat + dlat, lon - dlon, lon + dlon)


def search_names(q, db, col=None, value=None, limit=10, box=None):
    """The limit best items whose names match the FTS query q, optionally
    only those with col (state or country) = value, or in box (min lat, max
    lat, min lon, max lon)."""
    db.row_factory = None
    if box:
        # Every match, not just the popular ones: near the map, the obscure
        # ones are what you're after.
        sql = ("select rowid, * from items where rowid in (select rowid from fts where name match ?)"
               " and lat between ? and ? and lon between ? and ? order by qrank desc limit ?")
        args = (q, *box, limit)
    elif col:
        # Every match, not just the popular ones: filtering by place is for
        # finding the obscure Bear Mountain.
        sql = ("select rowid, * from items where rowid in (select rowid from fts where name match ?)"
               " and {} = ? order by qrank desc limit ?".format(col))
        args = (q, value, limit)
    else:
        count = db.execute("select count(*) from fts_popular where name match ?", (q,)).fetchone()[0]
        table = 'fts_popular' if count >= 100 else 'fts'
        sql = ("select rowid, * from items where rowid in (select rowid from {} where name match ?"
               " order by qrank desc limit ?) order by qrank desc limit ?".format(table))
        args = (q, limit, limit)
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
