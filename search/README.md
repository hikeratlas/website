# search

For reasons, search is hosted on AWS Lambda as a function URL.

We use Python as it has built-in sqlite3 bindings, so we can just ship
a vanilla .py file and the autosuggest DB.

Run `./publish` to release an updated version.

`test_search.py DB` runs known searches against a search DB, e.g.
north-america's (https://public.hikeratlas.com/north-america.autosuggest.db),
and fails if one finds something else first: CI runs it on changes here
(`.github/workflows/search.yml`), and basemap's `deploy-search.yml` runs it
before deploying. Add a case when you fix a search.
