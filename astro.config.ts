import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';

import tailwindcss from '@tailwindcss/vite';

import rehypeLeadIn from './src/plugins/rehype-lead-in';

// https://astro.build/config
export default defineConfig({
  integrations: [mdx()],

  markdown: {
    // Tags each entry's opening clause for the editorial lead-in styling.
    // MDX inherits the processor's pipeline, so this covers all content.
    processor: unified({ rehypePlugins: [rehypeLeadIn] }),
  },

  vite: {
    plugins: [tailwindcss()],
  },
});