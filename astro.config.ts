import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import { unified } from '@astrojs/markdown-remark';

import tailwindcss from '@tailwindcss/vite';

import rehypeLeadIn from './src/plugins/rehype-lead-in';
import stagePhotoMasters from './src/integrations/stage-photo-masters.mjs';

// https://astro.build/config
export default defineConfig({
  // stagePhotoMasters gives each photograph a short deployed filename while the
  // repository keeps the archival one. It has to run before the content
  // collection is read, which astro:config:setup guarantees.
  integrations: [mdx(), stagePhotoMasters()],

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
