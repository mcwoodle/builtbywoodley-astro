# Photography image delivery

This is the import and delivery workflow for the current implementation. Updated
2026-09-21. Earlier payload and build-time measurements were snapshots of six
photographs on 2026-09-02; run the measurement tools below for the current archive.

## Importing photographs

One entry in `src/content/photos/manifest.mdx` supplies the photography page,
home hero or horizontal strip, and both pages' photo viewers. Do not make separate
copies for those surfaces or commit responsive derivatives.

1. Keep original camera files and full archival exports outside the repository.
   Make a publishing copy, preferably an upright sRGB JPEG. Keep the archival
   filename (capture date, title and camera frame number) on that publishing copy.
   “Master” below means the site's publishing source, not the only archival copy.
2. Choose the resolution before committing. **2560px on the long edge is a
   compact starting point, not a lossless rule.** The zoom viewer downloads the
   master itself; keeping more resolution gives it more detail, at the cost of a
   larger download and Git blob. Inspect the photograph at the intended zoom size.
   The responsive ladders are measured in **width**, so a 2560px-tall portrait
   does not supply a 2560px-wide hero. A landscape frame generally suits the hero.
3. Dry-run preparation, then write the publishing copy with an explicit output:

   ```bash
   npm run photo:master -- --max-long-edge=2560 --dry-run "/path/to/export.jpg"
   npm run photo:master -- --max-long-edge=2560 \
     --out="src/content/photos/images/2026-09-20 - Lake - DSC01234.jpg" \
     "/path/to/export.jpg"
   ```

   Normal mode applies EXIF orientation, fits inside the stated long-edge cap
   without enlarging, strips metadata, and encodes JPEG with mozjpeg at quality
   88. It re-encodes even when the source is already below the cap. The cap has
   no default. Choose a larger explicit cap when retaining more zoom detail.

   For an already suitably sized JPEG whose pixels are upright, avoid another
   lossy encode:

   ```bash
   npm run photo:master -- --strip-only \
     --out="src/content/photos/images/2026-09-20 - Lake - DSC01234.jpg" \
     "/path/to/export.jpg"
   ```

   `--strip-only` is JPEG-only. It removes APP1 (EXIF/XMP) and APP13 (IPTC),
   retaining the compressed scan and ICC colour profile. It refuses any EXIF
   orientation other than normal (1): use normal preparation or normalize the
   orientation in your editor first. Removing a rotation tag without rotating
   the pixels would change how the photograph displays.

   Both modes support `--dry-run`. Without `--out`, normal mode writes
   `<name>.prepared.jpg` alongside the source; strip-only writes
   `<source>.stripped.jpg`. `--out` accepts one input. `--in-place` overwrites the
   source, so prefer a separate output when retaining an archival original.
   Do not use `--keep-metadata` for site imports. Review the output's orientation,
   colour, dimensions and metadata before committing; phone exports can carry GPS.
4. Add the prepared file to the manifest:

   ```yaml
   - master: "2026-09-20 - Lake - DSC01234.jpg"
     src: ./_deploy/lake-at-dawn.jpg
     title: Lake at dawn
     alt: Mist rising above still water beneath a pale pink sky.
     date: 2026-09-20
     location: Ontario
     note: Just before sunrise.
   ```

   `master` is a filename directly under `images/`. `src` must be exactly
   `./_deploy/<short-name>.<extension>` when `master` is supplied. Use unique
   lowercase names with single hyphens and the same extension as the prepared
   file. Required editorial fields are `title` (at most 100 characters), `alt`,
   capture `date`, and `location`; `note` is optional. Describe the image in `alt`
   rather than repeating its title. Keep locations as specific as you intend to
   publish, and check that dates agree with your archival records.
5. Select the home hero deliberately. Set **`hero: true` on at most one photo**.
   The Toronto skyline is pinned this way. To replace it, move the flag to the
   desired frame. With no flag, the newest capture date wins. All other frames
   appear in the home strip, newest first; the photography page and viewer always
   keep the whole archive in date order. YAML order does not override dates.
6. Build, measure, and inspect:

   ```bash
   npm run build
   npm run measure:images
   npm run dev
   ```

   Check `/` and `/photography` at desktop and phone widths: hero framing, the
   strip's **4:5 cover crop**, gallery proportions, captions, navigation and zoom.
   Restart an already-running dev server after changing masters or their manifest
   paths: staging runs at configuration setup, not on each source-file edit.
   Commit only the prepared masters and manifest (plus any intentional code edits).

For viewer or layout changes, also run the smoke suite. On Fedora use:

```bash
npm run test:smoke -- --project=chromium --project=firefox --project=mobile-chrome
```

CI on Ubuntu covers WebKit and iPhone as well. Photo anchors derive from titles;
renaming a title changes its shared link, and duplicate titles receive suffixes.

## Archival names in Git, short names on the web

`src/integrations/stage-photo-masters.mjs` runs on `astro:config:setup`, before
Astro reads the content collection, in dev, build and check. It copies each
prepared master to its short deployment name:

| Manifest field | Example | Storage |
| --- | --- | --- |
| `master` | `2026-09-20 - Lake - DSC01234.jpg` | `images/`, committed |
| `src` | `./_deploy/lake-at-dawn.jpg` | `_deploy/`, generated and gitignored |

