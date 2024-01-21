# search

For reasons, search is hosted on AWS Lambda as a function URL.

We use Python as it has built-in sqlite3 bindings, so we can just ship
a vanilla .py file and the autosuggest DB.

Run `./publish` to release an updated version.
