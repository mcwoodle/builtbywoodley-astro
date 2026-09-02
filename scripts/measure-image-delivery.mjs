#!/usr/bin/env node
// What each page actually costs in image bytes, by screen size.
//
// This reads the BUILT site rather than the source. It parses every <img> in
// dist/, plus the JSON island the photography viewer ships, and for each
// device profile below it works out which rung of each srcset a browser would
// choose and what that file weighs on disk. Reading the build rather than the
// config means it measures what was actually shipped, so a `sizes` string that
// has drifted from its CSS, or a lost `width` cap, shows up as a payload jump
// instead of hiding.
//
// ── What this is, and is not ────────────────────────────────────────────────
// This is a byte-payload projection, not a measurement of load time. It models
// the rule every current browser uses — pick the smallest rung at or above
// (CSS px x DPR) — but that rule is a heuristic, not a guarantee: Chrome also
// weighs the connection, Save-Data, and whether a larger rung is already
// cached. The millisecond columns are bytes/bandwidth and nothing else. They
// exclude DNS, TLS, TCP slow-start, HTTP/2 multiplexing, Cloudflare cache
// state and image decode, so treat them as a floor and a way to compare builds
// against each other, not as a prediction of what a visitor experiences.
//
// For ground truth on a real device, use the runtime probe instead: add
// ?stats=true to any URL, in any environment, and read the table it logs to the
// console. See src/components/ImagePerfProbe.astro and src/scripts/image-perf.ts.
//
//   node scripts/measure-image-delivery.mjs              the standard report
//   node scripts/measure-image-delivery.mjs --detail     every image, per rung
//   node scripts/measure-image-delivery.mjs --json       machine-readable
//   node scripts/measure-image-delivery.mjs --page=/     one page
//   node scripts/measure-image-delivery.mjs --all        every route, not the top few
//   node scripts/measure-image-delivery.mjs --self-test   check the sizes evaluator
//   node scripts/measure-image-delivery.mjs --max-initial-kb=400   budget, exits 1 over

import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, posix } from 'node:path';
import { fileURLToPath } from 'node:url';

import { imageLadders } from '../src/config/image-ladders.mjs';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const DIST = join(ROOT, 'dist');

// ── Configure the report here ───────────────────────────────────────────────
// Screens to model. `width` is CSS pixels (what `sizes` is evaluated against),
// `dpr` is the device pixel ratio the browser multiplies by.
const DEVICES = [
  { name: 'Phone 2x', width: 360, dpr: 2 },
  { name: 'Phone 3x', width: 390, dpr: 3 },
  { name: 'Tablet 2x', width: 834, dpr: 2 },
  { name: 'Laptop 1x', width: 1440, dpr: 1 },
  { name: 'Laptop 2x', width: 1440, dpr: 2 },
  { name: 'Desktop 1x', width: 1920, dpr: 1 },
];

// Throughput only — see the caveat above.
const NETWORKS = [
  { name: 'Slow 4G', mbps: 1.6 },
  { name: 'Fast 4G', mbps: 9 },
  { name: 'Cable', mbps: 30 },
];
// ────────────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const valueOf = (prefix) => {
  const found = args.find((arg) => arg.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
};

const DETAIL = has('--detail');
const ALL = has('--all');
// The mocked-project archive is 30-odd routes of near-identical pages, and
// listing them all buries the two that matter. The heaviest few carry the
// signal; --all prints the rest.
const TOP_PAGES = 6;
const AS_JSON = has('--json');
const ONLY_PAGE = valueOf('--page=');
const BUDGET_KB = valueOf('--max-initial-kb=');

const kb = (bytes) => `${Math.round(bytes / 1024)} KB`;
const ms = (bytes, mbps) => Math.round((bytes * 8) / (mbps * 1_000_000) * 1000);

// ── Reading the build ───────────────────────────────────────────────────────

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

const decode = (text) =>
  text
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));

function attributes(tag) {
  const found = {};
  const pattern = /([a-zA-Z][a-zA-Z0-9-]*)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let match;
  // Skip the tag name itself.
  const body = tag.replace(/^<\s*[a-zA-Z0-9-]+/, '');
  while ((match = pattern.exec(body)) !== null) {
    found[match[1].toLowerCase()] = decode(match[2] ?? match[3] ?? match[4] ?? '');
  }
  return found;
}

