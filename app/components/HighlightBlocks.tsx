import React from 'react';

export default function HighlightBlocks() {
  return <div dangerouslySetInnerHTML={{__html: `
    <script>
hljs.highlightAll();
</script>`}}/>
}
