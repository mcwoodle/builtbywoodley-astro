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

// Markers that only exist in src/components/ImagePerfProbe.astro. If any of
// them reaches a build that did not ask for the probe, the build is wrong: the
// probe is a debugging tool and must never ship. PUBLIC_IMAGE_PERF arrives as a
// string, and the set below must match the one BaseLayout.astro tests against.
const PROBE_MARKERS = ['image-perf-hud', 'data-image-perf', '__imagePerfBound'];
const IMAGE_PERF_ON = new Set(['1', 'true', 'yes', 'on']);
const probeExpected = IMAGE_PERF_ON.has(String(process.env.PUBLIC_IMAGE_PERF ?? '').toLowerCase());

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

// ── The probe must not be in a production build ─────────────────────────────
const TEXT = new Set(['.html', '.js', '.mjs', '.css', '.json', '.txt', '.xml', '.webmanifest']);
const carriers = [];
for (const file of files) {
  const dot = file.path.lastIndexOf('.');
  if (dot === -1 || !TEXT.has(file.path.slice(dot).toLowerCase())) continue;
  const text = await readFile(file.path, 'utf8').catch(() => '');
  if (PROBE_MARKERS.some((marker) => text.includes(marker))) carriers.push(file.path);
}

if (probeExpected) {
  console.log(
    `\n  ⚑ PUBLIC_IMAGE_PERF is set — the image probe is in this build` +
      ` (${carriers.length} file(s)). Do not deploy it.\n`,
  );
} else if (carriers.length > 0) {
  console.error(`\n  ✗ The image probe leaked into a production build — ${carriers.length} file(s):`);
  for (const path of carriers.slice(0, 10)) console.error(`      ${relative(DIST, path)}`);
  console.error(
    '\n  It is a debugging tool and must never ship. Astro collects a component\'s\n' +
      '  scoped styles from the import graph even when the component never renders,\n' +
      '  so its <style> and <script> both have to stay is:inline.\n',
  );
  process.exit(1);
}

console.log(`\n  ✓ Every file is under ${mib(FAIL_BYTES)}${probeExpected ? '' : ', and the probe is absent'}.\n`);
