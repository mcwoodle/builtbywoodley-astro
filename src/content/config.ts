import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const projects = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/projects' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().max(100, 'Title cannot exceed 100 characters.'),
      publishDate: z.date(),
      description: z.string().optional(),
      coverImage: image(),
      projectType: z
        .enum(['woodworking', 'renovation', 'tech-setup', 'other'])
        .default('woodworking'),
      tags: z.array(z.string()).default([]),
      videoUrl: z.string().url().optional(),
    }),
});

export const collections = { projects };

