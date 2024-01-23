import json
import sqlite3
import sys

con = sqlite3.connect('autosuggest.db')

def dict_factory(cursor, row):
    d = {}
    for idx, col in enumerate(cursor.description):
        d[col[0]] = row[idx]
    return d

def search(q):
    q = '"{}"*'.format(' '.join(q.strip().split()))
    con.row_factory = sqlite3.Row
    cur = con.cursor()
    cur.execute("select count(*) from fts_popular where name match ?", (q,))
    count = cur.fetchone()[0]
    cur.close()

    table = 'fts_popular'
    if count < 100:
        table = 'fts'

    con.row_factory = dict_factory
    cur = con.cursor()
    cur.execute("select * from items where rowid in (select rowid from {} where name match ? order by qrank desc limit 10) order by qrank desc limit 10".format(table), (q,))

    rv = [r for r in cur]
    cur.close()
    return rv

def lambda_handler(event, context):
    q = event['queryStringParameters']['q'] or ''

    hits = search(q)
    return {
        'statusCode': 200,
        'body': json.dumps(hits)
    }

if __name__ == '__main__':
    print(search(' '.join(sys.argv[1:])))
