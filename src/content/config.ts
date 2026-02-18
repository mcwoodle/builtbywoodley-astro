import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

const projects = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/projects' }),

  // Strict frontmatter schema: keeps content consistent and enables typed access
  schema: ({ image }) =>
    z.object({
      title: z.string().max(100, 'Title cannot exceed 100 characters.'),
      publishDate: z.date(),
      description: z.string().optional(),
      // image() resolves local paths and passes them to Astro's image optimization
      coverImage: image(),
      // Enum keeps routing/filtering predictable; default avoids required field in every file
      projectType: z
        .enum(['woodworking', 'renovation', 'tech-setup', 'other'])
        .default('woodworking'),
      tags: z.array(z.string()).default([]),
      videoUrl: z.string().url().optional(),
    }),
});

export const collections = { projects };

