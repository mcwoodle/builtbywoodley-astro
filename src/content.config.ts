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

// Photography is a single manifest entry holding the whole archive, rather than
// one file per photo. image() resolves each src relative to this file, so the
// photos live in ./photos/images/ beside the manifest.
const photos = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/photos' }),
  // Declared inline (not as an extracted factory) so `image` keeps its real
  // type instead of being widened to `any`.
  schema: ({ image }) =>
    z.object({
      photos: z
        .array(
          z.object({
            src: image(),
            title: z.string().max(100, 'Title cannot exceed 100 characters.'),
            alt: z.string(),
            date: z.coerce.date(),
            location: z.string(),
            // Short editorial line shown in the caption. Not EXIF.
            note: z.string().optional(),
          }),
        )
        .min(1),
    }),
});

// Work history is a single manifest holding the whole list, the same shape the
// photo archive uses. `end` omitted means the role is current; `internship`
// pulls an entry out of the main list and into the bundled row beneath it.
const work = defineCollection({
  loader: glob({ pattern: '**/*.mdx', base: './src/content/work' }),
  schema: z.object({
    roles: z
      .array(
        z.object({
          title: z.string(),
          company: z.string(),
          location: z.string().optional(),
          // YYYY or YYYY-MM, so entries sort as plain strings.
          start: z.string().regex(/^\d{4}(-\d{2})?$/, 'Use YYYY or YYYY-MM.'),
          end: z.string().regex(/^\d{4}(-\d{2})?$/, 'Use YYYY or YYYY-MM.').optional(),
          note: z.string().optional(),
          internship: z.boolean().default(false),
        }),
      )
      .default([]),
  }),
});

export const collections = { projects, mockedProjects, software, photos, work };
