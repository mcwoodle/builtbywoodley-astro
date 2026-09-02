#!/usr/bin/env node
// Fails the build when a built asset approaches Cloudflare's per-file ceiling,
// so an oversized file is caught here rather than as a failed deploy after a
// merge to mainline.
//
// Run from `postbuild`, not from a workflow step, so one change covers local
// builds, the PR preview workflow and the deploy workflow at once.
//
// Thresholds are Cloudflare Workers Static Assets limits:
//   - 25 MiB per file (hard). We fail at it, because the deploy would.
//   - 20,000 files per Worker version on the Free tier.
// The 20 MiB warning is 80% of the per-file limit — early enough to act on.
//
// The largest file on this site is dist/viz/gta-crime-map.html, which inlines
// its dataset and sits in the warning band today. It is deliberately NOT
// excluded. A guard that only ever fires for one known file does tend to get
// muted, but if a data refresh ever pushes that file past 25 MiB the answer is
// to stop inlining the dataset rather than to raise the threshold, and this is
// what forces that conversation at the moment it matters.

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

// The image probe is reachable in production with ?stats=true, so it is
// expected in the build — but only as a separate chunk. These markers belong to
// src/scripts/image-perf.ts, and finding them in an HTML file means the probe
// has been inlined onto the critical path of every page instead of being
// lazily imported. That is roughly 4 KB x 36 pages of debugging code a normal
// visitor would download and never use.
const PROBE_INTERNALS = ['image-perf-hud', '__imagePerfBound'];
// The loader in ImagePerfProbe.astro is what SHOULD be in every page.
const PROBE_LOADER = '__imagePerfLoader';

const MIB = 1024 * 1024;
const FAIL_BYTES = 25 * MIB;
const WARN_BYTES = 20 * MIB;
const MAX_FILES = 20_000;
const SHOW_LARGEST = 10;

const mib = (bytes) => `${(bytes / MIB).toFixed(2)} MiB`;
const pct = (bytes) => `${((bytes / FAIL_BYTES) * 100).toFixed(0)}%`;

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
    else if (entry.isFile()) out.push({ path, bytes: (await stat(path)).size });
  }
  return out;
}

const files = await walk(DIST);

if (files.length === 0) {
  console.error('check-asset-sizes: dist/ is empty or missing. Run `npm run build` first.');
  process.exit(1);
}

files.sort((a, b) => b.bytes - a.bytes);
const total = files.reduce((sum, file) => sum + file.bytes, 0);

console.log(`\nAsset size guard — ${files.length} files, ${mib(total)} in dist/`);
console.log(`  per-file limit ${mib(FAIL_BYTES)} (fail) · ${mib(WARN_BYTES)} (warn) · file limit ${MAX_FILES.toLocaleString()}\n`);

console.log(`  Largest ${Math.min(SHOW_LARGEST, files.length)} files`);
for (const file of files.slice(0, SHOW_LARGEST)) {
  const name = relative(DIST, file.path);
  console.log(`    ${mib(file.bytes).padStart(10)}  ${pct(file.bytes).padStart(4)}  ${name}`);
}

const failures = files.filter((file) => file.bytes >= FAIL_BYTES);
const warnings = files.filter((file) => file.bytes >= WARN_BYTES && file.bytes < FAIL_BYTES);

if (warnings.length > 0) {
  console.log(`\n  ⚠ ${warnings.length} file(s) over ${mib(WARN_BYTES)} — advisory, the build continues:`);
  for (const file of warnings) {
    const headroom = FAIL_BYTES - file.bytes;
    console.log(
      `      ${relative(DIST, file.path)} — ${mib(file.bytes)}, ${mib(headroom)} of headroom left`,
    );
  }
}

if (files.length > MAX_FILES) {
  console.error(
    `\n  ✗ ${files.length.toLocaleString()} files exceeds the ${MAX_FILES.toLocaleString()}-file Workers Free limit.`,
  );
}

if (failures.length > 0) {
  console.error(`\n  ✗ ${failures.length} file(s) at or over Cloudflare's hard ${mib(FAIL_BYTES)} per-file limit:`);
  for (const file of failures) {
    console.error(`      ${relative(DIST, file.path)} — ${mib(file.bytes)}`);
  }
  console.error('\n  This deploy would be rejected by Cloudflare. Shrink the file rather than the threshold.\n');
  process.exit(1);
}

if (files.length > MAX_FILES) process.exit(1);

// ── The probe must stay off the critical path ───────────────────────────────
// It is meant to be in the build — ?stats=true turns it on in production — but
// only as a chunk something has to go and fetch.
const inlined = [];
let chunk = null;
for (const file of files) {
  const dot = file.path.lastIndexOf('.');
  const extension = dot === -1 ? '' : file.path.slice(dot).toLowerCase();
  if (extension !== '.html' && extension !== '.js') continue;
  const text = await readFile(file.path, 'utf8').catch(() => '');
  if (!PROBE_INTERNALS.some((marker) => text.includes(marker))) continue;
  if (extension === '.html') inlined.push(file.path);
  else chunk ??= file.path;
}

if (inlined.length > 0) {
  console.error(`\n  ✗ The image probe is inlined into ${inlined.length} HTML file(s):`);
  for (const path of inlined.slice(0, 5)) console.error(`      ${relative(DIST, path)}`);
  console.error(
    '\n  It should be a lazily imported chunk, not markup on every page. Check that\n' +
      '  ImagePerfProbe.astro still reaches it through a dynamic import().\n',
  );
  process.exit(1);
}

if (!chunk) {
  console.error('\n  ✗ The image probe chunk is missing — ?stats=true would do nothing.\n');
  process.exit(1);
}

// The loader is its own small chunk rather than inline script, so the pages
// that carry the probe are the ones referencing that chunk by name.
let loaderPath = null;
for (const file of files.filter((entry) => entry.path.endsWith('.js'))) {
  const text = await readFile(file.path, 'utf8').catch(() => '');
  if (text.includes(PROBE_LOADER)) {
    loaderPath = file.path;
    break;
  }
}
if (!loaderPath) {
  console.error('\n  ✗ The image probe loader is missing — ?stats=true would do nothing.\n');
  process.exit(1);
}

const loaderName = loaderPath.slice(loaderPath.lastIndexOf('/') + 1);
let loaderPages = 0;
for (const file of files.filter((entry) => entry.path.endsWith('.html'))) {
  const text = await readFile(file.path, 'utf8').catch(() => '');
  if (text.includes(loaderName)) loaderPages += 1;
}

const sizeOf = (path) => files.find((entry) => entry.path === path).bytes;
console.log(
  `\n  ✓ Every file is under ${mib(FAIL_BYTES)}.` +
    `\n    Image probe: ${(sizeOf(loaderPath) / 1024).toFixed(1)} KB loader on ${loaderPages} page(s), ` +
    `${(sizeOf(chunk) / 1024).toFixed(1)} KB fetched only for ?stats=true.\n`,
);
