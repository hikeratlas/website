import type { Config } from 'tailwindcss'

export default {
  content: ['app/**/*.tsx', 'app/**/*.mdx'],
  theme: {
    extend: {
      // Headings in the park and hike sheets (website#95's redesign).
      fontFamily: { display: ['"Hubot Sans"', 'system-ui', 'sans-serif'] },
    },
  },
  plugins: [],
} satisfies Config

