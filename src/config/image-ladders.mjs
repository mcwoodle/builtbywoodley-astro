// Every responsive width ladder the site renders, in one place.
//
// Plain .mjs rather than .ts on purpose: this file is imported BOTH by the
// Astro components that render the images and by the Node scripts that measure
// them. An earlier version kept the data in a .ts file and had the measuring
// script grep it as text; that broke the first time a literal quality became a
// named constant, which is exactly the kind of silent drift this config exists
// to prevent. One file, one parser, no second source of truth. JSDoc carries
// the types, so call sites still get completion and `astro check` still checks.
//
// A "ladder" is the set of widths Astro renders a photograph at for one call
// site, plus the encoding settings that go with them. Change a ladder here and
// the call site follows on the next build.
//
// What is deliberately NOT here: the `sizes` attribute. `sizes` is a restatement
// of a component's CSS breakpoints, so it belongs beside the CSS it mirrors
// rather than in a config file two directories away. Centralising it would not
// remove the coupling, only split it across two files where a breakpoint change
// is easier to miss. Each call site passes its own `sizes` and the comment there
// names the rules in global.css it tracks.
//
// The one thing that must never drift is the `src` fallback width, so it is not
// written down at all — `ladderAttrs()` derives it as the top rung. Without an
// explicit `width`, Astro points `src` at a *full-resolution* render of the
// master: 1.4 MB for the 24 MP showcase frame, downloaded by any client that
// ignores `srcset`. That bug is now unreachable by construction.

/**
 * @typedef {object} Ladder
 * @property {string} id       Stable identifier; the delivery report groups by it.
 * @property {string} label    Human label for reports.
 * @property {number[]} widths Rendered widths, ascending. The largest is the `src` fallback.
 * @property {number} quality  WebP quality, 1-100.
 * @property {'webp'} format
 */

// One quality for every ladder, and that is a deliberate saving rather than a
// missing knob. The ladders overlap — 960px is in three of them, 720px in two —
// and Astro keys its render cache on (source, width, format, quality), so
// identical widths at the same quality collapse into ONE file that every call
// site shares. Giving each ladder its own quality split those back apart: it
// cost 7 extra files and about 1.0 MB per build, measured, for a difference no
// one can see. The field is per-ladder, so vary it when something is worth that.
const QUALITY = 82;

/** @type {Record<string, Ladder>} */
export const imageLadders = {
  /**
   * Home showcase — the full-bleed hero photograph. Eager and
   * `fetchpriority="high"`, so this is the one image on the site on the critical
   * path, and the only ladder that reaches 2560px.
   * `sizes="100vw"` at the call site: the frame is full-bleed by design.
   */
  showcase: {
    id: 'showcase',
    label: 'Home showcase (hero)',
    widths: [960, 1440, 1920, 2560],
    quality: QUALITY,
    format: 'webp',
  },

  /**
   * Home gallery strip — the horizontal scroller near the foot of the landing
   * page. Lazy, well below the fold, and never shown large.
   */
  galleryStrip: {
    id: 'gallery-strip',
    label: 'Home gallery strip',
    widths: [420, 720],
    quality: QUALITY,
    format: 'webp',
  },

  /**
   * Photography grid tile. The first row renders eagerly, the rest lazily.
   * Small on screen, and every tile is a link to the viewer, which is where the
   * photograph is actually looked at.
   */
  photoTile: {
    id: 'photo-tile',
    label: 'Photography grid tile',
    widths: [360, 480, 720, 960],
    quality: QUALITY,
    format: 'webp',
  },

  /**
   * The lightbox viewer — the uncropped photograph, and the only place someone
   * is really studying the frame. Built server-side with `getImage()` and
   * shipped as a JSON island, so only the frame actually opened is downloaded.
   */
  viewer: {
    id: 'viewer',
    label: 'Photography viewer (lightbox)',
    widths: [640, 960, 1280, 1600, 1840],
    quality: QUALITY,
    format: 'webp',
  },
};

/**
 * The props `<Image>` and `getImage()` need for a ladder.
 *
 * `width` is derived rather than declared — see the note at the top of the file.
 * `sizes` is not returned; pass it at the call site.
 *
 * Spread this LAST, so the values the ladder owns cannot be silently overridden
 * by a stray `width` or `quality` earlier in the prop list:
 *
 *   <Image src={photo.src} alt="" sizes="…" {...ladderAttrs('photoTile')} />
 *
 * @param {keyof typeof imageLadders | string} key
 */
export function ladderAttrs(key) {
  const ladder = imageLadders[key];
  if (!ladder) {
    throw new Error(
      `image-ladders: no ladder named "${key}". Known: ${Object.keys(imageLadders).join(', ')}.`,
    );
  }
  return {
    widths: [...ladder.widths],
    // The top rung, always. This is the line that stops a high-resolution
    // master from shipping a multi-megabyte `src` fallback.
    width: Math.max(...ladder.widths),
    quality: ladder.quality,
    format: ladder.format,
  };
}

// Invariants a type cannot enforce. These run once per build (this module never
// reaches the browser), so a bad edit fails the build with the reason rather
// than quietly producing a wrong ladder.
for (const [key, ladder] of Object.entries(imageLadders)) {
  if (ladder.widths.length === 0) {
    throw new Error(`image-ladders: "${key}" has no widths.`);
  }
  const ascending = [...ladder.widths].sort((a, b) => a - b);
  if (ascending.join(',') !== ladder.widths.join(',')) {
    throw new Error(
      `image-ladders: "${key}" widths must be ascending (got [${ladder.widths}]).`,
    );
  }
  if (new Set(ladder.widths).size !== ladder.widths.length) {
    throw new Error(`image-ladders: "${key}" has duplicate widths.`);
  }
  for (const width of ladder.widths) {
    if (!Number.isInteger(width) || width <= 0) {
      throw new Error(`image-ladders: "${key}" width ${width} is not a positive integer.`);
    }
  }
  if (!Number.isInteger(ladder.quality) || ladder.quality < 1 || ladder.quality > 100) {
    throw new Error(`image-ladders: "${key}" quality ${ladder.quality} is outside 1-100.`);
  }
  if (ladder.format !== 'webp') {
    throw new Error(`image-ladders: "${key}" format must be webp.`);
  }
}
