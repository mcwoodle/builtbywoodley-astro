/**
 * Where the suite is pointed, and what that implies about what can be asserted.
 *
 * The specs themselves never read process.env — they take baseURL from the
 * Playwright config. This module exists only for the handful of assertions
 * whose validity depends on *who is serving* rather than on what the site does.
 */

/**
 * True when the suite is pointed at a real Cloudflare origin.
 *
 * `public/_headers` is a Cloudflare directive, not something Astro implements:
 * `astro build` copies the file into dist/ and `astro preview` then serves it
 * as a static asset without ever reading it. So the security headers only
 * actually exist on a deployed origin — a preview version or production — and
 * asserting on them anywhere else would fail for the wrong reason.
 */
export const isEdgeTarget = /^https:\/\//.test(process.env.SMOKE_BASE_URL ?? '');
