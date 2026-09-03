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

**Applied as a tool, not as an edit.** `scripts/prepare-master.mjs` normalises a
photograph on the way in — long-edge cap, EXIF stripped, mozjpeg — and
`--max-long-edge` has no default, so the cap is stated each time rather than
inherited. `toronto-skyline.jpg` is deliberately left as shot at 6000x4000,
24.0 MP, 1.38 MiB.

Three reasons the existing file stays put, where an earlier draft of this
document called downscaling it the one outstanding action:

1. **It reclaims nothing.** The argument above is about Git history, and history
   already holds all three versions of this path. Downscaling now adds a
   *fourth* blob; it does not shrink the three that exist. The cost this
   document warns about was paid the moment the file was committed.
2. **It is a lossy re-encode of a source asset**, and the only thing gained is
   already-spent bytes.
3. **It contradicts where the archive is going.** The masters are due to be
   replaced with higher-resolution versions, so the cap belongs on the *import*
   of those, which is precisely what the tool is for.

The saving is real when it is applied at the right moment — a dry run on this
frame turns 6000x4000 / 1410 KB into 2560x1707 / **509 KB, 64% smaller**, which
lands close to the 536 KB the table further down measured independently. Run it
on the next master, not on this one:

    npm run photo:master -- --max-long-edge=2560 --dry-run path/to/shot.jpg

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

### Implemented: a build-time size guard

`scripts/check-asset-sizes.mjs`, run from `postbuild`. It fails the build when
an asset approaches the per-file ceiling, rather than letting it surface as a
failed deploy after a merge to `mainline`. What it does:

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

The open question was whether `gta-crime-map.html` should be excluded and
tracked on its own, since it is the only file the guard will ever fire on and a
guard that fires for one known file tends to get muted. It is **not** excluded.
If a data refresh pushes it past 25 MiB the answer is to stop inlining the
dataset rather than to raise the threshold, and the guard is what forces that
conversation at the right moment. Today it prints:

    ⚠ 1 file(s) over 20.00 MiB — advisory, the build continues:
        viz/gta-crime-map.html — 21.75 MiB, 3.25 MiB of headroom left

A second postbuild step, `scripts/audit-astro-assets.mjs`, reports the
unreferenced originals described below. It **reports and does not delete**. A
reference scan can only see URLs that appear literally in a built file, so it
cannot prove that nothing assembles one at runtime; the failure mode would be a
404 on a deployed image, found by a visitor rather than by a build. Against
bytes that are free, unmetered and uncapped, carrying dead weight is the cheaper
mistake. `npm run audit:assets -- --prune` prints exactly what it would remove
and stops; adding `--confirm` is what actually unlinks. Before deleting anything
it re-checks each candidate: a regular file (never a symlink), resolving inside
`dist/_astro/`, and carrying a content hash in its name, so a file the asset
pipeline did not emit is left alone. Tested against a throwaway copy of `dist`
containing a symlink, an unhashed file and an asset referenced only from the
viewer's JSON island — all three survived, and the 31 real orphans went.

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

A photograph is requested at four call sites, each with its own width ladder.
All four now live in **`src/config/image-ladders.mjs`**:

| Ladder | Widths | `src` fallback | Call site |
| --- | --- | ---: | --- |
| `showcase` | 960, 1440, 1920, 2560 | 2560 | `index.astro` hero |
| `gallery-strip` | 420, 720 | 720 | `index.astro` strip |
| `photo-tile` | 360, 480, 720, 960 | 960 | `PhotoTile.astro` |
| `viewer` | 640, 960, 1280, 1600, 1840 | 1840 | `photography/index.astro` |

**The `src` fallback is no longer written down anywhere.** It used to be an
explicit `width` prop at each call site, and it had to be: without one, Astro
points the fallback at a *full-resolution* render of the master — for the 20 MP
showcase file that was a single 1.4 MB WebP, referenced three times. But a prop
that must never be forgotten is a bug waiting for the next call site, so
`ladderAttrs()` derives it as `Math.max(...widths)`. The failure mode is now
unreachable rather than merely documented, which matters more the higher the
masters go. Nothing in `dist/` is rendered above 2560px.

What stays at the call site is `sizes`, deliberately. `sizes` is a restatement
of a component's CSS breakpoints; moving it into the config would not remove
that coupling, only split it across two files where a breakpoint change is
easier to miss. It sits next to the component it describes, with a comment
naming the rules in `global.css` it tracks.

That coupling had already slipped. Two of the three `sizes` strings disagreed
with the CSS they were meant to mirror:

