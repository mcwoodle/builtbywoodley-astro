// The event dictionary, in one place, as data.
//
// This file is the contract docs/front-end-analytics-design.md describes under
// "Event dictionary". It exists as code rather than as prose in a comment
// because the delegated click handler reads it at runtime: a `data-analytics-*`
// attribute naming a property this table does not declare is dropped, so the
// payload cannot widen by accident when a component is edited.
//
// Two naming conventions are in play and should stay distinct:
//   - interaction events are past-tense verbs  (chapter_viewed, photo_zoom_used)
//   - measurement snapshots are nouns          (page_load_timing, image_cost)
//
// All durations are whole milliseconds. All byte counts are kilobytes rounded
// to the nearest 100. Web vitals are deliberately absent: they arrive under
// PostHog's own $web_vitals_* properties, and duplicating them here would
// create two numbers that disagree.

/**
 * Click-driven events and the properties each is allowed to carry.
 *
 * Everything here is low-cardinality and derived at render time from a slug or
 * a fixed string — never from DOM content. No event carries a URL, a title, a
 * label or an email address.
 */
export const CLICK_EVENTS = {
  /** A move between the site's places. `software` / `top-nav`. */
  navigation_clicked: ['destination', 'placement'],
  /** The site's only conversion. `email` / `home-contact`. */
  contact_clicked: ['method', 'placement'],
  /**
   * A project was opened. `kind` is one of `case-study` (the card, into the
   * write-up), `repo` or `live` — the two outbound links on the write-up
   * itself. `project` is the content slug, derived at render time; the title
   * and the full URL never travel.
   */
  project_link_clicked: ['project', 'kind'],
  /** A named control was activated. `theme` / `dark`, `photo-step` / `next`. */
  control_used: ['control', 'value'],
  /** One of the two provenance marks was opened. `ai-generated`. */
  disclosure_opened: ['kind'],
} as const satisfies Record<string, readonly string[]>;

export type ClickEvent = keyof typeof CLICK_EVENTS;

export function isClickEvent(name: string): name is ClickEvent {
  return Object.prototype.hasOwnProperty.call(CLICK_EVENTS, name);
}

/**
 * The capture surface shared by this module's consumers.
 *
 * `perf.ts` is handed one of these rather than importing the client directly,
 * so the timing code has no opinion about whether analytics is loaded, opted
 * out of, or absent entirely.
 */
export type AnalyticsCapture = (
  event: string,
  properties?: Record<string, string | number | boolean>,
  options?: { send_instantly?: boolean },
) => void;
