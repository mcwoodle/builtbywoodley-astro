import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';

import tailwindcss from '@tailwindcss/vite';

import rehypeLeadIn from './src/plugins/rehype-lead-in';

// https://astro.build/config
export default defineConfig({
  integrations: [mdx()],

  // /about was folded into the landing page. Anything still pointing at the
  // old route lands on the chapter it became.
  redirects: {
    '/about': '/#about',
  },

  markdown: {
    // Tags each entry's opening clause for the editorial lead-in styling.
    // MDX inherits the processor's pipeline, so this covers all content.
    processor: unified({ rehypePlugins: [rehypeLeadIn] }),
  },

  vite: {
    plugins: [tailwindcss()],
    server: {
      allowedHosts: [
        'local.builtbywoodley.ca',
        'dev.astro.woodleywoodworks.ca',
      ],
    },
  },
});