| Ladder | Was | What the CSS does | Now |
| --- | --- | --- | --- |
| `photo-tile` | breaks at 560 / 900px | `.photo-gallery` breaks at 520 / 960px | 520 / 960px |
| `gallery-strip` | `74vw` then `34vw` | `.gallery-item` is `clamp(230px, 29vw, 400px)` | 232px / 29vw / 400px |

The tile was **under**-declaring between 901 and 960px, where the grid is still
two columns, so those screens fetched a rung too small and the browser upscaled
it. The strip was **over**-declaring almost everywhere: at 1920px it asked for
34vw — 653px — for a slot that is never wider than 400px, and so fetched the
720px rung instead of the 420px one. Correcting it takes the five strip images
from **294 KB to 124 KB on any 1x screen at 1440px or wider**, a 58% cut with
no visible change, and it is why the landing page's deferred total now reads
137 KB there against 307 KB on a 2x phone.

Measured for the 24 MP master (6000x4000, 1.38 MB source), at the explicit
quality 82 the ladders now set:

- **12 files, 2.72 MB total** — 1.28 MB of WebP derivatives plus a 1.44 MB copy
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
  content hash in the filename is obscurity, not access control.

  **This nearly went wrong.** Four of the five replacement masters arrived off a
  phone carrying a populated **GPS IFD** — real coordinates, decoded before
  anything was committed:

  | Frame | Coordinates | What they point at |
  | --- | --- | --- |
  | Allium | 42.3538N 71.0709W | a private garden — the manifest even says "In the garden" |
  | Perseid | 43.9972N 78.4297W | a rural property |
  | The Narrows | 47.5721N 52.6801W | a public landmark |
  | Kinkaku-ji | 35.0391N 135.7289E | a public landmark |

  Because the full-size original is deployed, committing those as exported would
  have published two private locations at a stable URL. All five were run through
  `npm run photo:master -- --strip-only --in-place` on the way in, which removes
  the APP1 (EXIF/XMP) and APP13 (IPTC) segments **without re-encoding** — the
  compressed image data is bit-identical, so nothing is paid in quality to drop
  the metadata. Verified after writing: no EXIF, no XMP, no IPTC, same
  dimensions.

  `toronto-skyline.jpg` is the one master that still carries metadata — 5,218
  bytes of EXIF plus XMP, naming the camera body (ILCE-6000), the Lightroom
  version and two timestamps. It has **no GPS**, and it is deliberately left
  alone: stripping it would add another 1.4 MB blob to history forever to remove
  a camera model, which is exactly the trade this document argues against
  everywhere else. Strip it the next time that file is re-exported for some other
  reason.

  Keep the strip in the import step for anything new. Downscaling alone does not
  remove EXIF; only an explicit strip does.
- Largest served render: 327 KB — the 2560px hero, and only on a 2x laptop.
  The viewer's top rung reaches 333 KB on the heaviest frame; the grid tops out
  at 159 KB. Every one of these figures comes from `npm run measure:images`.

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

## Archival names in Git, short names on the web

The masters are committed under the names they were exported with:

    src/content/photos/images/2015-06-17 - Allium - IMG_20150617_134550.jpg

That name is worth keeping. It carries the capture date and the camera's own
frame number, which is the provenance a photograph archive is *for* — rename it
to `allium.jpg` and the only remaining record of when the shutter actually
fired is a manifest field someone can mistype.

It is not, however, worth deploying. Astro derives every emitted asset name from
the source file's basename, so committing that file directly produced eleven
derivatives all called:

    /_astro/2015-06-17%20-%20Allium%20-%20IMG_20150617_134550.O8sh2kp3_JQpDB.webp

Forty characters of percent-encoded noise, repeated for every rung of every
`srcset`, on every page the photograph appears on. It also broke the
unreferenced-original audit, which matches asset basenames against the text of
the built site: the filename on disk has literal spaces and the URL in the HTML
has `%20`, so 45 live files were reported as orphans.

So the two names are separated. `src/integrations/stage-photo-masters.mjs` runs
on `astro:config:setup` — before the content collection is read, and in `dev`,
`build` and `check` alike — and copies each master to the short name the site
deploys under:

| Manifest field | Example | Where it lives |
| --- | --- | --- |
| `master` | `2015-06-17 - Allium - IMG_20150617_134550.jpg` | `images/`, committed |
| `src` | `./_deploy/allium.jpg` | `_deploy/`, generated, gitignored |

The result is `/_astro/allium.O8sh2kp3_Z2bXeI9.webp` — and the audit works again.

