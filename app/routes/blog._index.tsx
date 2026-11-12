import { redirect } from "react-router";

// The blog index now lives on the homepage. Keep old /blog links working.
export const loader = () => redirect("/", 301);
