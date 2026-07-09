import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

type ViewTransitionAnimationMode = 'edge' | 'none' | 'chrome';

// Browser-specific view-transition behavior:
// - edge: use the Edge body-transform fallback animation.
// - none: disable cross-document animation.
// - chrome: use the original native transitions tuned in Chrome.
export const viewTransitionAnimationByBrowser = {
  default: 'chrome',
  edge: 'edge',
  chrome: 'chrome',
} as const satisfies { default: ViewTransitionAnimationMode } & Record<
  string,
  ViewTransitionAnimationMode
>;

const projectSchema = ({ image }: { image: any }) =>
  z.object({
    title: z.string().max(100, 'Title cannot exceed 100 characters.'),
    publishDate: z.date(),
    description: z.string().optional(),
    // image() resolves local paths and passes them to Astro's image optimization
    coverImage: image(),
    // Focal point + zoom for cropping the cover in card previews (CSS object-position / scale).
    // Lets each post frame the "interesting part" of its image. Defaults keep the image centered.
    coverFocus: z.string().default('center'),
    coverZoom: z.number().min(1).default(1),
    // Enum keeps routing/filtering predictable; default avoids required field in every file
    projectType: z
      .enum(['woodworking', 'renovation', 'tech-setup', 'other'])
      .default('woodworking'),
    tags: z.array(z.string()).default([]),
    videoUrl: z.string().url().optional(),
  });

const softwareSchema = ({ image }: { image: any }) =>
  z.object({
    title: z.string().max(100, 'Title cannot exceed 100 characters.'),
    publishDate: z.date(),
    description: z.string().optional(),
    coverImage: image(),
    tags: z.array(z.string()).default([]),
    summary: z.string(),
    stack: z.array(z.string()).default([]),
    repoUrl: z.string().url().optional(),
    // liveUrl is a site-relative path (e.g. /viz/...), not an absolute URL
    liveUrl: z.string().optional(),
    // cardUrl overrides the default /software/<slug> link on the index card
    cardUrl: z.string().optional(),
    order: z.number().default(0),
  });

const projects = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/projects' }),
  schema: projectSchema,
});

const mockedProjects = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/mocked-projects' }),
  schema: projectSchema,
});

const software = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/software' }),
  schema: softwareSchema,
});

export const collections = { projects, mockedProjects, software };
