# Hiker Atlas website

[React Router](https://reactrouter.com/) (framework mode, with Vite), served by
Cloudflare Pages.

## Layout

- `app/`: the site. `app/routes/` are its pages, named as files (`hikes.$.tsx`
  is `/hikes/*`); the homepage and blog posts are MDX, a post's frontmatter
  `meta` and `headers` becoming its route's (see `mdx-route-exports.ts`).
- `static/`: files served as they are (favicons, images, Pages' `_headers` and
  `_routes.json`).
- `functions/[[path]].ts`: the Pages Function serving every other request from
  the server build.

## Development

```sh
# the Vite dev server (in Node; the site uses no Cloudflare bindings)
npm run dev
```

To try the built site as Pages serves it:

```sh
npm run build
npm start  # wrangler pages dev ./public, on http://127.0.0.1:8788
```

## Deployment

Cloudflare Pages builds each push from Git: the "Build command" is
`npm run build` and the "Build output directory" is `public`. `npm run build`
builds into `build/` (`build/client` and `build/server`) and copies the client
half to `public/`; Pages bundles `functions/` with the server half.
