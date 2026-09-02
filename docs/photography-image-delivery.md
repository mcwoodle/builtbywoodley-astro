# Photography image delivery

Cloudflare limits re-verified against Cloudflare's documentation on 2026-09-02.
Build figures measured from a cold `npm run build` — `node_modules/.astro`
removed first — on 2026-09-02, against the archive on
`feat/high-fidelity-images`, whose showcase frame is a 24 MP master. CI figures
are read from the actual `Deploy to Cloudflare Workers` run of 2026-09-02, not
projected. Repository figures come from `git count-objects` and the pack's
largest blobs. GitHub's plan allowances are that platform's published numbers,
not re-verified here.

## Recommendation for this site

Keep the portfolio on **Workers Static Assets**, and keep committed masters at
**2560px on the long edge**. The first half of that is unchanged and not close
to any limit.

The second half is not a cost optimization. At ten photographs it saves around
5 MB in the repository, which is nothing. It is a **history** decision: Git
keeps every version forever and JPEGs do not delta-compress, so the dimension
you commit sets what every future re-crop and re-grade of that photograph costs
— permanently, and with no way to reclaim it. 2560px caps that ceiling. The
megabytes saved today are incidental; the ones not spent in five years are the
point.

Not yet applied on this branch. `toronto-skyline.jpg` is still the master as
shot — 6000x4000, 24.0 MP, 1.38 MiB — so the showcase is currently paying the
full cost this document argues against. Downscaling it is the one outstanding
action here.

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

The free-and-unmetered row is worth stating precisely, because Workers Free
does carry a 100,000 requests/day cap and it is easy to assume it applies here.
It does not. Cloudflare's pricing page is explicit that requests to static
assets are free and unlimited; the daily cap counts requests that **invoke
Worker script**. `wrangler.jsonc` declares no `main` entrypoint, so this is an
assets-only Worker and there is no script to invoke. That holds only while it
stays that way — adding SSR, an API route, middleware or a custom `fetch`
handler puts every request back on the metered path.

