// The measurement layer: what a visitor reached, what they activated, and what
// the page cost them. Nothing about who they are.
//
// This module ships on every page and is deliberately small. It is a gate, not
// the SDK: `posthog-js` lives behind a dynamic import that only runs once a
// visitor has passed the consent checks below, so someone who has opted out —
// or who sends Global Privacy Control — never downloads it at all. That
// ordering is the point, and it is why the checks are here rather than in
// PostHog's own `respect_dnt`, which can only act after the bytes have landed.
//
// Read docs/front-end-analytics-design.md for the requirements this satisfies
// and the alternatives it rejects. The short version:
//
//   - Cookieless server-hash mode. No cookie, no localStorage, no visitor ID.
//     The only thing this site persists is the opt-out preference below.
//   - No autocapture. Every click that is measured is one a component was
//     explicitly annotated for, and only allowlisted properties travel.
//   - Same-origin ingest through /sawdust, so `connect-src 'self'` is unchanged
//     and a vendor-domain blocklist does not silently bias the data.

import type { PostHog } from 'posthog-js';
import type { AnalyticsCapture } from './analytics-events';
import { CLICK_EVENTS, isClickEvent } from './analytics-events';

/**
 * The only key this site is allowed to persist (P1), and it is named in the
 * disclosure at /privacy. It holds a visitor's own choice, never an identifier.
 */
const OPT_OUT_KEY = 'analytics-opt-out';

/** Where the PostHog UI lives, for the SDK's own "view in PostHog" links. */
const POSTHOG_UI_HOST = 'https://us.posthog.com';

/**
 * The band a chapter's leading edge has to reach before it counts as read.
 * Pulling the bottom up means a section registers when it has actually arrived
 * on screen rather than when one pixel of it peeks over the fold.
 *
 * A percentage rather than a threshold: About and Work are routinely taller
 * than twice the viewport, and a 0.5 threshold can never fire for a section
 * that big. Tune this against the real pinned archive on desktop and mobile
 * before trusting the numbers — see the risks section of the design doc.
 */
const CHAPTER_BAND = '0px 0px -25% 0px';

const KEY = import.meta.env.PUBLIC_POSTHOG_KEY;
const ENABLED = import.meta.env.PUBLIC_ANALYTICS_ENABLED === 'true';

// ── Consent ────────────────────────────────────────────────────────────────

/**
 * Global Privacy Control, and Do Not Track on a best-effort basis.
 *
 * GPC is a considered legal signal and is honoured outright. DNT is honoured
 * too, even though the browsers that still send it disagree about what it
 * means: the cost of over-honouring it is a few missing rows, and this site can
 * afford that far more easily than it can afford ignoring someone who asked.
 */
function signalsRefusal(): boolean {
  const nav = navigator as Navigator & {
    globalPrivacyControl?: boolean;
    msDoNotTrack?: string;
  };
  if (nav.globalPrivacyControl === true) return true;

  const dnt =
    nav.doNotTrack ??
    nav.msDoNotTrack ??
    (window as Window & { doNotTrack?: string }).doNotTrack;
  return dnt === '1' || dnt === 'yes';
}

/** Whether this visitor has turned analytics off on this site. */
export function isOptedOut(): boolean {
  try {
    return localStorage.getItem(OPT_OUT_KEY) === '1';
  } catch {
    // Storage blocked. Treat it as "no stored preference" rather than as a
    // refusal — the GPC and DNT checks above are the ones that carry intent.
    return false;
  }
}

/** Whether analytics could run for this visitor at all, before their own choice. */
export function isAvailable(): boolean {
  return ENABLED && Boolean(KEY) && !signalsRefusal();
}

let client: PostHog | null = null;
let stopped = false;

/**
 * Turn collection on or off, and have it take effect now rather than on the
 * next hard load (P3). Opting out mid-visit stops the queue, tells the SDK to
 * stop, and leaves nothing of PostHog's behind; opting back in starts the SDK
 * if this page never loaded it.
 */
export function setOptedOut(optedOut: boolean): void {
  try {
    if (optedOut) localStorage.setItem(OPT_OUT_KEY, '1');
    else localStorage.removeItem(OPT_OUT_KEY);
  } catch {
    // The choice still applies for the rest of this visit; it just will not
    // survive a reload. Better than failing the click outright.
  }

  stopped = optedOut;
  if (optedOut) {
    queue.length = 0;
    client?.opt_out_capturing();
    // Server-hash mode writes nothing, but a build that once ran with a
    // different configuration might have. Clearing costs nothing and makes the
    // promise at /privacy true regardless of what came before.
    try {
      localStorage.removeItem('ph_' + KEY + '_posthog');
    } catch {
      // Nothing to clear, or no storage to clear it from.
    }
    return;
  }

  if (client) client.opt_in_capturing();
  else if (isAvailable()) void startClient();
}

