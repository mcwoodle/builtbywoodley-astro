# Photography image delivery

Cloudflare limits verified against their documentation on 2026-08-24. Build
figures measured from `npm run build` on 2026-09-01, against the six-photograph
archive on `mainline`.

## Recommendation for this site

Keep the portfolio on **Workers Static Assets**. The site already deploys
`dist/` that way, static asset requests are free and unlimited, and Cloudflare
does not add a storage charge for Assets.

`public/_headers` gives `/_astro/*` a one-year immutable browser cache. The
filenames contain a content hash, so replacing a photograph creates new URLs
and cannot leave visitors with a stale image. Cloudflare's Workers asset tier
also caches these files across its network.

Current Free-plan limits relevant to this deployment:

- 20,000 static asset files per Worker version.
- 25 MiB maximum for any one deployed static asset.
- No additional charge for Assets storage.
- Static asset requests are free and unlimited.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/),
and [custom response headers](https://developers.cloudflare.com/workers/static-assets/headers/).

## What the build actually emits

A photograph is requested at three different call sites, and Astro generates a
separate set of derivatives for each:

| Call site | Widths requested | Format |
| --- | --- | --- |
| `PhotoTile.astro` (grid) | 360, 480, 720, 960 | WebP (default) |
| `photography/index.astro` → `getImage` (viewer) | 640, 960, 1280, 1600, 1840 | WebP (explicit) |
| `ContentCarousel.astro` / landing page | 420, 840 / 420, 720 | WebP (default) |

Astro also emits a full-width WebP as the `src` fallback and copies the
original JPEG into `/_astro/`. The net result for the current archive is
**11–12 files per photograph**, not four:

- Widths observed across the six photographs: 360, 420, 480, 640, 720, 900,
  960, 1280, 1400, 1600, 1840, plus each original at ~1842–1845px.
- Largest WebP derivative per photograph: **53–309 KiB** (`fort-amherst` is the
  heaviest at 309 KiB).
- Original JPEGs shipped alongside: 217–673 KiB each, ~2.7 MB for the six.
- All photograph derivatives together: **7.9 MB**.
- Whole `dist/`: **233 files**, well under the 20,000 file limit.

No `quality` is set at any call site, so every derivative uses Astro's default.
The effective ceiling is the original's own width (~1840px), not a fixed 1600px.

## Portfolio size budgets

The 25 MiB limit is **per generated file**, not a storage pool divided among the
photographs. At ~11.5 files per photograph, the file-count budget is roughly
three times what a naive four-variant estimate suggests, and still nowhere near
the ceiling.

| Portfolio | Generated files (~11.5 each) | Hard limit per file | Target for the largest WebP | Full-archive upper target |
| ---: | ---: | ---: | ---: | ---: |
| 5 photos | ~58 | 25 MiB | 1.5 MiB | 7.5 MiB |
| 10 photos | ~115 | 25 MiB | 1 MiB | 10 MiB |
| 50 photos | ~575 | 25 MiB | 600 KiB | ~30 MiB |
| 100 photos | ~1,150 | 25 MiB | 400 KiB | ~40 MiB |

The size columns are quality/performance targets, not Cloudflare limits. The
current archive is comfortably inside them. Only the first few tiles are
requested eagerly (`EAGER_TILES`); the rest use native lazy loading, and the
viewer's large sources are handed over as data so only an opened frame
downloads.

For replacements, retain full-resolution masters outside the repository and
export a high-quality JPEG or PNG source for the site. Because the pipeline
caps at the source's own width, a source much wider than ~1840px only inflates
the copied original without improving any derivative. Aim for a source under
about 10 MiB to keep Git and CI builds pleasant; this is an operational target,
not a Cloudflare limit.

At 50–100 photos, loading behavior and navigation matter before storage does.
Keep the single `/photography` route, but consider a later "load more"
boundary or filters so visitors do not traverse the entire archive at once.

## The file actually near the 25 MiB limit

No photograph is close to the per-file ceiling. The two largest deployed assets
are the GTA map pages:

| File | Size | Share of 25 MiB |
| --- | ---: | ---: |
| `dist/viz/gta-crime-map.html` | 21.75 MiB | 87% |
| `dist/viz/gta-crime-map-lite.html` | 12.92 MiB | 52% |

`gta-crime-map.html` inlines its dataset, so it grows whenever the data does.
It is the one asset that can realistically breach the limit and fail a deploy.
Watch it, and if it grows further, split the dataset out as a separate fetched
file rather than trimming photographs.

## Tuning levers, if delivery ever needs trimming

1. Set an explicit `quality` (82 is a reasonable target) at the tile, viewer and
   carousel call sites. Nothing sets one today.
2. Add `fetchpriority="high"` to the eager tiles in `PhotoTile.astro`. It
   currently sets `loading` and `decoding` but not `fetchpriority`, so the LCP
   image competes with everything else in the queue.
3. Narrow the width ladders. Three call sites requesting overlapping-but-unequal
   widths is what produces 11–12 files per photograph; aligning them would cut
   the count materially.

## When to move photographs to R2

R2 is useful later if the portfolio needs downloadable originals, frequent
uploads independent of site deploys, or enough media that keeping it in Git is
awkward. R2's Free tier currently includes 10 GB-month of Standard storage,
1 million Class A operations, 10 million Class B operations, and free egress.

If that move happens:

1. Store originals in R2 using versioned/immutable object keys.
2. Attach a custom domain such as `media.builtbywoodley.ca`; the `r2.dev`
   development URL does not support Cloudflare Cache.
3. Send `Cache-Control: public, max-age=31536000, immutable` on versioned files.
4. Use Cloudflare Image Transformations for a small fixed set of widths instead
   of serving originals. The Images Free plan includes 5,000 unique
   transformations per month. Note that the current three-call-site ladder would
   consume ~1,150 unique transformations for 100 photographs, so aligning the
   widths first (lever 3 above) matters more under Images than it does today.

The raw 10 GB R2 allowance would divide to 2 GB, 1 GB, 200 MB, or 100 MB per
original at 5, 10, 50, or 100 photos respectively. Those are theoretical
storage ceilings, not sensible web sizes: remote Image Transformations accept
source images up to 100 MB, and Cloudflare's Free-plan CDN cache limit is
512 MB per file. Normal photographic masters should remain far below either.

Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[R2 custom-domain caching](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/),
[Images pricing](https://developers.cloudflare.com/images/pricing/),
[Images limits](https://developers.cloudflare.com/images/get-started/limits/),
and [CDN cacheable file limits](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/).