/** `url 360w, url 480w` -> [{ url, width }], ascending. */
function parseSrcset(srcset) {
  const rungs = [];
  const pattern = /(\S+)\s+(\d+)w/g;
  let match;
  while ((match = pattern.exec(srcset)) !== null) {
    rungs.push({ url: match[1], width: Number(match[2]) });
  }
  return rungs.sort((a, b) => a.width - b.width);
}

// ── Evaluating `sizes` ──────────────────────────────────────────────────────

/** Split on commas that are not inside parentheses — min(1180px, 86vw) is one value. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const character of text) {
    if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += character;
  }
  if (current.trim()) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

/**
 * A sizes entry is `<media-condition>? <source-size-value>`. Read the value off
 * the end: either a math function, which ends in `)`, or a bare length.
 */
function splitEntry(entry) {
  if (entry.endsWith(')')) {
    let depth = 0;
    for (let index = entry.length - 1; index >= 0; index -= 1) {
      if (entry[index] === ')') depth += 1;
      else if (entry[index] === '(') {
        depth -= 1;
        if (depth === 0) {
          // Walk back over the function name, if there is one.
          let start = index;
          while (start > 0 && /[a-zA-Z-]/.test(entry[start - 1])) start -= 1;
          if (start === index) break; // A bare paren group: a condition, not a value.
          return { condition: entry.slice(0, start).trim(), value: entry.slice(start).trim() };
        }
      }
    }
  }
  const split = entry.lastIndexOf(' ');
  if (split === -1) return { condition: '', value: entry };
  return { condition: entry.slice(0, split).trim(), value: entry.slice(split + 1).trim() };
}

function length(value, viewport) {
  const text = value.trim();
  const fn = /^([a-zA-Z-]+)\((.*)\)$/.exec(text);
  if (fn) {
    const name = fn[1].toLowerCase();
    const parts = splitTopLevel(fn[2]).map((part) => length(part, viewport));
    if (name === 'min') return Math.min(...parts);
    if (name === 'max') return Math.max(...parts);
    if (name === 'clamp') return Math.min(Math.max(parts[1], parts[0]), parts[2]);
    throw new Error(`sizes: unsupported function ${name}() in "${value}"`);
  }
  const unit = /^(-?[\d.]+)(px|vw|em|rem)$/.exec(text);
  if (!unit) {
    // Everything unsupported lands here — vh, %, calc(), a CSS variable, a unit
    // that does not exist. Guessing would return a plausible number and quietly
    // corrupt every figure downstream, so this fails loudly instead.
    throw new Error(`sizes: cannot read the length "${value}"`);
  }
  const number = Number(unit[1]);
  if (unit[2] === 'px') return number;
  if (unit[2] === 'vw') return (number / 100) * viewport;
  return number * 16; // em / rem against a 16px root.
}

function conditionHolds(condition, viewport) {
  if (!condition) return true;
  if (/\bor\b|\bnot\b/i.test(condition)) {
    throw new Error(`sizes: unsupported media condition "${condition}"`);
  }
  const clauses = condition.match(/\([^)]*\)/g) ?? [];
  if (clauses.length === 0) return true;
  return clauses.every((clause) => {
    const test = /\(\s*(min|max)-width\s*:\s*([\d.]+)(px|em|rem)\s*\)/i.exec(clause);
    if (!test) throw new Error(`sizes: unsupported media condition "${clause}"`);
    const bound = test[3].toLowerCase() === 'px' ? Number(test[2]) : Number(test[2]) * 16;
    return test[1].toLowerCase() === 'max' ? viewport <= bound : viewport >= bound;
  });
}

/** The CSS pixel width the browser will lay this image out at. */
function resolveSizes(sizes, viewport) {
  if (!sizes) return viewport; // No sizes attribute means 100vw.
  for (const entry of splitTopLevel(sizes)) {
    const { condition, value } = splitEntry(entry);
    if (conditionHolds(condition, viewport)) return length(value, viewport);
  }
  return viewport;
}

/** Smallest rung at or above the required pixels; the top rung if none reaches it. */
function chooseRung(rungs, requiredPixels) {
  return rungs.find((rung) => rung.width >= requiredPixels) ?? rungs[rungs.length - 1];
}

// ── The ladder table, for labels ────────────────────────────────────────────
// Imported, not parsed. An earlier version read the config as text and broke the
// first time a literal quality became a named constant; there is now one
// definition and no second parser to drift from it.