// ── Capture ────────────────────────────────────────────────────────────────

type Queued = Parameters<AnalyticsCapture>;

/**
 * Events raised before the SDK finished loading. The import is prompt rather
 * than idle-deferred precisely so this stays short, but "short" is not "zero":
 * a visitor who clicks the email CTA immediately is exactly the visitor worth
 * counting, and dropping their click would bias the site's only conversion.
 */
const queue: Queued[] = [];

export const capture: AnalyticsCapture = (event, properties, options) => {
  if (stopped) return;
  if (client) {
    client.capture(event, properties, options);
    return;
  }
  // Bounded, so a page where the SDK never arrives cannot grow this without
  // limit. Fifty events is far more than any real visit produces.
  if (queue.length < 50) queue.push([event, properties, options]);
};

// ── The SDK ────────────────────────────────────────────────────────────────

let starting: Promise<void> | null = null;

/**
 * Load and initialise PostHog exactly once per browser visit, however many
 * callers ask. The promise is the guard: concurrent calls await the same one
 * rather than racing two `init`s.
 */
function startClient(): Promise<void> {
  starting ??= (async () => {
    try {
      const { default: posthog } = await import('posthog-js');
      if (stopped) return;

      posthog.init(KEY as string, {
        // Same-origin. The Worker at /sawdust forwards to PostHog, so
        // `connect-src 'self'` needs no exception and no blocklist matches.
        api_host: '/sawdust',
        ui_host: POSTHOG_UI_HOST,
        defaults: '2026-05-30',

        // ── The privacy-critical four ──
        // Identity is a hash PostHog computes server-side and rotates; nothing
        // durable is written to this browser. `person_profiles: 'never'`
        // governs profile processing, which is a separate question from
        // storage — both answers are needed.
        cookieless_mode: 'always',
        person_profiles: 'never',
        // Autocapture would ship link text, class lists, element ancestry and
        // href values — including the mailto: address that is this site's only
        // conversion. Every measured click is annotated instead.
        autocapture: false,
        respect_dnt: true,

        // ── Astro's ClientRouter ──
        // Pageviews follow history.pushState, because most navigations on this
        // site never fire `load`.
        capture_pageview: 'history_change',
        capture_pageleave: true,

        // ── Everything this site does not do ──
        disable_session_recording: true,
        disable_surveys: true,
        capture_heatmaps: false,
        capture_dead_clicks: false,
        capture_exceptions: false,
        rageclick: false,

        // The one capture flag deliberately left on: R6 depends on it. The
        // object form is what makes that safe — `web_vitals` is a bounded set
        // of numbers per hard load, while `network_timing` would send a
        // resource-timing entry, carrying a URL, for every asset on the page.
        // On a gallery page that is both a privacy problem and most of the
        // free-tier event budget.
        capture_performance: { web_vitals: true, network_timing: false },
      });

      client = posthog;
      for (const [event, properties, options] of queue.splice(0)) {
        posthog.capture(event, properties, options);
      }

      const { startPerf } = await import('./perf');
      startPerf(capture);
    } catch (error) {
      // A blocked or failed SDK must never take the page with it. Analytics is
      // the least important thing on this site by a wide margin.
      console.warn('analytics failed to start', error);
    }
  })();
  return starting;
}

// ── Annotated clicks (R1) ──────────────────────────────────────────────────

/**
 * Copy the allowlisted properties for this event, and nothing else.
 *
 * "Nothing else" is the requirement doing the work here (P2): no text content,
 * no class list, no element ancestry, no href. An annotation that names a
 * property the event does not declare is ignored rather than forwarded, so a
 * future edit cannot quietly widen the payload.
 */
function propertiesFor(event: string, element: HTMLElement) {
  if (!isClickEvent(event)) return null;
  const allowed = CLICK_EVENTS[event];
  const properties: Record<string, string> = {};
  for (const name of allowed) {
    const value = element.dataset[`analytics${name[0].toUpperCase()}${name.slice(1)}`];
    if (value) properties[name] = value;
  }
  return properties;
}

function onClick(event: MouseEvent) {
  if (stopped) return;
  const target = event.target instanceof Element ? event.target : null;
  const annotated = target?.closest<HTMLElement>('[data-analytics-event]');
  if (!annotated) return;

  const name = annotated.dataset.analyticsEvent;
  if (!name) return;

  // A disclosure toggles, so only the opening half is a disclosure_opened.
  // This listener runs in the capture phase, before the components' own
  // bubble-phase handlers, so aria-expanded still holds the pre-click state.
  if (name === 'disclosure_opened' && annotated.getAttribute('aria-expanded') !== 'false') {
    return;
  }

  const properties = propertiesFor(name, annotated);
  if (!properties) return;

  // `send_instantly` keeps the request alive across the navigation this click
  // is probably about to cause — the mailto: CTA above all, which hands
  // control to a mail client. Without it the event sits in a batch that the
  // page may never live long enough to flush.
  capture(name, properties, { send_instantly: true });
}

