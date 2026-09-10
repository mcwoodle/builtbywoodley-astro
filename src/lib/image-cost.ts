// What the images on this page actually cost this browser, on this screen.
//
// Extracted from src/scripts/image-perf.ts so the on-device probe (?stats=true)
// and the field measurement (the image_cost event) answer the question with the
// same arithmetic. Three numbers claiming to be "what the images cost" — the
// probe's, the analytics event's, and what scripts/measure-image-delivery.mjs
// models from dist/ — have to agree, and the only way to guarantee that is for
// two of them to share this file.
//
// What stays in image-perf.ts: the HUD, its styles, the console tables and the
// LCP observer. This module has no DOM of its own and no side effects on
// import, which is what keeps the probe's chunk split intact —
// scripts/check-asset-sizes.mjs asserts that split on every build, because
// inlining the probe would put roughly 4 KB of debugging on all 36 pages.
//
// The analytics module must import THIS file and never image-perf.ts.

export type Shot = {
  /** The srcset widths this <img> offered, as they were written. */
  ladder: string;
  /** Basename only. No path, no query, and never a full URL. */
  chosen: string;
  /** The width descriptor of the rung the browser picked. */
  rung: number;
  intrinsic: number;
  layout: number;
  dpr: number;
  /** Decoded body size — survives a cache hit, unlike transferSize. */
  bytes: number;
  transferred: number;
  cached: boolean;
  ms: number | null;
  lazy: boolean;
};

/**
 * Resource timing for images, keyed by absolute URL.
 *
 * Buffered, so entries that landed before this ran are still here — which
 * matters on a hard load, where most images resolve before any of our code
 * gets a turn.
 */
export function observeImageTimings(): Map<string, PerformanceResourceTiming> {
  const timings = new Map<string, PerformanceResourceTiming>();
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        const resource = entry as PerformanceResourceTiming;
        if (
          resource.initiatorType === 'img' ||
          /\.(webp|avif|jpe?g|png|gif)(\?|$)/i.test(resource.name)
        ) {
          timings.set(resource.name, resource);
        }
      }
    }).observe({ type: 'resource', buffered: true });
  } catch {
    // An unsupported entry type leaves the map empty; every caller already
    // treats a missing timing as "unknown" rather than as zero.
  }
  return timings;
}

/** Which ladder an <img> came from, read off its srcset rather than guessed. */
function ladderOf(image: HTMLImageElement): string {
  const widths =
    (image.getAttribute('srcset') ?? '').match(/(\d+)w/g)?.map((entry) => parseInt(entry, 10)) ??
    [];
  if (widths.length === 0) return 'no srcset';
  return widths.join(',');
}

function rungOf(image: HTMLImageElement): number {
  const current = image.currentSrc || image.src;
  const srcset = image.getAttribute('srcset') ?? '';
  const file = current.slice(current.lastIndexOf('/') + 1);
  const match = new RegExp(`${file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s+(\\d+)w`).exec(
    srcset,
  );
  return match ? Number(match[1]) : image.naturalWidth;
}

/** Every resolved <img> on the page, with what it cost. */
export function collectShots(timings: Map<string, PerformanceResourceTiming>): Shot[] {
  const shots: Shot[] = [];
  for (const image of Array.from(document.images)) {
    if (!image.currentSrc) continue;
    const timing = timings.get(image.currentSrc);
    // transferSize is 0 on a memory or disk cache hit, and encodedBodySize
    // survives it — so a 0 here means "already cached", not "free".
    const transferred = timing?.transferSize ?? 0;
    const encoded = timing?.encodedBodySize ?? 0;
    shots.push({
      ladder: ladderOf(image),
      chosen: image.currentSrc.slice(image.currentSrc.lastIndexOf('/') + 1),
      rung: rungOf(image),
      intrinsic: image.naturalWidth,
      layout: Math.round(image.getBoundingClientRect().width),
      dpr: window.devicePixelRatio,
      bytes: encoded,
      transferred,
      cached: encoded > 0 && transferred === 0,
      ms: timing ? Math.round(timing.duration) : null,
      lazy: image.loading === 'lazy',
    });
  }
  return shots;
}

/**
 * Run `report` once the page's images have actually landed.
 *
 * Both callers wait the same way on purpose. The probe and the image_cost event
 * are supposed to agree on the same page and device, and they cannot do that if
 * one of them reads `document.images` while three of them are still in flight.
 * The trailing tick lets the last resource-timing entry get filed before the
 * map is read.
 */
export function whenImagesSettle(report: () => void): void {
  const pending = Array.from(document.images).filter((image) => !image.complete);
  if (pending.length === 0) {
    setTimeout(report, 60);
    return;
  }
  let left = pending.length;
  for (const image of pending) {
    const done = () => {
      left -= 1;
      if (left === 0) setTimeout(report, 60);
    };
    image.addEventListener('load', done, { once: true });
    image.addEventListener('error', done, { once: true });
  }
}

// ── Buckets ────────────────────────────────────────────────────────────────
//
// Viewport width and device pixel ratio are what make the ladder question
// answerable at all: src/config/image-ladders.mjs chooses its rungs against
// exactly those two axes, so without them "9 images, 1.4 MB" cannot be judged
// good or bad. They are also fingerprinting surface, which is why nothing
// leaves at full precision and why nothing else about the device is recorded —
// no deviceMemory, no hardwareConcurrency, no navigator.connection.

/** Viewport width to the nearest 160 px. */
export function viewportBucket(): number {
  return Math.round(window.innerWidth / 160) * 160;
}

/** Device pixel ratio, clamped to the three rungs the ladders are built for. */
export function dprBucket(): number {
  const dpr = window.devicePixelRatio || 1;
  return Math.min(3, Math.max(1, Math.round(dpr)));
}

/**
 * Kilobytes, to the nearest 100, as the event dictionary requires.
 *
 * With one exception: a page that transferred SOME image bytes never reports 0.
 * Plain rounding sends every page under 50 KB to zero, which reads in a
 * dashboard as "this page has no images" — a different and false claim about
 * the four small covers on /software. The floor keeps the bucket honest about
 * the only distinction at that end of the scale that actually matters.
 */
function kilobytesBucket(bytes: number): number {
  if (bytes === 0) return 0;
  return Math.max(100, Math.round(bytes / 1024 / 100) * 100);
}

export type ImageCost = {
  images: number;
  bytes_kb: number;
  slowest_ms: number;
  from_cache: number;
  viewport_bucket: number;
  dpr: number;
};

/**
 * One summary per pageview: how many images resolved, what they transferred,
 * the slowest single one, how many came from cache, and the device shape that
 * explains which rung was chosen.
 *
 * Deliberately a summary rather than an event per image. Ten images per gallery
 * page per visitor is a volume and cardinality problem that buys no insight the
 * summary does not already carry.
 */
export function summariseImageCost(shots: Shot[]): ImageCost | null {
  if (shots.length === 0) return null;
  const durations = shots.map((shot) => shot.ms).filter((ms): ms is number => ms !== null);
  return {
    images: shots.length,
    bytes_kb: kilobytesBucket(shots.reduce((sum, shot) => sum + shot.bytes, 0)),
    slowest_ms: durations.length > 0 ? Math.max(...durations) : 0,
    from_cache: shots.filter((shot) => shot.cached).length,
    viewport_bucket: viewportBucket(),
    dpr: dprBucket(),
  };
}
