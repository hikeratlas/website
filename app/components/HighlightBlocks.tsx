// Highlights a blog post's code blocks with highlight.js, which the post loads
// as an external script (its frontmatter's handle). On a first load the
// script is in <head> already; after navigating here in the app it may still
// be loading, so this waits for it (up to 5 s).
import { useEffect } from 'react';

type Hljs = { highlightAll: () => void };

export default function HighlightBlocks() {
  useEffect(() => {
    let tries = 0;
    const t = setInterval(() => {
      const hljs = (window as unknown as { hljs?: Hljs }).hljs;
      if (hljs) { hljs.highlightAll(); clearInterval(t); }
      else if (++tries > 50) clearInterval(t);
    }, 100);
    return () => clearInterval(t);
  }, []);
  return null;
}
