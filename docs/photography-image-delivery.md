# Photography image delivery

Cloudflare limits re-verified against Cloudflare's documentation on 2026-09-01.
Build figures measured from `npm run build` on 2026-09-01, against the archive
on `feat/high-fidelity-images`, whose showcase frame is a 24 MP master. GitHub
figures are that platform's published limits, not re-verified here.

## Recommendation for this site

Keep the portfolio on **Workers Static Assets**, and keep committed masters at
**2560px on the long edge**. The first half of that is unchanged and not close
to any limit. The second half is the new part: a 20 MP master costs far more in
the repository and in CI than it returns on the page, because nothing the site
serves is ever wider than 2560px.

`public/_headers` gives `/_astro/*` a one-year immutable browser cache. The
filenames contain a content hash, so replacing a photograph creates new URLs
and cannot leave visitors with a stale image.

Cloudflare limits relevant to this deployment:

| Limit | Workers Free | Workers Paid |
| --- | ---: | ---: |
| Static asset files per Worker version | 20,000 | 100,000 |
| Individual static asset file size | 25 MiB | 25 MiB |
| `_headers` rules | 100 | 100 |
| Static asset requests | free, unmetered | free, unmetered |

The 100,000-file tier is Paid-only and needs Wrangler 4.34.0 or newer; the
deploy workflow pins `wranglerVersion: "4"`, so it would pick that up, but the
site is on Free and the 20,000 limit applies. There is no documented cap on
total asset bytes per deployment.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/),
and [custom response headers](https://developers.cloudflare.com/workers/static-assets/headers/).

## What the build emits per photograph

A photograph is requested at four call sites, each with its own width ladder:

| Call site | Widths | `src` fallback |
| --- | --- | ---: |
| `index.astro` showcase (hero) | 960, 1440, 1920, 2560 | 2560 |
| `index.astro` gallery strip | 420, 720 | 720 |
| `PhotoTile.astro` (grid) | 360, 480, 720, 960 | 960 |
| `photography/index.astro` viewer | 640, 960, 1280, 1600, 1840 | 1840 |

Every call site now passes an explicit `width`. Without one, Astro points the
`src` fallback at a **full-resolution** render of the master — for the 20 MP
showcase file that was a single 1.4 MB WebP, referenced three times (hero, grid
tile, and the viewer's base image, which is what the lightbox loads first).
Capping the fallbacks removed it. Nothing in `dist/` is now rendered above
2560px. **Leave those `width` props in place**: they are the only thing
stopping a high-resolution master from shipping a multi-megabyte fallback.

Measured for the 24 MP master (6000x4000, 1.38 MB source):

- **12 files, 2.6 MB total** — 1.2 MB of WebP derivatives plus a 1.4 MB copy
  of the original JPEG.
- That JPEG copy is **referenced by nothing**, and this is structural rather
  than specific to photographs. Astro's content layer generates
  `.astro/content-assets.mjs` with an unconditional static import for every
  `image()` field in every collection (32 of them today). Vite's asset pipeline
  emits each original into `/_astro/` with a content hash and returns its URL,
  which becomes `ImageMetadata.src` — the same value `<Image>` uses as the
  `src` fallback when no `width` is given. `<Image>` then builds its ladder
  from the source file on disk and references only those renders, leaving the
  already-emitted original with nothing pointing at it.

  Site-wide that is **20.65 MB across 31 files, 29% of `dist/`**, deployed and
  never requested. The mocked-project cover PNGs are ~17 MB of it. Astro 7
  exposes no way to suppress this: `image` config offers only `endpoint`,
  `service`, `domains`, `remotePatterns`, `layout`, `objectFit`, `breakpoints`
  and `responsiveStyles`. Since the orphan is emitted **at source size**, the
  committed master's dimensions are the only control over it — which is the
  second reason the 2560px recommendation below pays off. At 20 MP it is 55%
  of the photograph's entire footprint.
- Largest served render: 300 KB (2560px, hero only). The grid and viewer top
  out at 180 KB.
- Cold image generation: **1.67s** for this one master (11 renders).

A non-showcase photograph at the same resolution skips the hero ladder and
costs roughly **10 files and 2.0 MB**, of which 1.4 MB is again the dead
original.

**Pixel count is not the cost driver — tonal content is.** This 24 MP night
frame is materially cheaper than the 20 MP dusk edit it replaced (2.6 MB
against 4.1 MB deployed, 1.38 MB against 2.25 MB in the repository), because
large dark low-contrast regions compress far better than a bright graduated
sky. Treat the projections below as the shape of the cost, not a constant: a
bright, detailed frame can run 50-60% heavier than a dark one at the same
resolution.

## Scaling to 10-40 photographs at 20 MP

### Cloudflare: not the constraint

| Portfolio | Photo files | Share of 20,000 | Deployed photo bytes |
| ---: | ---: | ---: | ---: |
| 10 photos | ~102 | 0.5% | ~21-33 MB |
| 20 photos | ~202 | 1.0% | ~41-65 MB |
| 40 photos | ~402 | 2.0% | ~81-129 MB |

Ranges span a dark frame like the current showcase to a bright one like the
dusk edit it replaced.

Every figure is far inside the free tier, no single file approaches 25 MiB, and
asset requests stay free and unmetered. **Cloudflare does not care.** The one
file anywhere near the per-file ceiling remains `dist/viz/gta-crime-map.html`
at 21.75 MiB (87% of 25 MiB); it inlines its dataset and is the only asset that
can realistically fail a deploy.

### GitHub: where it actually costs

| Portfolio | Masters in the tree | Repo after (pack is 73.6 MiB today) |
| ---: | ---: | ---: |
| 10 photos | 14-23 MB | ~88-96 MB |
| 20 photos | 28-45 MB | ~101-119 MB |
| 40 photos | 55-90 MB | ~129-164 MB |

No hard limit is breached — GitHub blocks individual files over 100 MB, and a
2.25 MB JPEG is nowhere near that. The repository stays well under GitHub's
1 GB recommendation. Two softer costs matter more:

1. **JPEGs do not delta-compress.** Every re-export of a photograph adds
   another full copy to history, permanently. Re-exporting 40 masters once adds
   another 55-90 MB that `git gc` cannot reclaim. This is the cost that does
   not go away, and it is already visible here: the showcase frame has been
   replaced twice on this branch, so all three versions are in history.
2. **CI image generation is cold on every deploy.** The workflow caches npm but
   not `node_modules/.astro`, so all renders are regenerated each run. At
   ~1.7s per 24 MP master on this machine, 40 masters is ~68s here and
   plausibly 2.5-5 minutes on a 2-vCPU GitHub runner. Checkout is unaffected —
   `actions/checkout` fetches shallow by default, so history length does not
   slow the build.

### What 2560px masters change

Downscaling masters before committing costs nothing visible, because 2560px is
already the widest render the site produces:

Measured on the current showcase frame:

| Master long edge | JPEG size | 40-photo tree | 40-photo deploy |
| ---: | ---: | ---: | ---: |
| 6000px (as shot) | 1.38 MB | 55 MB | ~81 MB |
| 3200px | 772 KB | 31 MB | ~57 MB |
| **2560px** | **536 KB** | **21 MB** | **~48 MB** |
| 1920px | 332 KB | 13 MB | — (starves the 2560 hero) |

2560px is the sweet spot: it feeds every ladder exactly, cuts repository growth
by around 60% and deployed bytes by 40%, and shrinks the dead original copy
from 1.4 MB to 536 KB. 1920px would force the hero's top rung to upscale.

### Verdict

- **10-20 photographs at full resolution:** fine on both platforms. Ship it.
- **40 photographs:** still inside every hard limit, but the repository grows
  by 55-90 MB and CI image generation runs into minutes. Downscale to 2560px.
- **Either way**, downscaling to 2560px is free in quality terms. The only
  reason to keep 20 MP masters in Git is if the repository is also the archive
  of record — and if that is the goal, R2 is the better home for it.

Two cheap follow-ups, neither required: cache `node_modules/.astro` in the
deploy workflow to skip regeneration, and set an explicit `quality` (82 is a
reasonable target) at the four call sites, since none is set today.

## When to move photographs to R2

R2 becomes the right answer if the portfolio needs downloadable originals,
uploads decoupled from site deploys, or an archive of record that should not
live in Git history. R2's Free tier includes 10 GB-month of Standard storage,
1 million Class A operations, 10 million Class B operations, and free egress —
40 masters at 1.4 MB is around 55 MB, well under 1% of that allowance.

If that move happens:

1. Store originals in R2 using versioned/immutable object keys.
2. Attach a custom domain such as `media.builtbywoodley.ca`; the `r2.dev`
   development URL does not support Cloudflare Cache.
3. Send `Cache-Control: public, max-age=31536000, immutable` on versioned files.
4. Use Cloudflare Image Transformations for a small fixed set of widths instead
   of serving originals. The Images Free plan includes 5,000 unique
   transformations per month. The current four ladders produce 9-11 unique
   widths per photograph, so 40 photographs is ~400 transformations — inside
   the allowance, but aligning the ladders first would roughly halve it.

Remote Image Transformations accept source images up to 100 MB, and
Cloudflare's Free-plan CDN cache limit is 512 MB per file; normal photographic
masters stay far below either.

Sources: [R2 pricing](https://developers.cloudflare.com/r2/pricing/),
[R2 custom-domain caching](https://developers.cloudflare.com/cache/interaction-cloudflare-products/r2/),
[Images pricing](https://developers.cloudflare.com/images/pricing/),
[Images limits](https://developers.cloudflare.com/images/get-started/limits/),
and [CDN cacheable file limits](https://developers.cloudflare.com/cache/concepts/default-cache-behavior/).
