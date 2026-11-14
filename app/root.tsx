import type { LinksFunction } from "react-router";
import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useMatches,
  useRouteError,
} from "react-router";
import type { ReactNode } from "react";
// see https://github.com/sergiodxa/remix-utils#externalscripts
import { ExternalScripts } from "remix-utils/external-scripts";
import stylesheet from "~/tailwind.css?url";
import { SiteFrame } from "~/components/Site";

export const links: LinksFunction = () => [
  { rel: "stylesheet", href: stylesheet },
  // Hubot Sans, for the park and hike sheets' headings (font-display).
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
  { rel: "stylesheet", href: "https://fonts.googleapis.com/css2?family=Hubot+Sans:wght@600;700;800&display=swap" },
  // Lucide's "mountain" icon on a green tile (see public/favicon.svg); the
  // .ico is for browsers without SVG favicons.
  { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
  { rel: "icon", href: "/favicon.ico", sizes: "32x32" },
  { rel: "apple-touch-icon", href: "/apple-touch-icon.png" },
  // Names the Android app, so a hike page can tell it's installed (AppLink).
  { rel: "manifest", href: "/manifest.webmanifest" },
];

export function Layout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <Meta />
        <Links />
        <ExternalScripts />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

// Every page in the site's frame (header, footer: ~/components/Site), but the
// map pages, whose handle says fullscreen.
export default function App() {
  const fullscreen = useMatches().some((m) => (m.handle as { fullscreen?: boolean } | undefined)?.fullscreen);
  return fullscreen ? <Outlet /> : <SiteFrame><Outlet /></SiteFrame>;
}

// A page that isn't there, or broke: in the frame, with a way on.
export function ErrorBoundary() {
  const error = useRouteError();
  const missing = isRouteErrorResponse(error) && error.status === 404;
  return <SiteFrame>
    <div className="frame">
      <h1>{missing ? "Page not found" : "Something went wrong"}</h1>
      <p>{missing ? "There's nothing here." : "This page didn't load."} Try the <a href="/map">map</a> or the <a href="/">homepage</a>.</p>
    </div>
  </SiteFrame>;
}
