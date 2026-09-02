# Photography image delivery

Cloudflare limits re-verified against Cloudflare's documentation on 2026-09-01.
Build figures measured from `npm run build` on 2026-09-01, against the archive
on `feat/high-fidelity-images`, whose showcase frame is a 20 MP master. GitHub
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

Measured for the 20 MP master (5483x3655, 2.25 MB source):

- **12 files, 4.1 MB total** — 1.9 MB of WebP derivatives plus a 2.25 MB copy
  of the original JPEG.
- That JPEG copy is **referenced by nothing**. Astro emits the original
  alongside the derivatives for any asset a content collection imports, so it
  is deployed and never requested. At 20 MP it is 55% of the photograph's
  entire footprint.
- Largest served render: 464 KB (2560px, hero only). The grid and viewer top
  out at 284 KB.
- Cold image generation: **1.77s** for this one master (11 renders).

A non-showcase photograph at the same resolution skips the hero ladder and
costs roughly **10 files and 3.2 MB**, of which 2.25 MB is again the dead
original.

## Scaling to 10-40 photographs at 20 MP

### Cloudflare: not the constraint

| Portfolio | Photo files | Share of 20,000 | Deployed photo bytes |
| ---: | ---: | ---: | ---: |
| 10 photos | ~102 | 0.5% | ~33 MB |
| 20 photos | ~202 | 1.0% | ~65 MB |
| 40 photos | ~402 | 2.0% | ~129 MB |

Every figure is far inside the free tier, no single file approaches 25 MiB, and
asset requests stay free and unmetered. **Cloudflare does not care.** The one
file anywhere near the per-file ceiling remains `dist/viz/gta-crime-map.html`
at 21.75 MiB (87% of 25 MiB); it inlines its dataset and is the only asset that
can realistically fail a deploy.

### GitHub: where it actually costs

| Portfolio | Masters in the tree | Repo after (pack is 73.6 MiB today) |
| ---: | ---: | ---: |
| 10 photos | 22.5 MB | ~96 MB |
| 20 photos | 45 MB | ~119 MB |
| 40 photos | 90 MB | ~164 MB |

No hard limit is breached — GitHub blocks individual files over 100 MB, and a
2.25 MB JPEG is nowhere near that. The repository stays well under GitHub's
1 GB recommendation. Two softer costs matter more:

1. **JPEGs do not delta-compress.** Every re-export of a photograph adds
   another full copy to history, permanently. Re-exporting 40 masters once adds
   another ~90 MB that `git gc` cannot reclaim. This is the cost that does not
   go away.
2. **CI image generation is cold on every deploy.** The workflow caches npm but
   not `node_modules/.astro`, so all renders are regenerated each run. At
   1.77s per 20 MP master on this machine, 40 masters is ~71s here and
   plausibly 2.5-5 minutes on a 2-vCPU GitHub runner. Checkout is unaffected —
   `actions/checkout` fetches shallow by default, so history length does not
   slow the build.

### What 2560px masters change

Downscaling masters before committing costs nothing visible, because 2560px is
already the widest render the site produces:

| Master long edge | JPEG size | 40-photo tree | 40-photo deploy |
| ---: | ---: | ---: | ---: |
| 5483px (as shot) | 2.25 MB | 90 MB | ~129 MB |
| 3200px | 1.1 MB | 44 MB | ~85 MB |
| **2560px** | **768 KB** | **30 MB** | **~68 MB** |
| 1920px | 472 KB | 19 MB | — (starves the 2560 hero) |

2560px is the sweet spot: it feeds every ladder exactly, cuts repository growth
by two thirds and deployed bytes by roughly half, and shrinks the dead original
copy from 2.25 MB to 768 KB. 1920px would force the hero's top rung to upscale.

### Verdict

- **10-20 photographs at full 20 MP:** fine on both platforms. Ship it.
- **40 photographs:** still inside every hard limit, but the repository roughly
  doubles and CI image generation runs into minutes. Downscale to 2560px.
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
40 masters at 2.25 MB is 90 MB, about 1% of that allowance.

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
