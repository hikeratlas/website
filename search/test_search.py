#!/usr/bin/env python3
# test_search.py DB
#
# Searches people make, and what they should find, against a search DB (a
# build's <namespace>.autosuggest.db): python3 search/test_search.py DB.
# Exits 1 if any fails. Run on website PRs that change search/
# (.github/workflows/search.yml, against north-america's DB) and before
# basemap's deploy-search.yml deploys a DB or this code.
#
# Each case is a query (and, for searches near the map, its centre) with
# what must come first, what must be among the first few, or what must not
# come first. They follow real results, so a change in OpenStreetMap can
# move one: update the case if the new result is right.
import os
import sqlite3
import sys
import tempfile

# (query, near or None, checks): checks are
#   first: (name, park or state) the first result's name, and that the first
#          result's park or state contains it (None: any);
#   top: (n, name) a result named name among the first n;
#   not_first: name the first result mustn't be named.
CASES = [
    # A park named without its kind, or with it shortened (website#128).
    ('killarney park', None, {'first': ('Killarney Provincial Park', 'Ontario')}),
    ('killarney pp', None, {'first': ('Killarney Provincial Park', 'Ontario')}),
    ('killarney par', None, {'first': ('Killarney Provincial Park', 'Ontario')}),
    ('banff park', None, {'first': ('Banff National Park', 'Alberta')}),
    ('banff np', None, {'first': ('Banff National Park', 'Alberta')}),
    ('algonquin park', None, {'first': ('Algonquin Provincial Park', 'Ontario')}),
    ('yosemite park', None, {'first': ('Yosemite National Park', 'California')}),
    ('garibaldi park', None, {'first': ('Garibaldi Provincial Park', 'British Columbia')}),
    ('white mountain nf', None, {'first': ('White Mountain National Forest', 'New Hampshire')}),
    ('white mountain forest', None, {'first': ('White Mountain National Forest', 'New Hampshire')}),
    # ...without matching words in any order: an early try at the above put
    # George Washington's Mount Vernon first.
    ('mount washington', None, {'first': ('Mount Washington', 'New Hampshire'),
                                'not_first': "George Washington's Mount Vernon"}),
    ('the crack', None, {'first': ('The "Crack" Trail', 'Killarney')}),
    # Names people search for.
    ('yosemite', None, {'first': ('Yosemite National Park', 'California')}),
    ('half dome', None, {'first': ('Half Dome', 'Yosemite')}),
    ('angels landing', None, {'first': ('Angels Landing', 'Zion')}),
    ('lake louise', None, {'first': ('Lake Louise', 'Banff')}),
    ('moraine lake', None, {'first': ('Moraine Lake', 'Banff')}),
    ('lake agnes', None, {'top': (3, 'Lake Agnes')}),
    ('grouse grind', None, {'first': ('Grouse Grind', 'Grouse Mountain')}),
    ('west coast trail', None, {'first': ('West Coast Trail', 'Pacific Rim')}),
    ('stanley park', None, {'first': ('Stanley Park', 'British Columbia')}),
    ('killarney', None, {'top': (3, 'Killarney Provincial Park')}),
    # The lake before lakes in Ontario: a name naming more of the query first.
    ('lake ontario', None, {'first': ('Lake Ontario', 'Ontario')}),
    # Narrowing by place (basemap#250): name, then park, state or province.
    ('granite ridge trail kil', None, {'first': ('Granite Ridge Trail', 'Killarney')}),
    ('dawson creek b', None, {'first': ('Dawson Creek', 'British Columbia')}),
    ('panorama ridge gar', None, {'first': (None, 'Garibaldi')}),
    ('bear mountain bc', None, {'first': ('Bear Mountain', 'British Columbia')}),
    # Near the map (website#44): the same name, the nearer one first.
    ('panorama ridge', (49.95, -123.05), {'first': (None, 'Garibaldi')}),
    ('panorama ridge', (51.2, -116.1), {'first': (None, 'Banff')}),
    ('skyline trail', (46.74, -60.83), {'first': ('Skyline Trail', 'Cape Breton')}),
]


def check(search, db, q, near, want):
    hits = search(q, db, near)
    names = [h['name'] for h in hits]
    got = '; '.join('{} ({})'.format(h['name'], h.get('park') or h.get('state')) for h in hits[:3]) or 'nothing'
    problems = []
    if 'first' in want:
        name, where = want['first']
        h = hits[0] if hits else None
        if not h or (name and h['name'] != name) or (where and where not in '{} {}'.format(h.get('park') or '', h.get('state') or '')):
            problems.append('first should be {} in {}'.format(name or 'something', where or 'anywhere'))
    if 'top' in want:
        n, name = want['top']
        if name not in names[:n]:
            problems.append('{} should be in the first {}'.format(name, n))
    if 'not_first' in want and names and names[0] == want['not_first']:
        problems.append('{} shouldn\'t be first'.format(want['not_first']))
    return problems, got


def main(db_path):
    db_path = os.path.abspath(db_path)
    # lambda_function opens ./autosuggest.db when imported (the Lambda's own):
    # import it somewhere that's harmless.
    here = os.path.dirname(os.path.abspath(__file__))
    sys.path.insert(0, here)
    cwd = os.getcwd()
    with tempfile.TemporaryDirectory() as tmp:
        os.chdir(tmp)
        try:
            import lambda_function
        finally:
            os.chdir(cwd)
    db = sqlite3.connect('file:{}?mode=ro'.format(db_path), uri=True)
    failed = 0
    for q, near, want in CASES:
        problems, got = check(lambda_function.search, db, q, near, want)
        label = q + (' @{},{}'.format(*near) if near else '')
        if problems:
            failed += 1
            print('FAIL {}: {}; got {}'.format(label, ', '.join(problems), got))
        else:
            print('ok   {}'.format(label))
    print('{} of {} searches as expected'.format(len(CASES) - failed, len(CASES)))
    return 1 if failed else 0


if __name__ == '__main__':
    if len(sys.argv) != 2:
        sys.exit('usage: test_search.py DB')
    sys.exit(main(sys.argv[1]))