// ── Chapters (R4) ──────────────────────────────────────────────────────────

let chapterObserver: IntersectionObserver | null = null;

function stopChapters() {
  chapterObserver?.disconnect();
  chapterObserver = null;
}

/**
 * Count each named chapter once per Home pageview.
 *
 * Rebuilt on every page load rather than guarded after the first, because a
 * visitor who leaves Home and comes back is on a new pageview and the second
 * visit's reading depth is as real as the first's. The `seen` set is local to
 * this call for the same reason.
 *
 * An IntersectionObserver creates no motion, so this runs for everyone — it is
 * deliberately not nested inside a reduced-motion guard (C7).
 */
function startChapters() {
  stopChapters();
  const chapters = document.querySelectorAll<HTMLElement>('[data-analytics-chapter]');
  if (chapters.length === 0) return;

  const seen = new Set<string>();
  chapterObserver = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const chapter = (entry.target as HTMLElement).dataset.analyticsChapter;
        if (!chapter || seen.has(chapter)) continue;
        seen.add(chapter);
        capture('chapter_viewed', { chapter });
      }
    },
    { threshold: 0, rootMargin: CHAPTER_BAND },
  );

  for (const chapter of chapters) chapterObserver.observe(chapter);
}

// ── Theme (R1) ─────────────────────────────────────────────────────────────

/**
 * The theme value comes from the resulting `themechange`, not the click: the
 * button cycles, so a click on it does not say which of the three modes the
 * visitor landed on. The toggle marks its own event so an OS-level switch —
 * which fires the same event in system mode — is not recorded as a control the
 * visitor used.
 */
function onThemeChange(event: Event) {
  const detail = (event as CustomEvent<{ mode?: string; source?: string }>).detail;
  if (detail?.source !== 'toggle' || !detail.mode) return;
  capture('control_used', { control: 'theme', value: detail.mode });
}

// ── The photo viewer (R7) ──────────────────────────────────────────────────

/**
 * The viewer reports its own latency as DOM events, and this is where they are
 * picked up.
 *
 * These belong to the timing work in perf.ts by subject, but they cannot live
 * there by timing. A deep link — /photography#some-frame — opens the panel
 * about one frame after the page's modules evaluate, whereas perf.ts is behind
 * a network fetch of the SDK and arrives hundreds of milliseconds later. A
 * listener attached there misses every shared link, which is precisely the
 * arrival worth measuring. Attached here, it is in place during the same tick
 * as the viewer itself.
 *
 * The queue above absorbs the rest of the gap: the event is recorded now and
 * sent when the SDK lands. Cancelled interactions never arrive at all — the
 * viewer drops them rather than reporting an interaction that never finished
 * as a fast one.
 */
function onPhotoTiming(name: string) {
  return (event: Event) => {
    const detail = (event as CustomEvent<Record<string, string | number | boolean>>).detail;
    if (detail) capture(name, detail);
  };
}

// ── Lifecycle ──────────────────────────────────────────────────────────────

const bound = '__analyticsBound';
if (!(bound in window)) {
  (window as Record<string, unknown>)[bound] = true;

  stopped = isOptedOut();

  if (isAvailable()) {
    // Installed once, in the capture phase, and never rebuilt: it is delegated
    // from the document, so it survives every ClientRouter swap underneath it.
    // Capture phase means it still sees clicks that a component handler goes on
    // to cancel, and gets the earliest possible start on a navigating click.
    document.addEventListener('click', onClick, true);
    window.addEventListener('themechange', onThemeChange);
    document.addEventListener('photo:opened', onPhotoTiming('photo_viewer_opened'));
    document.addEventListener('photo:zoomed', onPhotoTiming('photo_zoom_used'));

    // Page-scoped work is rebuilt per navigation, following the same lifecycle
    // home-scroll.ts and storyscroll.ts use.
    document.addEventListener('astro:before-swap', stopChapters);
    document.addEventListener('astro:page-load', () => {
      if (stopped) return;
      // Prompt rather than idle-deferred. Up to two seconds of
      // requestIdleCallback would undercount short visits, early clicks,
      // initial dwell and quickly-passed chapters — which is most of what this
      // is here to measure.
      void startClient();
      startChapters();
    });
  }
}
