// The blog's index: app/content/blog.mdx, with every post (~/blog.server).
import { useLoaderData, type MetaFunction } from 'react-router';
import Blog from '~/content/blog.mdx';
import { posts } from '~/blog.server';

export const meta: MetaFunction = () => [
  { title: 'Development blog · Hiker Atlas' },
  { name: 'description', content: 'Notes about the development of Hiker Atlas and open-source cartography in general.' },
];

export const loader = () => ({ posts });

function Posts() {
  const { posts } = useLoaderData<typeof loader>();
  return <ul className='!m-0 !list-none !p-0 flex flex-col gap-4 pt-2'>
    {posts.map((p) => <li key={p.path}>
      <a href={p.path} className='font-semibold !text-green-800 hover:underline'>{p.title}</a>
      <span className='block text-sm text-stone-500'>{p.date}</span>
      <span className='block text-stone-700'>{p.description}</span>
    </li>)}
  </ul>;
}
const components = { Posts };

export default function BlogIndex() {
  return <Blog components={components} />;
}
