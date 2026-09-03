// The photograph archive, shaped for the viewer panel.
//
// Two pages open the same panel over the same set — the archive itself and the
// strip on the home page — so the sort, the anchors and the sources are built
// here rather than in either page. The anchors in particular have to agree:
// they are what a shared link points at, and deriving them twice is how they
// quietly stop matching.

import { getImage } from "astro:assets";
import type { CollectionEntry } from "astro:content";
import { ladderAttrs } from "../config/image-ladders.mjs";

export type Photo = CollectionEntry<"photos">["data"]["photos"][number];

export type ViewerFrame = {
  anchor: string;
  alt: string;
  title: string;
  note: string;
  stamp: string;
  datetime: string;
  place: string;
  src: string;
  srcset: string;
  sizes: string;
  /**
   * The master at its own size, for the magnified view. This is the
   * full-resolution original Astro emits for every image() field and then
   * references from nowhere — see docs/photography-image-delivery.md. It is
   * already deployed whether or not anything points at it, so using it here
   * costs no bytes at all and turns dead weight into the one thing it is
   * actually good for.
   */
  full: string;
  /** Intrinsic size, so the panel reserves the frame's shape before it loads. */
  width: number;
  height: number;
};

/** Newest first. Every surface that shows the archive shows it in this order. */
export const sortPhotos = (photos: Photo[]) =>
  [...photos].sort((a, b) => b.date.getTime() - a.date.getTime());

const slugify = (value: string) =>
  value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Anchors are titles, so a shared link says what it points at. The counter only
 * kicks in if two frames ever end up with the same title.
 */
export function withAnchors(photos: Photo[]) {
  const taken = new Map<string, number>();
  return photos.map((photo) => {
    const base = slugify(photo.title) || "frame";
    const seen = (taken.get(base) ?? 0) + 1;
    taken.set(base, seen);
    return { photo, anchor: seen === 1 ? base : `${base}-${seen}` };
  });
}

// UTC accessors: z.coerce.date() parses "2015-09-21" as UTC midnight, so local
// getters would shift the date back a day for anyone west of Greenwich.
const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export const stampFor = (date: Date) =>
  `${String(date.getUTCDate()).padStart(2, "0")} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;

/** The panel shows the uncropped photograph, so it gets its own larger set. */
export const VIEWER_SIZES = "(max-width: 900px) 94vw, min(1180px, 86vw)";

/**
 * Built as data rather than markup, so only the frame someone actually opens is
 * ever downloaded.
 */
export async function buildViewerFrames(
  entries: { photo: Photo; anchor: string }[],
): Promise<ViewerFrame[]> {
  return Promise.all(
    entries.map(async ({ photo, anchor }) => {
      const large = await getImage({
        src: photo.src,
        sizes: VIEWER_SIZES,
        // Spread last: the ladder owns widths, the fallback width, quality and
        // format, and nothing above may quietly override them.
        ...ladderAttrs("viewer"),
      });
      return {
        anchor,
        alt: photo.alt,
        title: photo.title,
        note: photo.note ?? "",
        stamp: stampFor(photo.date),
        datetime: photo.date.toISOString().slice(0, 10),
        place: photo.location,
        src: large.src,
        srcset: large.srcSet.attribute,
        sizes: VIEWER_SIZES,
        full: photo.src.src,
        width: photo.src.width,
        height: photo.src.height,
      };
    }),
  );
}