`_deploy/` is rebuilt from scratch on every run, so a photograph removed from
the manifest cannot leave a stale file behind for Astro to emit. A photograph
whose name is already short can skip the indirection entirely and point `src`
straight at `./images/`; `toronto-skyline.jpg` still does.

The integration fails the build rather than guessing:

- a `src` basename that is not lowercase-hyphenated (it becomes a public URL,
  and anything else has to be percent-encoded — the problem this exists to solve)
- two photographs deploying under the same name
- a `master` that is not in `images/`
- a `src` that is not under `_deploy/` when a master is declared

and it warns about masters in `images/` that no manifest entry references, since
the usual cause is an edit that forgot one and the cost is a file committed
forever for nothing.

## Changing a ladder, and measuring what it costs

### Changing one

`src/config/image-ladders.mjs` is the only file to edit. A ladder is its widths,
its quality and its format; the `src` fallback follows from the widths and the
`sizes` string stays with the component. Bad edits fail the build rather than
producing a quietly wrong ladder — the module asserts, at load, that widths are
ascending, unique and positive, and that quality is within 1-100, and
`ladderAttrs()` throws on a ladder name that does not exist.

It is plain `.mjs` rather than `.ts` because both the Astro components and the
Node measuring script import it. An earlier version kept it in TypeScript and had
the script read the file as *text*; that broke the first time a literal quality
became a named constant — a second parser drifting from the thing it parsed,
which is the failure this config exists to prevent. JSDoc carries the types.

Spread it **last** at a call site —
`<Image src alt sizes {...ladderAttrs("photoTile")} />`. Spread first, a stray
`width` or `quality` after it would silently win, which is the very override the
derived fallback exists to make impossible.

Adding a rung for higher-resolution masters is therefore a one-line change. The
report below already names the three places today's ladders top out below what a
screen asks for, which is where a rung would go first.

### Measuring it

Two tools, because they answer different questions.

**`npm run measure:images`** reads the built site — every `<img>` in `dist/`
plus the JSON island the viewer ships — and works out, for each screen in its
table, which rung a browser picks and what that file weighs. Reading the build
rather than the config is deliberate: a `sizes` string that has drifted from its
CSS, or a lost fallback cap, shows up as a payload jump instead of hiding. It is
what caught the two desynced `sizes` strings above.

It is a **byte-payload projection, not a load time**. It models the rule current
browsers use — smallest rung at or above CSS px x DPR — but that is a heuristic,
not a guarantee: Chrome also weighs the connection, Save-Data and whether a
larger rung is already cached. The millisecond columns are bytes over bandwidth
and nothing else, excluding DNS, TLS, slow-start, multiplexing, Cloudflare cache
state and decode. Treat them as a floor and as a way to compare builds.

    npm run measure:images                    the standard report
    npm run measure:images -- --detail        every image, rung by rung
    npm run measure:images -- --json          machine-readable
    npm run measure:images -- --all           every route, not the heaviest few
    npm run measure:images -- --self-test     check the sizes evaluator
    npm run measure:images -- --max-initial-kb=400   a budget; exits 1 over

`--self-test` pins `resolveSizes()` against every `sizes` string the site ships,
both branches of the viewer's `min()`, and `clamp()`. That function is the one
piece here that can be wrong without looking wrong — it returns a plausible
number and every figure inherits the error — so run it after touching any
`sizes` attribute. `--max-initial-kb` is the hook for CI, if the initial payload
ever becomes something worth defending.

**The runtime probe** answers "but what does my phone actually do". It reads
`currentSrc` — the rung the browser really chose — plus resource timing and LCP,
and logs a table per page with a small panel in the corner. Add `?stats=true` to
any URL, on any environment, production included:

    https://builtbywoodley.ca/photography/?stats=true

It stays on for the rest of the browsing session, so it survives moving around
the site, and `?stats=false` turns it off. `astro dev` has it on already.

**What that costs a visitor who never asks for it: 1.8 KB.** The panel, its
styles and every line of measurement code live in `src/scripts/image-perf.ts`,
which Vite splits into its own 4.6 KB chunk that is fetched only when the flag
is set. What every page carries is the loader in `ImagePerfProbe.astro` — one
`sessionStorage` read, one `URLSearchParams` check and a dynamic `import()` —
and because that is a shared chunk rather than inline script, it is fetched once
and cached across the whole site. Inlining the probe instead would have put
roughly 4 KB of debugging on the critical path of all 36 pages;
`check-asset-sizes.mjs` fails the build if it ever ends up there.

