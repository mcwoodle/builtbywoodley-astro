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
            // The archival filename under ./images/, carrying the capture date
            // and the camera frame number. Optional: a photograph whose name is
            // already short can point src straight at ./images/ instead.
            // When present, src is the SHORT name it is staged under, and the
            // stage-photo-masters integration materialises that file before
            // this schema resolves. See src/integrations/stage-photo-masters.mjs.
            master: z.string().optional(),
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
// photo archive uses. It runs oldest first on the page, so the degree at the
// top of the list is the start of the story rather than a footnote to it.
//
// `end` omitted means the role is current; `internship` pulls an entry out of
// the main run and into the co-op terms bundled under the degree; `level` is
// the rung the role sits on, which is what the ladder down the left of the
// roles is drawn from.
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
          // How long the role actually ran, where that is not the span between
          // start and end — a co-op that came back for separate terms sits
          // between two dates it did not work all of.
          months: z.number().int().positive().optional(),
          // How its dates read, where a range between start and end would not
          // tell the truth: the separate terms, spelled out.
          dates: z.string().optional(),
          internship: z.boolean().default(false),
          // Schooling reads differently from a job: no duration bar, and it is
          // the one entry that carries an institutional mark rather than an
          // employer's.
          kind: z.enum(['role', 'education']).default('role'),
          // 0 student · 1 engineer · 2 engineer II · 3 senior · 4 principal.
          // A rise between consecutive entries is what the page calls out.
          level: z.number().int().min(0).max(4).default(1),
          // Named rather than a path: the marks are inline SVG components, so
          // their layers can be animated separately.
          mark: z.enum(['uwaterloo', 'sandvine', 'amazon']).optional(),
        }),
      )
      .default([]),
  }),
});

export const collections = { projects, mockedProjects, software, photos, work };
