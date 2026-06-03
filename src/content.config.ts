import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

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

const projects = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/projects' }),
  schema: projectSchema,
});

const mockedProjects = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/mocked-projects' }),
  schema: projectSchema,
});

export const collections = { projects, mockedProjects };