The HTML is byte-identical with and without the parameter — the gate is entirely
client-side — so a CDN still caches one copy of every page.

Reload with the cache disabled for transfer numbers that mean anything:
`transferSize` is 0 on a cache hit, and the probe marks those rows `cached`
rather than reporting them as free. Shift+P re-runs it, which is how to see the
viewer's higher-resolution frame after opening one.

### Where it stands today

Initial page images — what a visitor fetches before touching anything:

| | Phone 2x | Phone 3x | Tablet 2x | Laptop 1x | Laptop 2x | Desktop 1x |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| `/` (the hero) | 67 KB | 134 KB | 210 KB | 134 KB | **327 KB** | 210 KB |
| `/photography/` (3 tiles) | 145 KB | 233 KB | 233 KB | 41 KB | 145 KB | 41 KB |

The landing page's cost is one photograph — the full-bleed hero — and it is the
only image on the site on the critical path. A 2x laptop pulling the 2560px rung
is the worst case at 327 KB, which models to 1.7s on Slow 4G and 0.3s on Fast 4G.

Higher-resolution versions, fetched only when someone opens the viewer:

| | Phone 2x | Phone 3x | Tablet 2x | Laptop 1x | Laptop 2x | Desktop 1x |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| rung chosen | 960px | 1280px | 1600px | 1280px | 1840px | 1280px |
| average frame | 84 KB | 122 KB | 163 KB | 122 KB | 193 KB | 122 KB |

Three ladders top out below what a 2x or 3x screen asks for: the tile on a 3x
phone (wants 1112px, has 960px), the viewer on a 2x laptop (2360px against
1840px) and the hero on the same screen (2880px against 2560px). None is a bug
today — five of the six masters are only 1842px on the long edge, so a wider
rung would upscale from the source and buy nothing. They become worth revisiting
at the same moment the masters do, and the report will say so.

## Scaling to 10-40 photographs at 20 MP

### Where the archive actually stands

Measured on 2026-09-02 — six photographs committed, five of them at roughly
1842x1834 (3.4 MP) and one 24 MP showcase frame:

Re-measured after the five 2015-era masters were replaced with the higher
resolution exports:

| Photograph | Master | Files | Bytes in `dist/` |
| --- | ---: | ---: | ---: |
| `toronto-skyline` (showcase) | 6000x4000 | 12 | 2.78 MB |
| `fort-amherst` | 2285x2285 | 10 | 3.61 MB |
| `kinkaku-ji` | 3472x2676 | 10 | 2.83 MB |
| `perseid-over-the-barn` | 1488x1488 | 10 | 2.21 MB |
| `allium` | 2561x2561 | 10 | 1.84 MB |
| `space-needle-sunset` | 3805x2537 | 10 | 0.62 MB |
| **Total** | | **62** | **13.89 MB** |

The file count did not move — the ladders are the same and the shared `QUALITY`
constant keeps overlapping widths deduplicated — but deployed photo bytes went
from 8.72 MB to **13.89 MB**, a 59% rise, because every ladder now has enough
master to fill its top rungs. That is the cost of the resolution, not a
regression: the viewer's heaviest frame went from 333 KB to 637 KB on a 2x
laptop, and it is a genuinely bigger picture.

**One master is now the constraint rather than the ladder.**
`perseid-over-the-barn` is 1488x1488, *smaller* than the 1845x1851 file it
replaced, so Astro truncates its viewer ladder at 1488px and drops the 1600 and
1840 rungs. On a tablet or a 2x laptop the browser upscales it, and it will read
softer than its neighbours. `npm run measure:images` names this explicitly:

    /photography/ viewer (capped by master) on Laptop 2x: wants 2360px,
      ladder tops out at 1488px

Re-export that frame at 2560px on the long edge and the line disappears.

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

The `quality` follow-up suggested here is done: all four ladders set 82, from a
single `QUALITY` constant in `src/config/image-ladders.mjs`. Sharing one value
is a measured saving rather than a missing knob. Astro keys its render cache on
`(source, width, format, quality)`, and the ladders overlap — 960px appears in
three of them, 720px in two — so identical widths at the same quality collapse
into one file every call site shares. Giving each ladder its own quality split
them apart again: **7 extra files and about 1.0 MB per build**, for a difference
nobody can see. The field is still per-ladder, so vary it when something is
worth that price.

Caching `node_modules/.astro` in the deploy workflow was previously suggested
here and is no longer worth doing — regeneration costs 2.9s, so a cache would
save less than it costs to restore.

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
