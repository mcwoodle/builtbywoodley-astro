// What the page cost a real device (R6), and what the photo viewer cost a real
// finger (R7).
//
// Four sources, deliberately kept apart because they answer different questions
// and fail in different ways:
//
//   1. Web vitals          — posthog-js itself, via capture_performance. No code
//                            here at all; they arrive under $web_vitals_*.
//   2. page_load_timing    — navigation timing and long tasks, one per pageview,
//                            with hard loads and ClientRouter swaps kept apart.
//   3. image_cost          — one bucketed summary per pageview.
//   4. photo_viewer_opened — the viewer's own two-stage decode. Reported by the
//      / photo_zoom_used     viewer as DOM events, but listened for in
//                            analytics.ts rather than here — see below.
//
// Loaded only after the SDK is up, and handed a `capture` rather than importing
// the client, so nothing in this file has an opinion about whether analytics is
// running.
//
// MISSING IS NOT ZERO. Support for these entry types differs across browsers
// and some are absent in Safari. Where a metric is unavailable the property is
// omitted — a zero would be indistinguishable from an instantaneous load and
// would quietly drag every average down.

import type { AnalyticsCapture } from './analytics-events';
import {
  collectShots,
  observeImageTimings,
  summariseImageCost,
  whenImagesSettle,
} from '../lib/image-cost';

/**
 * What fraction of pageviews report their image cost. 1 is all of them.
 *
 * A lever rather than a constant of nature: at this site's traffic the whole
 * population is comfortably inside the free tier, but if that stops being true
 * this is the first number to turn down, and page_load_timing is the second.
 */
const IMAGE_COST_SAMPLE = 1;

type Timing = Record<string, string | number | boolean>;

/** Whole milliseconds, and only when the browser actually gave us a number. */
function ms(value: number | undefined | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.round(value);
}

/** Add a property only if it was measured. See "missing is not zero" above. */
function put(target: Timing, key: string, value: number | null) {
  if (value !== null) target[key] = value;
}

