import { redirect } from "@remix-run/cloudflare";

// The blog index now lives on the homepage. Keep old /blog links working.
export const loader = () => redirect("/", 301);
