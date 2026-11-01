import json
import os
import re
import shutil
import sqlite3
import sys
import time
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

def search(q, db=None):
    db = db or con
    q = '"{}"*'.format(' '.join(q.strip().split()))
    db.row_factory = sqlite3.Row
    cur = db.cursor()
    cur.execute("select count(*) from fts_popular where name match ?", (q,))
    count = cur.fetchone()[0]
    cur.close()

    table = 'fts_popular'
    if count < 100:
        table = 'fts'

    db.row_factory = dict_factory
    cur = db.cursor()
    cur.execute("select * from items where rowid in (select rowid from {} where name match ? order by qrank desc limit 10) order by qrank desc limit 10".format(table), (q,))

    rv = [r for r in cur]
    cur.close()
    return rv

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

    hits = search(q, db)
    return {
        'statusCode': 200,
        'body': json.dumps(hits)
    }

if __name__ == '__main__':
    print(search(' '.join(sys.argv[1:])))