export function startPerf(capture: AnalyticsCapture): void {
  // ── Long tasks ───────────────────────────────────────────────────────────
  // The number that says whether this analytics layer cost frames during the
  // Home reveal. Buffered, so tasks that ran before the SDK finished loading —
  // which is exactly the window worth knowing about — are counted too.
  let longTaskMs = 0;
  let longTaskCount = 0;
  // Whether the browser actually reports long tasks. Without this flag a page
  // that genuinely had none and a Safari that cannot measure them both look
  // like zero — and one of those is a real measurement worth keeping.
  let longTaskSupported = false;
  try {
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTaskMs += entry.duration;
        longTaskCount += 1;
      }
    }).observe({ type: 'longtask', buffered: true });
    longTaskSupported = true;
  } catch {
    // Not supported here (Safari, notably). The properties are simply omitted.
  }

  /** Long-task totals at the start of the current navigation. */
  let longTaskBaseline = 0;
  let longTaskCountBaseline = 0;

  function longTaskProperties(sinceMs: number, sinceCount: number): Timing {
    if (!longTaskSupported) return {};
    return {
      long_task_ms: Math.round(longTaskMs - sinceMs),
      long_task_count: longTaskCount - sinceCount,
    };
  }

  // ── 2a. The hard load ────────────────────────────────────────────────────
  //
  // "Fully loaded" is a weaker claim than it sounds on this site: `load` fires
  // when subresources finish, while the landing page goes on building GSAP
  // timelines and a Lenis loop afterwards. That gap is why long_task_ms sits
  // beside these two rather than being left to the vitals.
  function reportHardLoad() {
    const [entry] = performance.getEntriesByType(
      'navigation',
    ) as PerformanceNavigationTiming[];
    const timing: Timing = { nav_type: 'hard', ...longTaskProperties(0, 0) };
    if (entry) {
      put(timing, 'load_ms', ms(entry.loadEventEnd));
      put(timing, 'dom_content_loaded_ms', ms(entry.domContentLoadedEventEnd));
    }
    capture('page_load_timing', timing);
    longTaskBaseline = longTaskMs;
    longTaskCountBaseline = longTaskCount;
  }

  // ── 2b. ClientRouter soft navigations ────────────────────────────────────
  //
  // FCP and LCP are hard-load metrics: they do not re-fire on a pushState swap.
  // Recording a soft-nav render time under a vitals property name would
  // silently corrupt both populations, so this travels as its own property on
  // its own event, and nav_type is what keeps the two apart on every card.
  let softStart: number | null = null;
  let softRenderMs: number | null = null;

  document.addEventListener('astro:before-preparation', () => {
    softStart = performance.now();
    softRenderMs = null;
    longTaskBaseline = longTaskMs;
    longTaskCountBaseline = longTaskCount;
  });

  document.addEventListener('astro:after-swap', () => {
    if (softStart === null) return;
    const started = softStart;
    // The first frame after the swap is the one the visitor sees. `after-swap`
    // itself is still before paint.
    requestAnimationFrame(() => {
      softRenderMs = Math.round(performance.now() - started);
    });
  });

  // ── 3. Image cost ────────────────────────────────────────────────────────
  const timings = observeImageTimings();

  function reportImageCost() {
    if (Math.random() >= IMAGE_COST_SAMPLE) return;
    whenImagesSettle(() => {
      const cost = summariseImageCost(collectShots(timings));
      if (cost) capture('image_cost', cost);
    });
  }

  // ── 4. The photo viewer ──────────────────────────────────────────────────
  //
  // Not here. The viewer's timings are picked up in analytics.ts instead,
  // because a deep link opens the panel roughly one frame after the page's
  // modules evaluate — long before this module, which waits on a network
  // fetch of the SDK, could have attached a listener. See the note there.

  // ── Wiring ───────────────────────────────────────────────────────────────
  //
  // One page_load_timing per pageview. This module is imported during the first
  // astro:page-load it is enabled for, so that event has already fired by the
  // time the listener below exists: the page in front of us right now is the
  // initial one, and every astro:page-load the listener does receive is a
  // ClientRouter swap.
  //
  // "Initial" is not always "hard", though. A visitor who opts in from the
  // privacy page three navigations deep starts the SDK on a page that arrived
  // by pushState, and the navigation entry still describes the document they
  // originally landed on. Comparing the two is what keeps that visit out of the
  // hard-load population instead of poisoning it with someone else's numbers.
  // Compared by pathname rather than by full URL: the photo viewer strips the
  // hash from a deep link when the panel is closed, and a href comparison would
  // then read that as "we have navigated away" and drop a real hard load's
  // timings. A hash is not a navigation; a pathname change is.
  const navigationEntry = performance.getEntriesByType(
    'navigation',
  )[0] as PerformanceNavigationTiming | undefined;
  let stillOnInitialDocument = false;
  try {
    stillOnInitialDocument =
      !!navigationEntry && new URL(navigationEntry.name).pathname === location.pathname;
  } catch {
    // An unparseable entry name is not worth losing the rest of the report over.
  }

  reportImageCost();
  if (stillOnInitialDocument) {
    // loadEventEnd is still 0 until the load event has finished, so a
    // navigation entry read too early reports a page that never loaded.
    if (document.readyState === 'complete') reportHardLoad();
    else window.addEventListener('load', () => reportHardLoad(), { once: true });
  }

  document.addEventListener('astro:page-load', () => {
    // Sent from inside a frame, not directly, because astro:page-load fires
    // BEFORE the frame the swap painted. The after-swap handler above has
    // already queued its own callback for that frame, and callbacks run in the
    // order they were queued — so by the time this one runs, render_ms exists.
    // Reading it synchronously here would have found null every time and
    // omitted the one property the soft-nav event is for.
    requestAnimationFrame(() => {
      const timing: Timing = {
        nav_type: 'soft',
        ...longTaskProperties(longTaskBaseline, longTaskCountBaseline),
      };
      // A swap that still produced no frame leaves this unset; the property is
      // omitted rather than sent as zero.
      put(timing, 'render_ms', softRenderMs);
      capture('page_load_timing', timing);
      softStart = null;
    });
    reportImageCost();
  });
}
