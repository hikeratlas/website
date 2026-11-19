// The frame of the blog's pages (/blog and /blog/<post>). Around a post,
// links back to the blog and to the posts before and after it by date, at
// the top and the bottom, from every post's frontmatter (~/blog.server):
// a new post gets them, and its neighbours link to it, with nothing to edit.
import { Outlet, useLoaderData, useLocation } from 'react-router';
import { posts } from '~/blog.server';

export const loader = () => ({ posts: posts.map(({ path, title }) => ({ path, title })) });

type Link = { path: string; title: string };

// posts is newest first: the older post is the next one in it.
function neighbours(list: Link[], path: string): { older: Link | null; newer: Link | null } | null {
  const i = list.findIndex((p) => p.path === path);
  if (i < 0) return null;
  return { older: list[i + 1] ?? null, newer: list[i - 1] ?? null };
}

function PostNav({ older, newer, where }: { older: Link | null; newer: Link | null; where: 'top' | 'bottom' }) {
  const link = '!text-green-800 hover:underline';
  const label = 'block text-xs uppercase tracking-wide text-stone-500';
  return <nav aria-label={where === 'top' ? 'Blog' : 'More posts'}
    className={`frame flex flex-col gap-3 text-sm ${where === 'top' ? '!pb-0' : '!pt-0'}`}>
    <a href='/blog' className={`${link} self-start`}>← Development blog</a>
    {(older || newer) && <div className='flex justify-between gap-6'>
      {older ? <a href={older.path} rel='prev' className={`${link} max-w-[45%]`}><span className={label}>← Older</span>{older.title}</a> : <span />}
      {newer ? <a href={newer.path} rel='next' className={`${link} max-w-[45%] text-right`}><span className={label}>Newer →</span>{newer.title}</a> : <span />}
    </div>}
  </nav>;
}

export default function BlogFrame() {
  const { posts } = useLoaderData<typeof loader>();
  const at = neighbours(posts, useLocation().pathname.replace(/\/$/, ''));
  if (!at) return <Outlet />;
  return <>
    <PostNav {...at} where='top' />
    <Outlet />
    <PostNav {...at} where='bottom' />
  </>;
}
