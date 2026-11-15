// The blog's posts (app/routes/blog.*.mdx), newest first, from their
// frontmatter: for the homepage's latest post and /blog's list. Server-only,
// so the posts themselves stay out of the pages' browser bundles.
type Meta = Record<string, unknown>;
const files = import.meta.glob<{ meta?: Meta[] } | undefined>('./routes/blog.*.mdx', { import: 'frontmatter', eager: true });

export type Post = { path: string; title: string; date: string; description: string };

// A post's day where it was written (its dates are -0500): YAML reads
// "2024-01-18 23:00:00 -0500" as an instant, the 19th in UTC.
const day = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' });
const ymd = (d: unknown) => d instanceof Date ? day.format(d) : String(d ?? '').slice(0, 10);

export const posts: Post[] = Object.entries(files).map(([file, fm]) => {
  const meta = fm?.meta ?? [];
  const value = (k: string) => meta.find((m) => k in m)?.[k];
  return {
    path: `/blog/${file.replace(/^.*\/blog\.|\.mdx$/g, '')}`,
    title: String(value('title') ?? ''),
    date: ymd(value('date')),
    description: String(meta.find((m) => m.name === 'description')?.content ?? ''),
  };
}).sort((a, b) => b.date.localeCompare(a.date) || a.title.localeCompare(b.title));