const ladders = Object.values(imageLadders);
/**
 * Which ladder produced this srcset.
 *
 * An exact width match is the normal case. A ladder can also come out SHORT:
 * Astro will not upscale, so a master narrower than the top rung truncates the
 * ladder and caps its last entry at the master's width. That is worth naming
 * rather than reporting as unknown — a capped ladder is the signal that a
 * photograph is not feeding the sizes the site is asking for.
 */
const ladderFor = (rungs) => {
  const widths = rungs.map((rung) => rung.width);
  const key = widths.join(',');

  const exact = ladders.find((ladder) => ladder.widths.join(',') === key);
  if (exact) return exact.id;

  const capped = ladders.find((ladder) => {
    if (widths.length > ladder.widths.length) return false;
    // Every rung but the last matches the ladder position for position.
    for (let index = 0; index < widths.length - 1; index += 1) {
      if (widths[index] !== ladder.widths[index]) return false;
    }
    // The last one is the master's own width, at or below the rung it replaced.
    return widths[widths.length - 1] <= ladder.widths[widths.length - 1];
  });
  return capped ? `${capped.id} (capped by master)` : null;
};

// ── Self-test ───────────────────────────────────────────────────────────────
// resolveSizes() is the one piece of this script that can be wrong without
// looking wrong: it silently returns a plausible number and every figure below
// inherits the error. These cases pin it to the four `sizes` strings the site
// actually ships, both branches of the viewer's min(), and the no-attribute
// default. Run it after touching any `sizes` attribute.
if (has('--self-test')) {
  const cases = [
    ['100vw', 1440, 1440, 'showcase hero, full bleed'],
    ['(max-width: 900px) 94vw, min(1180px, 86vw)', 800, 752, 'viewer, narrow branch'],
    ['(max-width: 900px) 94vw, min(1180px, 86vw)', 1200, 1032, 'viewer, 86vw under the cap'],
    ['(max-width: 900px) 94vw, min(1180px, 86vw)', 1440, 1180, 'viewer, 1180px cap wins'],
    ['(max-width: 520px) 95vw, (max-width: 960px) 48vw, 360px', 390, 370.5, 'tile, one column'],
    ['(max-width: 520px) 95vw, (max-width: 960px) 48vw, 360px', 834, 400.32, 'tile, two columns'],
    ['(max-width: 520px) 95vw, (max-width: 960px) 48vw, 360px', 1440, 360, 'tile, three columns'],
    ['(max-width: 795px) 232px, (max-width: 1380px) 29vw, 400px', 360, 232, 'strip, clamped low'],
    ['(max-width: 795px) 232px, (max-width: 1380px) 29vw, 400px', 1000, 290, 'strip, 29vw'],
    ['(max-width: 795px) 232px, (max-width: 1380px) 29vw, 400px', 1920, 400, 'strip, clamped high'],
    ['', 1024, 1024, 'no sizes attribute is 100vw'],
    ['clamp(230px, 29vw, 400px)', 1000, 290, 'clamp(), if a sizes ever uses one'],
    ['(min-width: 700px) 50vw, 100vw', 640, 640, 'min-width condition'],
  ];
  let failed = 0;
  console.log('\n  resolveSizes()');
  for (const [sizes, viewport, expected, label] of cases) {
    let got;
    try {
      got = resolveSizes(sizes, viewport);
    } catch (error) {
      got = `threw: ${error.message}`;
    }
    const ok = Math.abs(got - expected) < 0.01;
    if (!ok) failed += 1;
    console.log(
      `    ${ok ? '✓' : '✗'} ${label.padEnd(34)} @${String(viewport).padStart(4)}px -> ${got}` +
        (ok ? '' : `  (expected ${expected})`),
    );
  }

  // chooseRung: the other half of the model.
  const rungs = [360, 480, 720, 960].map((width) => ({ url: `${width}.webp`, width }));
  const rungCases = [
    [359, 360, 'below the bottom rung'],
    [360, 360, 'exactly a rung'],
    [361, 480, 'just over a rung'],
    [960, 960, 'exactly the top'],
    [1112, 960, 'past the top rung, so the browser upscales'],
  ];
  console.log('\n  chooseRung()');
  for (const [required, expected, label] of rungCases) {
    const got = chooseRung(rungs, required).width;
    const ok = got === expected;
    if (!ok) failed += 1;
    console.log(`    ${ok ? '✓' : '✗'} ${label.padEnd(42)} ${required} -> ${got}`);
  }

  console.log(failed === 0 ? '\n  ✓ evaluator agrees with every case.\n' : `\n  ✗ ${failed} case(s) failed.\n`);
  process.exit(failed === 0 ? 0 : 1);
}

