#!/usr/bin/env node
// Normalises a photograph on its way into src/content/photos/images/.
//
// This is an ingest tool, run by hand when a new master arrives — not a build
// step, and it does not touch what is already committed. It exists because the
// dimension you commit is permanent: Git keeps a blob per committed version of
// a path forever, JPEGs do not delta-compress, so `git gc` can never merge or
// reclaim them, and every future re-crop of a photograph costs another full
// copy at whatever size the first one was. The master's dimensions are also the
// only control over the full-size original Astro emits into dist/ and never
// references (see scripts/audit-astro-assets.mjs).
//
// --max-long-edge has no default on purpose. The right cap is a delivery
// decision, so it should be made and stated each time rather than inherited
// from a script. Today the widest rung any ladder renders is 2560px
// (src/config/image-ladders.mjs), so:
//
//   node scripts/prepare-master.mjs --max-long-edge=2560 shot.jpg
//
// would feed every ladder exactly with nothing spare. Raise it if a ladder
// grows a wider rung; do not raise it speculatively, because headroom in a
// committed JPEG is just storage cost that never goes away.
//
//   --out=<path>       write here (default: alongside, as <name>.prepared.jpg)
//   --in-place         overwrite the input
//   --quality=<1-100>  JPEG quality (default 88 — a master, not a delivery file)
//   --keep-metadata    preserve EXIF/IPTC/XMP instead of stripping it
//   --dry-run          report what would happen, write nothing

import { stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
let sharp;
try {
  sharp = require('sharp');
} catch {
  console.error(
    'prepare-master: sharp is not resolvable. It ships with Astro; run `npm install` first.',
  );
  process.exit(1);
}

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name) => {
  const found = args.find((arg) => arg.startsWith(`--${name}=`));
  return found ? found.slice(name.length + 3) : null;
};

const inputs = args.filter((arg) => !arg.startsWith('--'));
const maxLongEdge = Number(option('max-long-edge'));
const quality = Number(option('quality') ?? 88);
const outPath = option('out');
const inPlace = flag('in-place');
const keepMetadata = flag('keep-metadata');
const dryRun = flag('dry-run');

if (inputs.length === 0 || !Number.isFinite(maxLongEdge) || maxLongEdge <= 0) {
  console.error(
    'usage: node scripts/prepare-master.mjs --max-long-edge=<px> [options] <image>...\n' +
      '       --max-long-edge is required; see the notes at the top of this script.',
  );
  process.exit(1);
}
if (outPath && inputs.length > 1) {
  console.error('prepare-master: --out takes a single input.');
  process.exit(1);
}
if (outPath && inPlace) {
  console.error('prepare-master: --out and --in-place are mutually exclusive.');
  process.exit(1);
}

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;

for (const input of inputs) {
  const source = resolve(input);
  const before = await stat(source).catch(() => null);
  if (!before) {
    console.error(`prepare-master: ${input} does not exist.`);
    process.exitCode = 1;
    continue;
  }

  // .rotate() with no argument applies the EXIF orientation to the pixels. It
  // has to happen before the metadata is dropped, or a rotated frame would come
  // out on its side.
  const pipeline = sharp(source).rotate();
  const meta = await pipeline.metadata();
  const longEdge = Math.max(meta.width ?? 0, meta.height ?? 0);
  const willResize = longEdge > maxLongEdge;

  const destination = outPath
    ? resolve(outPath)
    : inPlace
      ? source
      : join(dirname(source), `${basename(source, extname(source))}.prepared.jpg`);

  const scaled = pipeline
    .resize({
      width: meta.width >= meta.height ? maxLongEdge : null,
      height: meta.height > meta.width ? maxLongEdge : null,
      fit: 'inside',
      // Never enlarge: a master smaller than the cap is left at its own size.
      withoutEnlargement: true,
    })
    // sharp's default chroma subsampling (4:2:0 below quality 90) is the
    // photographic norm. 4:4:4 would add roughly a fifth to the file for colour
    // detail that does not survive the downscale to a delivery rung — and in a
    // committed master those bytes are permanent.
    .jpeg({ quality, mozjpeg: true });

  const output = keepMetadata ? scaled.withMetadata() : scaled;

  const report = (bytes, width, height) => {
    console.log(`\n  ${basename(source)}`);
    console.log(`    ${meta.width}x${meta.height}  ${kb(before.size)}   before`);
    console.log(
      `    ${width}x${height}  ${kb(bytes)}   after` +
        (willResize ? '' : '  (already at or under the cap; re-encoded only)'),
    );
    const saved = before.size - bytes;
    if (saved > 0) {
      console.log(`    ${kb(saved)} smaller — ${((saved / before.size) * 100).toFixed(0)}%`);
    }
    console.log(`    metadata: ${keepMetadata ? 'preserved' : 'stripped (EXIF, IPTC, XMP, GPS)'}`);
  };

  if (dryRun) {
    const { data, info } = await output.toBuffer({ resolveWithObject: true });
    report(data.length, info.width, info.height);
    console.log(`    dry run — nothing written (would be ${destination})`);
    continue;
  }

  // Encode to a buffer first: writing sharp's output straight over its own
  // input truncates the file it is still reading.
  const { data, info } = await output.toBuffer({ resolveWithObject: true });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(destination, data);
  report(data.length, info.width, info.height);
  console.log(`    -> ${destination}`);
}

console.log('');
