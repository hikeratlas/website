import json
import sqlite3
import sys

con = sqlite3.connect('autosuggest.db')

def dict_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d
# Don't use sqlite3.Row -- it has poor discoverability when printing rows.
#con.row_factory = sqlite3.Row
con.row_factory = dict_factory

def search(q):
    q = ' '.join(q.strip().split()) + '*'
    cur = con.cursor()
    cur.execute("select * from items where rowid in (select rowid from fts where name match ? and qrank > 10  order by qrank desc limit 10) order by qrank desc limit 10", (q,))

    return [r for r in cur]

def lambda_handler(event, context):
    q = event['queryStringParameters']['q'] or ''

    hits = search(q)
    return {
        'statusCode': 200,
        'body': json.dumps(hits)
    }

if __name__ == '__main__':
    print(search(' '.join(sys.argv[1:])))
