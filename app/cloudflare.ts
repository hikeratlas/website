// The Pages Functions environment, for loaders and actions:
// context.get(envContext). Set by functions/[[path]].ts, which reaches this
// module through the server build (entry.server.tsx re-exports it), so both
// use the same context object.
import { createContext } from 'react-router';

export interface Env {
  // The curation database (curation/migrations/; routes#252).
  CURATION?: D1Database;
  // Curators' keys, a secret: "name:key" pairs, comma-separated.
  CURATOR_KEYS?: string;
  // Curators (names in CURATOR_KEYS), comma-separated, who may also run raw
  // SQL on the curation database (routes/api.curation.sql.ts). Not secret.
  CURATION_ADMINS?: string;
}

export const envContext = createContext<Env>({});
