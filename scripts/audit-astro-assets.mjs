#!/usr/bin/env node
// Reports the images Astro emits into dist/_astro/ that nothing references.
//
// Why they exist: Astro's content layer generates an unconditional static
// import for every `image()` field in every collection. Vite emits each
// original at source size with a content hash and returns its URL, which
// becomes ImageMetadata.src. `<Image>` then builds its ladder from the file on
// disk and references only those renders, leaving the already-emitted original
// with nothing pointing at it. Astro 7 exposes no way to suppress this.
//
// This script REPORTS by default and never deletes in CI. Deleting is a real
// option (`--prune`) but a deliberate, human-run one, because the check is a
// reference scan: it finds URLs that appear literally in a built file, and it
// cannot see a URL a script assembles at runtime from parts. Nothing in this
// codebase does that today — the viewer ships whole URLs inside its JSON
// island — but the failure mode if something ever does is a 404 on a deployed
// image, found by a visitor rather than by a build. The bytes are inert:
// Cloudflare serves static assets free and unmetered, there is no cap on total
// deployed bytes, and the per-file limit is guarded by check-asset-sizes.mjs.
// Carrying dead weight is the cheaper mistake.
//
//   node scripts/audit-astro-assets.mjs                    report only (default)
//   node scripts/audit-astro-assets.mjs --prune            show what --prune would delete
//   node scripts/audit-astro-assets.mjs --prune --confirm  actually delete it
//   node scripts/audit-astro-assets.mjs --quiet            one summary line
//
// --prune alone never deletes. It prints the full list and stops, so the thing
// that unlinks files is only ever reached by typing a second flag after reading
// what it is about to do.

import { lstat, readdir, readFile, realpath, stat, unlink } from 'node:fs/promises';
import { extname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

const PRUNE = process.argv.includes('--prune');
const CONFIRM = process.argv.includes('--confirm');
const QUIET = process.argv.includes('--quiet');

// Only files Astro's asset pipeline emits are ever considered. Anything copied
// verbatim from public/ is outside this script's remit.
const ASSET_DIR = join(DIST, '_astro');
const IMAGE_EXTENSIONS = new Set(['.webp', '.avif', '.jpg', '.jpeg', '.png', '.gif', '.svg']);
// Where a reference could plausibly be written.
const TEXT_EXTENSIONS = new Set([
  '.html', '.js', '.mjs', '.css', '.json', '.txt', '.xml', '.svg', '.webmanifest',
]);

const kb = (bytes) => `${(bytes / 1024).toFixed(0)} KB`;
const mb = (bytes) => `${(bytes / 1_000_000).toFixed(2)} MB`;

async function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return out;
    throw error;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(path)));
    else if (entry.isFile()) out.push(path);
  }
  return out;
}

const all = await walk(DIST);
if (all.length === 0) {
  console.error('audit-astro-assets: dist/ is empty or missing. Run `npm run build` first.');
  process.exit(1);
}

const assets = all.filter(
  (path) => path.startsWith(ASSET_DIR) && IMAGE_EXTENSIONS.has(extname(path).toLowerCase()),
);

// One haystack of every byte of text the site ships. A reference is a literal
// occurrence of the asset's basename — content hashes make basenames unique,
// so a substring match cannot collide across assets.
const haystack = (
  await Promise.all(
    all
      .filter((path) => TEXT_EXTENSIONS.has(extname(path).toLowerCase()))
      .map((path) => readFile(path, 'utf8').catch(() => '')),
  )
).join('\n');

const orphans = [];
let referencedBytes = 0;
for (const path of assets) {
  const basename = path.slice(path.lastIndexOf('/') + 1);
  const bytes = (await stat(path)).size;
  if (haystack.includes(basename)) referencedBytes += bytes;
  else orphans.push({ path, bytes });
}

orphans.sort((a, b) => b.bytes - a.bytes);
const orphanBytes = orphans.reduce((sum, file) => sum + file.bytes, 0);
const totalBytes = referencedBytes + orphanBytes;
const share = totalBytes > 0 ? ((orphanBytes / totalBytes) * 100).toFixed(0) : '0';

if (QUIET) {
  console.log(
    `Unreferenced Astro originals: ${orphans.length} files, ${mb(orphanBytes)} (${share}% of emitted image bytes).`,
  );
} else {
  console.log(`\nUnreferenced originals in dist/_astro/`);
  console.log(
    `  ${assets.length - orphans.length} referenced (${mb(referencedBytes)}) · ` +
      `${orphans.length} unreferenced (${mb(orphanBytes)}, ${share}% of emitted image bytes)\n`,
  );
  for (const file of orphans.slice(0, 12)) {
    console.log(`    ${kb(file.bytes).padStart(9)}  ${relative(DIST, file.path)}`);
  }
  if (orphans.length > 12) console.log(`    … and ${orphans.length - 12} more`);
  if (orphans.length > 0 && !PRUNE) {
    console.log(
      '\n  Deployed but never requested. Free and unmetered on Workers, so this is\n' +
        '  a report rather than a failure. The lever that actually shrinks it is the\n' +
        '  committed master\'s dimensions — the original is emitted at source size.\n' +
        '  `--prune` deletes them; read the header of this script first.\n',
    );
  }
}

if (PRUNE && orphans.length > 0) {
  console.log(`\n  --prune would delete ${orphans.length} files, ${mb(orphanBytes)}:\n`);
  for (const file of orphans) {
    console.log(`    ${kb(file.bytes).padStart(9)}  ${relative(DIST, file.path)}`);
  }

  if (!CONFIRM) {
    console.log('\n  Nothing deleted. Add --confirm to go ahead.\n');
  } else {
    // Everything below unlinks, so each candidate is re-checked against the
    // narrowest description of what it is allowed to be. A reference scan is
    // textual and a build layout can change; these are the guards that keep a
    // wrong answer from becoming a deleted file.
    const assetRoot = await realpath(ASSET_DIR);
    let deleted = 0;
    let freed = 0;

    for (const file of orphans) {
      const full = resolve(file.path);

      // Never follow a link out of the tree, and never unlink anything that is
      // not a plain file.
      const link = await lstat(full);
      if (!link.isFile()) {
        console.warn(`    skipped (not a regular file): ${relative(DIST, full)}`);
        continue;
      }

      // Containment, after resolving, so no path can climb out of _astro/.
      const real = await realpath(full);
      if (real !== assetRoot && !real.startsWith(assetRoot + sep)) {
        console.warn(`    skipped (outside _astro/): ${relative(DIST, full)}`);
        continue;
      }

      // Only files Astro's pipeline names: <name>.<contenthash>.<ext>. A file
      // without a content hash was not emitted by the asset pipeline and is not
      // this script's to remove.
      if (!/\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$/.test(real)) {
        console.warn(`    skipped (no content hash in the name): ${relative(DIST, full)}`);
        continue;
      }

      await unlink(real);
      deleted += 1;
      freed += file.bytes;
    }

    console.log(`\n  ✓ Pruned ${deleted} files, ${mb(freed)} removed from dist/.`);
    if (deleted !== orphans.length) {
      console.log(`    ${orphans.length - deleted} candidate(s) skipped by the guards above.`);
    }
    console.log('');
  }
}