Astro derives emitted asset basenames from the staged source. This keeps archival
names in Git while avoiding long percent-encoded names in image URLs.

The integration validates all staged entries before replacing `_deploy/`. It
rejects duplicate deployment names, invalid short names, paths outside the exact
staging form, and masters that are not regular files directly inside `images/`
(including symlinks). It warns about image files no manifest entry references.
The staged directory is rebuilt, so removed entries do not leave stale copies.

An existing short-named image can omit `master` and point `src` directly at
`./images/`, as `toronto-skyline.jpg` does. Prefer the two-name form for new imports.

## Responsive delivery and zoom

Git holds the publishing masters. `_deploy/`, `.astro/` and `dist/` are generated
and gitignored. Astro emits responsive WebP derivatives and content-hashed copies
of the masters into `dist/_astro/`. The viewer **references those masters for
on-demand zoom**: they are not orphaned photo assets or free visitor downloads.
Both their metadata and their image detail are publicly available. This repository
is public, so committing an unstripped source exposes it independently of deploys.

All responsive ladders live in `src/config/image-ladders.mjs`:

| Ladder key | Widths | Fallback width | Use |
| --- | --- | ---: | --- |
| `showcase` | 960, 1440, 1920, 2560 | 2560 | Home hero |
| `galleryStrip` | 420, 720 | 720 | Home horizontal strip |
| `photoTile` | 360, 480, 720, 960 | 960 | Photography grid |
| `viewer` | 640, 960, 1280, 1600, 1840 | 1840 | Unzoomed viewer |

These are requested widths; smaller sources constrain available detail. Zoom
uses the source outside these ladders. The four ladders share WebP quality 82 so
matching source/width/format/quality renders can be reused across call sites.

`ladderAttrs()` derives the fallback width from the largest rung. Spread it **last**:

```astro
<Image src={photo.src} alt={photo.alt} sizes="…" {...ladderAttrs("photoTile")} />
```

Keep `sizes` at the call site beside the explanation of the CSS it mirrors.
Changing gallery breakpoints requires changing `sizes` too. Run
`npm run measure:images -- --self-test` after changing those attributes.

The viewer's frame construction is shared in `src/lib/photo-frames.ts`; it builds
responsive sources plus the full-size zoom URL. Opening a photo downloads its
viewer image; zooming can fetch the larger master. The first three gallery tiles
load eagerly, the rest lazily. The hero loads eagerly with high fetch priority;
the home strip is lazy.

`public/_headers` assigns `/_astro/*` a one-year immutable cache. Content hashes
change URLs when images change. `wrangler.jsonc` deploys `dist/` as static assets;
its Worker entry point handles `/sawdust/*` first for analytics. Ordinary image
requests use static asset routing, not that analytics proxy.

## Measuring and validating delivery

`npm run build` includes postbuild guards:

- `scripts/check-asset-sizes.mjs` fails at 25 MiB per asset, warns at 20 MiB, checks
  the configured 20,000-file ceiling, and reports the largest files. Large inline
  visualization datasets have historically been the closest assets to the ceiling.
- `scripts/audit-astro-assets.mjs` reports unreferenced emitted assets. It does not
  delete them. Photo zoom URLs in viewer JSON are references; other content
  collections can still emit unused originals. `npm run audit:assets -- --prune`
  previews deletions; `--prune --confirm` performs them. Review candidates first.

Run these reports against a fresh build:

```bash
npm run measure:images
npm run measure:images -- --detail
npm run measure:images -- --json
npm run measure:images -- --all
npm run measure:images -- --self-test
npm run measure:images -- --max-initial-kb=400
```

The report projects responsive image bytes from built HTML and viewer JSON using
viewport, DPR and `sizes`. It is not a browser timing measurement or a complete
zoom-download budget. The current report models the unzoomed viewer ladder;
inspect master sizes separately and exercise zoom in the browser. Its bandwidth
estimates omit connection setup, cache state and decoding, and browser source
selection can differ because of caching or connection heuristics.

For actual device behavior, add `?stats=true` to a page. The runtime probe reads
`currentSrc`, resource timing and LCP. It persists for the browsing session;
`?stats=false` disables it. Development enables it automatically. Reload with the
cache disabled when comparing transfers: a cached resource can report zero
transfer bytes. Shift+P reruns the probe after opening or zooming an image.
The probe is dynamically imported; keep it outside the normal analytics chunk.

Focused import regressions run without a site build:

```bash
node --test tests/photo-import.test.mjs
```

## Storage decisions

Choose publishing dimensions before committing. Replacing a JPEG generally adds
another substantial blob to Git history; shrinking the current file does not
remove old versions. Keep an independent archive rather than using this repository
as the only home for full-resolution originals. Do not downscale already committed
masters just to reclaim history: that does not reclaim it and can reduce zoom detail.

There is no need to change storage services for a small batch of gallery additions.
Reassess object storage if originals need independent uploads, downloadable archival
files, or a separate archive of record. Such a move would need an explicit object
index, versioned keys, integrity checks and a delivery strategy; it is separate
from the current import workflow. Measure current image bytes and build times
before making that architectural change.