// ── Collect every image the build ships ─────────────────────────────────────

const files = await walk(DIST);
const sizeCache = new Map();
async function bytesOf(url) {
  const clean = url.split('?')[0];
  if (sizeCache.has(clean)) return sizeCache.get(clean);
  const path = join(DIST, clean.replace(/^\//, ''));
  let bytes = 0;
  try {
    bytes = (await stat(path)).size;
  } catch {
    bytes = 0; // Remote or missing; reported as unknown rather than guessed.
  }
  sizeCache.set(clean, bytes);
  return bytes;
}

const pages = [];
/** Pages where the tag matcher and the tag count disagree. */
const unparsed = [];
for (const path of files.filter((file) => file.endsWith('.html'))) {
  const route = `/${posix.dirname(relative(DIST, path).split('\\').join('/'))}/`
    .replace('/./', '/')
    .replace(/\/+/g, '/');
  if (ONLY_PAGE && route !== ONLY_PAGE) continue;

  const html = await readFile(path, 'utf8');
  const images = [];

  // The tag matcher below stops at the first ">", which is right for every tag
  // Astro emits but wrong for a ">" inside a quoted attribute value — alt text
  // is prose, and prose can contain one. That would truncate the tag and drop
  // the attributes after it, quietly turning a responsive image into an
  // unmeasured one. An incomplete report that still looks complete is the worst
  // outcome here, so both shapes of failure are counted and neither is
  // swallowed: a "<img" that yields no tag at all, and a tag cut mid-value
  // (which leaves an odd number of quote characters behind).
  const declared = (html.match(/<img[\s>]/gi) ?? []).length;
  let parsed = 0;
  let truncated = 0;

  for (const tag of html.match(/<img\b[^>]*>/gi) ?? []) {
    parsed += 1;
    if ((tag.match(/"/g) ?? []).length % 2 !== 0) {
      truncated += 1;
      continue;
    }
    const attrs = attributes(tag);
    // An image with no srcset is still weight on the page. It is measured as a
    // one-rung ladder, so it counts towards the page total and simply does not
    // vary by screen.
    const rungs = attrs.srcset
      ? parseSrcset(attrs.srcset)
      : attrs.src
        ? [{ url: attrs.src, width: Number(attrs.width) || Number.MAX_SAFE_INTEGER }]
        : [];
    if (rungs.length === 0) continue;
    images.push({
      rungs,
      sizes: attrs.sizes ?? '',
      lazy: (attrs.loading ?? '').toLowerCase() === 'lazy',
      priority: (attrs.fetchpriority ?? '').toLowerCase() === 'high',
      ladder: attrs.srcset ? ladderFor(rungs) : 'fixed width',
      alt: attrs.alt ?? '',
      kind: 'markup',
    });
  }

  // The photography viewer ships its sources as data, so only the frame someone
  // opens is downloaded. These are the higher-resolution versions, fetched on
  // demand rather than with the page.
  const island = /<script[^>]*data-photo-frames[^>]*>([\s\S]*?)<\/script>/i.exec(html);
  const frames = [];
  if (island) {
    try {
      for (const frame of JSON.parse(decode(island[1]))) {
        const rungs = parseSrcset(frame.srcset ?? '');
        if (rungs.length === 0) continue;
        frames.push({
          rungs,
          sizes: frame.sizes ?? '',
          ladder: ladderFor(rungs),
          title: frame.title ?? frame.anchor ?? 'frame',
          kind: 'on-demand',
        });
      }
    } catch (error) {
      console.warn(`  ! Could not read the viewer frames on ${route}: ${error.message}`);
    }
  }

  if (declared !== parsed || truncated > 0) {
    const parts = [];
    if (declared !== parsed) parts.push(`${declared} <img> tags present, ${parsed} matched`);
    if (truncated > 0) parts.push(`${truncated} truncated at a ">" inside a quoted value`);
    unparsed.push(`${route}: ${parts.join('; ')}`);
  }

  if (images.length > 0 || frames.length > 0) pages.push({ route, images, frames });
}

if (pages.length === 0) {
  console.error(
    'measure-image-delivery: no responsive images found in dist/. Run `npm run build` first.',
  );
  process.exit(1);
}

if (unparsed.length > 0) {
  console.error('\nmeasure-image-delivery: some <img> tags could not be read, so the');
  console.error('figures below would be short. Fix the parser rather than trusting them:');
  for (const note of unparsed) console.error(`    ${note}`);
  process.exit(1);
}

// ── Resolve every image against every device ────────────────────────────────

for (const page of pages) {
  for (const image of [...page.images, ...page.frames]) {
    image.picks = {};
    for (const device of DEVICES) {
      const cssWidth = resolveSizes(image.sizes, device.width);
      const required = Math.ceil(cssWidth * device.dpr);
      const rung = chooseRung(image.rungs, required);
      image.picks[device.name] = {
        cssWidth: Math.round(cssWidth),
        required,
        width: rung.width,
        url: rung.url,
        bytes: await bytesOf(rung.url),
        // The ladder tops out below what the screen asks for, so the browser
        // upscales. Often that is correct — the committed master may be no
        // bigger — but it is the first place to look when a frame reads soft.
        capped: image.rungs.length > 1 && rung.width < required,
      };
    }
  }
}

const sum = (images, deviceName) =>
  images.reduce((total, image) => total + image.picks[deviceName].bytes, 0);

const report = pages
  .map((page) => ({
    route: page.route,
    initial: page.images.filter((image) => !image.lazy),
    deferred: page.images.filter((image) => image.lazy),
    frames: page.frames,
  }))
  .sort((a, b) => sum(b.initial, DEVICES[0].name) - sum(a.initial, DEVICES[0].name));

// ── Output ──────────────────────────────────────────────────────────────────

if (AS_JSON) {
  const payload = JSON.stringify(
      {
        devices: DEVICES,
        networks: NETWORKS,
        model: 'smallest srcset rung >= (sizes CSS px x DPR); transfer time is bytes/bandwidth only',
        pages: report.map((page) => ({
          route: page.route,
          initialBytes: Object.fromEntries(DEVICES.map((d) => [d.name, sum(page.initial, d.name)])),
          deferredBytes: Object.fromEntries(DEVICES.map((d) => [d.name, sum(page.deferred, d.name)])),
          onDemandBytesPerFrame: Object.fromEntries(
            DEVICES.map((d) => [
              d.name,
              page.frames.length ? Math.round(sum(page.frames, d.name) / page.frames.length) : 0,
            ]),
          ),
          images: [...page.initial, ...page.deferred, ...page.frames].map((image) => ({
            ladder: image.ladder,
            kind: image.kind,
            lazy: Boolean(image.lazy),
            sizes: image.sizes,
            picks: image.picks,
          })),
        })),
      },
    null,
    2,
  );
  // A bare process.exit() after console.log truncates the payload when stdout
  // is a pipe: the write has been queued but not flushed.
  await new Promise((resolve) => process.stdout.write(`${payload}\n`, resolve));
  process.exit(0);
}

const column = 11;
const LABEL = 30;
const header = ['', ...DEVICES.map((device) => device.name)];
const clip = (text) => (text.length > LABEL - 1 ? `${text.slice(0, LABEL - 2)}…` : text);
const line = (label, cells) =>
  `  ${clip(label).padEnd(LABEL)}${cells.map((cell) => String(cell).padStart(column)).join('')}`;

/** The heaviest few rows, plus a line saying what was left out. */
function top(rows, weigh) {
  if (ALL) return { shown: rows, hidden: 0, hiddenBytes: 0 };
  const sorted = [...rows].sort((a, b) => weigh(b) - weigh(a));
  const shown = sorted.slice(0, TOP_PAGES);
  const rest = sorted.slice(TOP_PAGES);
  return {
    shown,
    hidden: rest.length,
    hiddenBytes: rest.reduce((sum, row) => sum + weigh(row), 0),
  };
}

console.log('\nImage delivery by screen size — modelled from dist/');
console.log('  Rung choice: smallest srcset entry >= (sizes CSS px x DPR).');
console.log('  Times are bytes/bandwidth only — no handshake, slow-start or decode.\n');

if (ladders.length > 0) {
  console.log('  Ladders (src/config/image-ladders.mjs)');
  for (const ladder of ladders) {
    console.log(`    ${ladder.id.padEnd(16)} q${ladder.quality}  ${ladder.widths.join(', ')}`);
  }
  console.log('');
}

const rule = '-'.repeat(LABEL + column * DEVICES.length);
const reference = DEVICES[1].name; // The heaviest common case; used only for ranking.

console.log(line('Initial page images', header.slice(1)));
console.log(`  ${rule}`);
{
  const rows = report.filter((page) => page.initial.length > 0);
  const { shown, hidden, hiddenBytes } = top(rows, (page) => sum(page.initial, reference));
  for (const page of shown) {
    console.log(
      line(
        `${page.route}  (${page.initial.length})`,
        DEVICES.map((device) => kb(sum(page.initial, device.name))),
      ),
    );
  }
  if (hidden > 0) {
    console.log(`  … ${hidden} more route(s), ${kb(hiddenBytes)} on ${reference} — --all to list them`);
  }
}

const deferredPages = report.filter((page) => page.deferred.length > 0);
if (deferredPages.length > 0) {
  console.log(`\n${line('Deferred (lazy) images', header.slice(1))}`);
  console.log(`  ${rule}`);
  const { shown, hidden, hiddenBytes } = top(deferredPages, (page) => sum(page.deferred, reference));
  for (const page of shown) {
    console.log(
      line(
        `${page.route}  (${page.deferred.length})`,
        DEVICES.map((device) => kb(sum(page.deferred, device.name))),
      ),
    );
  }
  if (hidden > 0) {
    console.log(`  … ${hidden} more route(s), ${kb(hiddenBytes)} on ${reference} — --all to list them`);
  }
}

const framePages = report.filter((page) => page.frames.length > 0);
for (const page of framePages) {
  console.log(`\n  Higher-resolution versions — ${page.route} viewer, one frame per open`);
  console.log(`  ${rule}`);
  for (const frame of page.frames) {
    console.log(
      line(
        frame.title.slice(0, 28),
        DEVICES.map((device) => kb(frame.picks[device.name].bytes)),
      ),
    );
  }
  console.log(
    line(
      'rung chosen',
      DEVICES.map((device) => `${page.frames[0].picks[device.name].width}px`),
    ),
  );
}

console.log('\n  Modelled transfer of the initial images, in ms');
console.log(`  ${rule}`);
for (const page of top(report.filter((p) => p.initial.length > 0), (p) => sum(p.initial, reference)).shown) {
  for (const network of NETWORKS) {
    console.log(
      line(
        `${page.route} · ${network.name}`,
        DEVICES.map((device) => ms(sum(page.initial, device.name), network.mbps)),
      ),
    );
  }
}

const capped = [];
for (const page of report) {
  for (const image of [...page.initial, ...page.deferred, ...page.frames]) {
    for (const device of DEVICES) {
      if (image.picks[device.name].capped) {
        capped.push(
          `${page.route} ${image.ladder ?? 'unknown ladder'} on ${device.name}: wants ` +
            `${image.picks[device.name].required}px, ladder tops out at ${image.picks[device.name].width}px`,
        );
      }
    }
  }
}
if (capped.length > 0) {
  console.log('\n  Ladder tops out below the screen (the image is upscaled by the browser):');
  for (const note of [...new Set(capped)]) console.log(`    ${note}`);
}

if (DETAIL) {
  for (const page of report) {
    console.log(`\n  ${page.route} — every image`);
    for (const image of [...page.initial, ...page.deferred, ...page.frames]) {
      const tag = image.kind === 'on-demand' ? 'on-demand' : image.lazy ? 'lazy' : 'initial';
      console.log(`    ${image.ladder ?? 'unknown'} · ${tag} · sizes="${image.sizes}"`);
      for (const device of DEVICES) {
        const pick = image.picks[device.name];
        console.log(
          `      ${device.name.padEnd(12)} ${String(pick.cssWidth).padStart(5)} css px x${device.dpr}` +
            ` -> needs ${String(pick.required).padStart(5)}px -> ${String(pick.width).padStart(5)}px rung` +
            ` ${kb(pick.bytes).padStart(8)}`,
        );
      }
    }
  }
}

console.log('');

if (BUDGET_KB) {
  const budget = Number(BUDGET_KB) * 1024;
  const breaches = [];
  for (const page of report) {
    for (const device of DEVICES) {
      const bytes = sum(page.initial, device.name);
      if (bytes > budget) breaches.push(`${page.route} on ${device.name}: ${kb(bytes)} > ${BUDGET_KB} KB`);
    }
  }
  if (breaches.length > 0) {
    console.error(`  ✗ Initial image budget of ${BUDGET_KB} KB exceeded:`);
    for (const breach of breaches) console.error(`      ${breach}`);
    console.error('');
    process.exit(1);
  }
  console.log(`  ✓ Every page is inside the ${BUDGET_KB} KB initial image budget.\n`);
}
