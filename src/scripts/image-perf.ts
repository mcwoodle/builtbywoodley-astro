// The image probe: what THIS browser, on THIS screen, actually chose for every
// <img> on the page, and what it cost.
//
// Loaded on demand. src/components/ImagePerfProbe.astro ships a few hundred
// bytes of loader on every page and only imports this module when someone asks
// for it with ?stats=true, so the cost to a normal visit is the loader and
// nothing else. Everything here — the panel, its styles, the observers — is
// built at runtime for the same reason: none of it should sit in the HTML of a
// page that never shows it.
//
// scripts/measure-image-delivery.mjs models the same numbers from dist/ and is
// the right tool for comparing builds. This is the one that answers "but what
// does my phone really do", because it reads currentSrc — the rung the browser
// picked after weighing DPR, the connection and its own cache — rather than
// predicting it.
//
// The arithmetic itself lives in src/lib/image-cost.ts, shared with the
// analytics layer so the panel below and the image_cost event cannot drift into
// reporting two different answers for the same page. What stays here is
// everything that makes this a debugging tool: the panel, its styles, the
// console tables and the LCP observer.

import {
  collectShots,
  observeImageTimings,
  whenImagesSettle,
  type Shot,
} from '../lib/image-cost';

const HUD_STYLE = `  .image-perf-hud {
    position: fixed;
    right: 12px;
    bottom: 12px;
    z-index: 9999;
    max-width: 300px;
    padding: 10px 12px;
    border-radius: 8px;
    background: rgb(24 30 33 / 0.94);
    color: #ede9e1;
    font-family: 'DM Mono', ui-monospace, monospace;
    font-size: 11px;
    line-height: 1.5;
    box-shadow: 0 8px 30px rgb(0 0 0 / 0.35);
  }

  .image-perf-hud[hidden] {
    display: none;
  }

  .image-perf-hud dl {
    display: grid;
    grid-template-columns: auto 1fr;
    gap: 1px 10px;
    margin: 0;
  }

  .image-perf-hud dt {
    opacity: 0.62;
  }

  .image-perf-hud dd {
    margin: 0;
    text-align: right;
  }

  .image-perf-hud button {
    position: absolute;
    top: 4px;
    right: 6px;
    padding: 0 4px;
    border: 0;
    background: none;
    color: inherit;
    opacity: 0.5;
    font: inherit;
    cursor: pointer;
  }

  .image-perf-hud button:hover {
    opacity: 1;
  }`;

/** Build the panel and its styles. Nothing of this exists until it is asked for. */
function mountHud() {
  if (document.querySelector('[data-image-perf]')) return;

  const style = document.createElement('style');
  style.dataset.imagePerfStyle = '';
  style.textContent = HUD_STYLE;
  document.head.append(style);

  const hud = document.createElement('div');
  hud.className = 'image-perf-hud';
  hud.dataset.imagePerf = '';
  hud.hidden = true;

  const close = document.createElement('button');
  close.type = 'button';
  close.dataset.imagePerfClose = '';
  close.setAttribute('aria-label', 'Hide image probe');
  close.textContent = 'x';

  const list = document.createElement('dl');
  list.dataset.imagePerfBody = '';

  hud.append(close, list);
  document.body.append(hud);
}


const bound = '__imagePerfBound';
if (!(bound in window)) {
  (window as Record<string, unknown>)[bound] = true;
  mountHud();
  start();
}

function start() {
  const timings = observeImageTimings();
  let lcp: { url: string; ms: number } | null = null;

  // The one observer that stays here: LCP is a debugging number for the panel,
  // and the field version arrives through PostHog's own web-vitals capture
  // rather than through this file.
  try {
    new PerformanceObserver((list) => {
      const entries = list.getEntries();
      const last = entries[entries.length - 1] as PerformanceEntry & { url?: string };
      if (last) lcp = { url: last.url ?? '', ms: Math.round(last.startTime) };
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    // An unsupported entry type is not worth breaking a debug build over.
  }

  const collect = (): Shot[] => collectShots(timings);

  function paint() {
    const shots = collect();
    const initial = shots.filter((shot) => !shot.lazy);
    const total = (list: Shot[]) => list.reduce((sum, shot) => sum + shot.bytes, 0);
    const kb = (bytes: number) => `${Math.round(bytes / 1024)} KB`;
    const cachedCount = shots.filter((shot) => shot.cached).length;

    const summary = {
      viewport: `${window.innerWidth}x${window.innerHeight} css px`,
      dpr: window.devicePixelRatio,
      images: shots.length,
      'initial (eager)': `${initial.length} · ${kb(total(initial))}`,
      'all images': kb(total(shots)),
      'served from cache': cachedCount,
      LCP: lcp ? `${lcp.ms} ms` : 'not an image, or not yet',
    };

    console.groupCollapsed(
      `%cimage probe%c ${window.innerWidth}px @${window.devicePixelRatio}x — ` +
        `${initial.length} eager, ${kb(total(initial))}${cachedCount ? ` (${cachedCount} cached)` : ''}`,
      'background:#181e21;color:#ede9e1;padding:2px 6px;border-radius:3px',
      '',
    );
    console.table(summary);
    console.table(
      shots.map((shot) => ({
        ladder: shot.ladder,
        rung: shot.rung,
        'laid out': shot.layout,
        'needs (css x dpr)': Math.ceil(shot.layout * shot.dpr),
        KB: Math.round(shot.bytes / 1024),
        ms: shot.ms,
        cached: shot.cached,
        lazy: shot.lazy,
        file: shot.chosen,
      })),
    );
    if (cachedCount > 0) {
      console.info(
        'Some images came from cache, so their timings are not transfer times. ' +
          'Reload with the cache disabled for numbers you can compare.',
      );
    }
    console.groupEnd();

    (window as Record<string, unknown>).__imagePerf = { summary, shots, lcp };

    const hud = document.querySelector<HTMLElement>('[data-image-perf]');
    const body = document.querySelector<HTMLElement>('[data-image-perf-body]');
    if (!hud || !body) return;
    hud.hidden = false;
    body.innerHTML = Object.entries(summary)
      .map(([key, value]) => `<dt>${key}</dt><dd>${value}</dd>`)
      .join('');
  }

  /** Wait for the images actually to be in, then report. */
  const schedule = () => whenImagesSettle(paint);

  document.addEventListener('click', (event) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest('[data-image-perf-close]')) {
      const hud = document.querySelector<HTMLElement>('[data-image-perf]');
      if (hud) hud.hidden = true;
    }
  });

  // Re-report on demand: the whole point is to see a different screen size
  // pick a different rung, and the viewer's higher-resolution frame arrives
  // long after load.
  window.addEventListener('keydown', (event) => {
    if (event.shiftKey && event.key.toLowerCase() === 'p') paint();
  });

  let resizeTimer: number | undefined;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(paint, 400);
  });

  if (document.readyState === 'complete') schedule();
  else window.addEventListener('load', schedule, { once: true });
  document.addEventListener('astro:page-load', schedule);
}