One question is open: whether Wrangler skips unchanged assets on redeploy or
re-uploads the whole set. Cloudflare does not document it and it has not been
measured here. It bounds what the deploy path costs as the portfolio grows,
though not by much at these sizes — against 81-129 MB of deployed photo bytes
and no total-bytes cap, a full re-upload is slow rather than fatal. Replacing
one photograph and reading the deploy log would settle it; worth doing before
the portfolio reaches 40.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/),
[Static Assets billing](https://developers.cloudflare.com/workers/static-assets/billing-and-limitations/),
and [custom response headers](https://developers.cloudflare.com/workers/static-assets/headers/).

## What actually threatens a deploy

Not the photographs. The largest asset in `dist/` is
`dist/viz/gta-crime-map.html` at **21.75 MiB against the hard 25 MiB per-file
limit** — 3.25 MiB, or 15%, of headroom. It inlines its dataset, so a routine
data refresh is the realistic way a deploy on this site breaks, and nothing in
CI warns first. Its `-lite` companion is second at 12.92 MiB (51%). No
photograph is near: the largest photo file in `dist/` today is the 1.44 MiB
unreferenced original of the 24 MP showcase frame, 6% of the limit.

The same two files dominate the repository as well. History holds four copies
of `gta-crime-map.html` at 21.2-21.75 MiB and seven of the `-lite` companion at
12.9-13.2 MiB; the three versions of `toronto-skyline.jpg` total about 4 MB
between them. The photography archive is not what made the pack 73.6 MiB.

### Planned: a build-time size guard

**Not implemented.** The intent is to fail the build loudly when an asset
approaches the per-file ceiling, rather than discovering it as a failed deploy
after a merge to `mainline`.

Shape of it:

- A script run after `astro build` — `scripts/check-asset-sizes.mjs`, invoked
  from a `postbuild` npm script rather than a workflow step, so one change
  covers local builds, the PR preview workflow and the deploy workflow without
  editing three YAML files.
- Walk `dist/` and compare every file against two thresholds: **fail at 25 MiB**
  (Cloudflare's hard limit, so the build breaks before the deploy does) and
  **warn at 20 MiB** (80%, so `gta-crime-map.html` warns today instead of
  passing silently until the run where it doesn't).
- Assert the total file count against the 20,000-file Free-tier limit in the
  same pass. It is 228 today, so this is a tripwire, not a live concern.
- Print the ten largest files on every run, so growth shows up in the Actions
  log without anyone going looking for it.
- Exit non-zero on the fail threshold only. Warnings stay advisory so a
  legitimate dataset refresh does not block work.

One question to settle before writing it: whether `gta-crime-map.html` should
be excluded and tracked on its own. It is the only file the guard would ever
fire on, and a guard that only ever fires for one known file tends to get
muted. The counter-argument is that if a refresh does push it past 25 MiB, the
answer is to stop inlining the dataset — not to raise the threshold — and the
guard is what forces that conversation at the right moment.

## What Git holds, and what Cloudflare gets

Verified on 2026-09-02. The split is clean, and worth stating outright because
both the guard plan above and the 2560px recommendation depend on it.

**Git holds one file per photograph: the master.** `git ls-files
src/content/photos` returns exactly seven paths — six JPEGs and `manifest.mdx`.
No derivative of any size is committed anywhere in the repository;
`git ls-files | grep -icE '\.(webp|avif)$'` returns **0**. `dist/` and
`.astro/` are both in `.gitignore` and have **0 tracked files**, so neither the
generated ladders nor Astro's build cache can be committed by accident.

**Every smaller version is generated at build time and exists only in
`dist/`.** `<Image>` reads the master off disk and emits each call site's WebP
ladder into `dist/_astro/` under content-hashed filenames — 62 files for the
current six photographs — and `wrangler deploy` uploads `dist/` to Workers
Static Assets. Nothing in that chain writes back into the repository. Deleting
`dist/` and `node_modules/.astro` and rebuilding reproduces the whole set in
5.4s, which is what makes the derivatives disposable and the master the only
thing worth keeping.

Alongside the ladder, Cloudflare also receives a **full-size copy of the
master** — the unreferenced original described in the next section. So
Cloudflare gets the master plus every derivative; Git gets the master alone.

One caveat, and it is precisely why 2560px is recommended: "one copy" is true
of the working tree, not of history. Git keeps a blob per committed *version*
of a path. Five of the six photographs have exactly one version in history;
`toronto-skyline.jpg` has **three**, because it has been replaced twice on this
branch. Committing a photograph once costs one copy forever. Re-exporting it
costs another full copy each time, and since JPEGs do not delta-compress,
`git gc` cannot merge or reclaim them.

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

- **12 files, 2.67 MB total** — 1.2 MB of WebP derivatives plus a 1.44 MB copy
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
  second reason the 2560px recommendation above pays off. At 20 MP it is 55%
  of the photograph's entire footprint.
- Because that orphan is deployed, whatever the master carries travels with it
  and is publicly reachable, regardless of the repository being private. The
  content hash in the filename is obscurity, not access control. Checked on
  2026-09-02: all six committed masters carry **zero EXIF tags**, so no GPS
  coordinates, camera serials or embedded thumbnails are exposed today. Keep
  EXIF stripping in the export step for new photographs —
  `exiftool -all= -overwrite_original` covers it if the export path ever stops
  doing it. Note that downscaling alone does not necessarily strip EXIF.
- Largest served render: 300 KB (2560px, hero only). The grid and viewer top
  out at 180 KB.

A non-showcase photograph at the same resolution skips the hero ladder and
costs roughly **10 files and 2.2 MB**, of which 1.4 MB is again the dead
original.

**Pixel count is not the cost driver — tonal content is.** This 24 MP night
frame is materially cheaper than the 20 MP dusk edit it replaced (2.67 MB
against 4.1 MB deployed, 1.38 MB against 2.25 MB in the repository), because
large dark low-contrast regions compress far better than a bright graduated
sky. Treat the projections below as the shape of the cost, not a constant: a
bright, detailed frame can run 50-60% heavier than a dark one at the same
resolution.

## Scaling to 10-40 photographs at 20 MP

### Where the archive actually stands

Measured on 2026-09-02 — six photographs committed, five of them at roughly
1842x1834 (3.4 MP) and one 24 MP showcase frame:

| Photograph | Files | Bytes in `dist/` |
| --- | ---: | ---: |
| `toronto-skyline` (24 MP, showcase) | 12 | 2.67 MB |
| `fort-amherst` | 10 | 1.92 MB |
| `kinkaku-ji` | 10 | 1.33 MB |
| `allium` | 10 | 1.17 MB |
| `perseid-over-the-barn` | 10 | 0.94 MB |
| `space-needle-sunset` | 10 | 0.42 MB |
| **Total** | **62** | **8.45 MB** |

Extending that to ten photographs at the observed range gives **~102 files and
13-22 MB** — 0.5% of the 20,000-file limit, with the largest single file at 6%
of the 25 MiB ceiling. The projection table below assumes all ten at 20 MP,
which is the pessimistic end of that range rather than the likely one.

### Cloudflare: not the constraint

| Portfolio | Photo files | Share of 20,000 | Deployed photo bytes |
| ---: | ---: | ---: | ---: |
| 10 photos | ~102 | 0.5% | ~21-33 MB |
| 20 photos | ~202 | 1.0% | ~41-65 MB |
| 40 photos | ~402 | 2.0% | ~81-129 MB |

Ranges span a dark frame like the current showcase to a bright one like the
dusk edit it replaced.

Every figure is far inside the free tier, no single file approaches 25 MiB, and
asset requests stay free and unmetered. **Cloudflare does not care.** The only
asset that can realistically fail a deploy is `dist/viz/gta-crime-map.html`,
covered above — it has nothing to do with the photography archive.

### GitHub: where it actually costs

| Portfolio | Masters in the tree | Repo after (pack is 73.6 MiB today) |
| ---: | ---: | ---: |
| 10 photos | 14-23 MB | ~88-96 MB |
| 20 photos | 28-45 MB | ~101-119 MB |
| 40 photos | 55-90 MB | ~129-164 MB |

No hard limit is breached — GitHub blocks individual files over 100 MB, and a
2.25 MB JPEG is nowhere near that. The repository stays well under GitHub's
1 GB recommendation. Three softer costs matter more:

1. **JPEGs do not delta-compress.** Every re-export of a photograph adds
   another full copy to history, permanently. Re-exporting 40 masters once adds
   another 55-90 MB that `git gc` cannot reclaim. This is the cost that does
   not go away, and it is already visible here: the showcase frame has been
   replaced twice on this branch, so all three versions are in history. It is
   the whole argument for committing at 2560px.
2. **CI image generation is cheap — the earlier estimate in this document was
   wrong.** It extrapolated "~1.7s per 24 MP master" to 40 masters and
   predicted 2.5-5 minutes on a 2-vCPU runner. That per-master figure was CPU
   time, not wall time, and the extrapolation was off by roughly an order of
   magnitude. Measured cold on 2026-09-02, with `node_modules/.astro` removed,
   the **entire site's 151 renders complete in 2.76s** and the full build in
   **5.4s** (8 cores, 289% CPU). The real `Deploy to Cloudflare Workers` run
   that day took **66 seconds end-to-end** — checkout, `npm ci`, build and
   `wrangler deploy` together. Image generation is not a CI cost at any size
   considered here. Checkout is unaffected too: `actions/checkout` fetches
   shallow by default, so history length does not slow the build.
3. **Actions minutes are metered, because this repository is private.** GitHub
   Free allows 2,000 minutes a month on private repositories; public ones are
   unmetered. A 66-second run bills as 2 minutes — GitHub rounds up to the
   whole minute — and each push to `mainline` also triggers `Security`, so
   budget roughly 3-4 minutes per push and several hundred pushes a month of
   headroom. Not a risk at this cadence, but note what it scales with:
   **commit frequency, not photograph count.** Adding photographs does not
   move it, which is why it belongs here and not in the tables above.

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

- **10 photographs:** no meaningful risk on either platform, measured rather
  than projected — ~102 files and 13-22 MB deployed, 0.5% of the file limit,
  6% of the per-file limit, and around 70 seconds of CI. Ship it.
- **20 photographs at full resolution:** still fine on both platforms.
- **40 photographs:** still inside every hard limit, but the repository grows
  by 55-90 MB. Downscale to 2560px.
- **Either way**, downscaling to 2560px is free in quality terms, and the
  reason to do it is permanent Git history rather than any current byte count.
  The only reason to keep 20 MP masters in Git is if the repository is also the
  archive of record — and if that is the goal, R2 is the better home for it.

One cheap follow-up, not required: set an explicit `quality` (82 is a
reasonable target) at the four call sites, since none is set today. Caching
`node_modules/.astro` in the deploy workflow was previously suggested here and
is no longer worth doing — regeneration costs 2.76s, so a cache would save less
than it costs to restore.

## When to move photographs to R2

R2 becomes the right answer if the portfolio needs downloadable originals,
uploads decoupled from site deploys, or an archive of record that should not
live in Git history. None of those apply at ten photographs. R2's Free tier
includes 10 GB-month of Standard storage, 1 million Class A operations, 10
million Class B operations, and free egress — 40 masters at 1.4 MB is around
55 MB, well under 1% of that allowance.

If that move happens:

1. Store originals in R2 using versioned/immutable object keys.
2. Keep a `manifest.json` in the repository recording each object's key,
   SHA-256, dimensions and capture date. R2 holds the bytes, Git holds the
   index and the integrity record. Without it the bucket is an archive with no
   way to show its contents are what was uploaded, which is most of what
   "archive of record" is meant to buy.
3. Attach a custom domain such as `media.builtbywoodley.ca`; the `r2.dev`
   development URL does not support Cloudflare Cache.
4. Send `Cache-Control: public, max-age=31536000, immutable` on versioned files.
5. Use Cloudflare Image Transformations for a small fixed set of widths instead
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
