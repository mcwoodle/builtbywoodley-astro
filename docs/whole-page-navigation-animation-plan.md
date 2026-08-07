# Robust whole-page navigation animation plan

Status: proposed; this document does not authorize or implement the redesign.

Last reviewed: 2026-08-07

## Outcome

Keep the site as a static, multi-page Astro application and make navigation
motion a progressive visual enhancement. Chromium and WebKit should use native
cross-document View Transitions. Firefox and older browsers should keep real
document navigation and receive a deliberately simpler whole-page exit/entry
effect when it can be applied safely. A failed or skipped animation must never
delay, cancel, duplicate, or change a navigation.

This trades identical choreography in every engine for reliable navigation and
normal browser semantics in every engine. In particular, it avoids turning the
site into a client-side router solely to reproduce native snapshot behavior in
Firefox.

## Platform baseline

Cross-document View Transitions are an enhancement around an underlying state
change; the specification explicitly says transition failure must not prevent
that change. They require eligible, same-origin documents which both opt in.
The lifecycle exposes the outgoing `pageswap` and incoming `pagereveal` events,
and each document has a different `ViewTransition` object. The incoming handler
must be registered before the first rendering opportunity. See the
[CSS View Transitions Level 2 lifecycle](https://drafts.csswg.org/css-view-transitions-2/#cross-doc-lifecycle)
and [Chromium's cross-document guide](https://developer.chrome.com/docs/web-platform/view-transitions/cross-document).

As of this review:

| Engine | Cross-document baseline | Planned tier |
| --- | --- | --- |
| Chromium (Chrome/Edge 126+) | `@view-transition`, `pageswap`, `pagereveal`, and transition types are available. | Native directional transition. |
| WebKit (Safari/iOS 18.2+) | WebKit shipped cross-document transitions, lifecycle events, and types in Safari 18.2. | Native directional transition, verified independently on macOS and iOS. |
| Gecko (Firefox) | Same-document View Transitions are available in current Firefox, but `@view-transition`, `PageSwapEvent`, and `PageRevealEvent` remain unsupported. | Split exit/entry fallback, or no motion. |
| Older/unknown engines | No capability assumed. | Ordinary document navigation. |

The support statements above are based on the current Mozilla browser
compatibility data for [`@view-transition`](https://github.com/mdn/browser-compat-data/blob/main/css/at-rules/view-transition.json),
[`PageSwapEvent`](https://github.com/mdn/browser-compat-data/blob/main/api/PageSwapEvent.json),
and [`PageRevealEvent`](https://github.com/mdn/browser-compat-data/blob/main/api/PageRevealEvent.json),
plus [WebKit's Safari 18.2 release notes](https://webkit.org/blog/16301/webkit-features-in-safari-18-2/).
Support must be rechecked when implementation begins; it must not be encoded as
a permanent user-agent table.

## Current implementation

The useful foundation is:

- `src/styles/view-transitions.css` centrally opts every page into native
  cross-document transitions and defines root slides, reduced-motion rules,
  and the `home-mark`, `arrow-fly`, `tagline`, and `nav-crumb` shared groups.
- `src/layouts/BaseLayout.astro` establishes the theme and `--vt-bg` before
  first paint, renders a stable `.vt-page-backdrop`, and loads transition CSS
  on every route.
- `src/styles/global.css` reserves a stable scrollbar gutter and supplies a
  consistent document canvas.
- `wrangler.jsonc` serves canonical no-trailing-slash routes directly, avoiding
  an unnecessary redirect between the site's own links and built pages.
- The route-grid concept correctly expresses Home/About as vertical neighbors
  and Home/section/detail as horizontal depth.
- Named elements in `src/components/TopNav.astro` and the homepage provide
  meaningful continuity when native snapshots work.

The fragile parts are:

- `src/content.config.ts` mixes browser animation policy into content schema
  configuration and selects behavior by user-agent regular expressions. It
  forces Edge onto a fallback even though current Edge supports the native
  Chromium path.
- The inline script in `src/layouts/BaseLayout.astro` owns theme setup plus more
  than 400 lines of navigation code. The fallback eagerly fetches documents and
  their assets, parses and sanitizes HTML with regular expressions and
  `DOMParser`, clones styles and an entire body into a second DOM, and waits for
  animation events/timeouts before assigning `location.href`.
- The cloned preview can have duplicate IDs, stale styles, inert-looking but
  semantically duplicated content, missing page scripts, and different behavior
  from the document that eventually loads. It also adds a 24-document cache and
  broad idle/pointer/focus prefetching to a small static site.
- Direction/type handlers are duplicated across `src/pages/index.astro`,
  `src/pages/about.astro`, `src/pages/software/index.astro`,
  `src/pages/mocked/blog/index.astro`, and
  `src/layouts/SoftwarePageLayout.astro`. They treat every `traverse` as back,
  even though forward navigation is also a traversal, and coverage differs by
  route.
- CSS uses broad pseudo-element overrides and relies on exact timing between
  independently installed page scripts. The body fallback uses full-viewport
  transforms, global pointer suppression, `animationend`, and a 480 ms timer as
  navigation control flow.
- `src/scripts/storyscroll.ts` is imported on every page and sets
  `history.scrollRestoration = 'manual'` before it knows whether the page has a
  carousel. Its `replaceState` calls also replace, rather than merge, other
  history state. Both behaviors will conflict with a central transition
  coordinator.

## Target architecture

### One route relationship resolver

Create a side-effect-free transition model outside `content.config.ts`, for
example `src/scripts/navigation-transitions/route-model.ts`. It should:

- Normalize only same-origin URLs and preserve search/hash for navigation.
- Classify `/`, `/about`, `/software`, `/software/:slug`, `/blog`,
  `/blog/projects/:slug`, mocked equivalents, the full-window map, 404, and an
  `unknown` category.
- Return a relationship such as `left`, `right`, `up`, `down`, `neutral`, or
  `none` from the actual source and final destination URLs.
- Return optional shared-element roles separately from page direction.
- Treat query-only, hash-only, download, external, non-HTTP, targeted, modified,
  and same-document links as native browser behavior, not animated navigation.
- Prefer geometry derived from source/destination routes. A small per-history-
  entry sequence may label traverse-back versus traverse-forward for diagnostics,
  but it must not be the sole source of visual direction.

The model becomes the single table unit-tested for every supported route pair.
Exceptional links may request `data-transition="none"` or a documented
relationship override; arbitrary page-local direction scripts should disappear.

### A small early lifecycle coordinator

Extract animation work from the theme bootstrap. A dedicated head component,
for example `src/components/NavigationTransitionHead.astro`, should install the
minimum classic, parser-blocking listener needed for `pagereveal`, while bundled
modules can perform non-critical work later. It owns one explicit state machine:

```text
idle -> native-capturing -> native-animating -> idle
idle -> fallback-exiting -> navigating
loading -> fallback-entering -> idle
any state -> skipped/failed -> idle or immediate navigation
```

Each transition gets an identifier and an `AbortController`; starting a new
eligible action aborts stale listeners/timers. State cleanup belongs in one
`finally` path and is repeated idempotently on `pagehide`, `pageshow`, and
BFCache restore. Do not use `unload` or unconditional `beforeunload`; the page
lifecycle guidance notes that `pagehide`/`pageshow` represent BFCache traversal
and that unload-oriented hooks can harm caching. See Chromium's
[Page Lifecycle API guidance](https://developer.chrome.com/docs/web-platform/page-lifecycle-api).

### Capability and policy, not browser identity

Resolve the tier from features and user policy:

1. **Motion off:** build kill switch, explicit preview override, or
   `prefers-reduced-motion: reduce`. Skip a native transition when an event
   exposes it and do not intercept fallback clicks.
2. **Native directional:** cross-document opt-in plus `PageSwapEvent`,
   `PageRevealEvent`, and transition types. Set types from the centralized
   source/destination relationship.
3. **Native basic:** cross-document opt-in exists but lifecycle customization
   is incomplete. Allow the browser's short root cross-fade; do not intercept.
4. **Fallback:** no cross-document support, but CSS animations, event listeners,
   and an eligible link are available. Run the split exit/entry effect below.
5. **Baseline:** allow the browser to navigate with no animation.

Do not use `navigator.userAgent`. `Document.startViewTransition` alone is also
not a sufficient cross-document test because Firefox supports the same-document
API. Feature detection should distinguish the `@view-transition` CSSOM rule and
the cross-document lifecycle interfaces. False or partial detection must select
native-basic or baseline, never the most invasive path.

Put the release policy in a focused transition config rather than the content
collection schema. A production `off` switch must be read before listeners act;
preview-only URL/session overrides may expose `off`, `native`, and `fallback`
for testing. Invalid or blocked storage falls back to `auto` without throwing.

### Native choreography

Keep `@view-transition { navigation: auto; }`, root snapshot animation, the
stable canvas, and the strongest shared-element ideas. Refactor them as follows:

- Use relationship types (`to-left`, `to-right`, `to-up`, `to-down`, `neutral`)
  determined from both URLs. Remove the blanket `back-nav` inversion.
- Add the same types from both lifecycle sides when available; use the final
  destination exposed after redirects. Register `pagereveal` early enough to
  affect the initial snapshot.
- Keep root movement on compositor-friendly `transform` and `opacity`. Scope
  pseudo-element rules to an active relationship and avoid global wildcard
  overrides when no transition is active.
- Preserve the prepaint background and backdrop to prevent white/dark flashes.
  Keep shared groups above the root only where a tested relationship needs them.
- Temporarily assign `view-transition-name` for homepage seeds from the route
  model, then clean it after `ready`/`finished`, including BFCache restoration.
- Test `home-mark`, `arrow-fly`, `tagline`, and `nav-crumb` separately. Ship the
  root transition first; add each morph only after it is stable in Chromium and
  real Safari. A failed shared group must degrade to the root animation.
- Do not wait for fonts, images, fetches, or arbitrary async work in the
  transition. Render-blocking can stabilize a new snapshot, but the
  [specification warns against overuse](https://drafts.csswg.org/css-view-transitions-2/#waiting-for-stable-state)
  because it freezes the old view longer.

### Firefox/legacy fallback

Replace preview cloning with a split animation around an ordinary navigation:

- For an eligible unmodified primary click, store only a versioned record of
  source URL, destination URL, relationship, timestamp, and transition ID in
  `sessionStorage` inside `try/catch`.
- Animate one real page surface out for no more than 120-160 ms, then call
  `location.assign()` from `animationend`/`animationcancel` or a 200 ms watchdog,
  whichever happens first.
- On the next document, consume the record only if it is recent and its expected
  destination matches the actual canonical URL. Animate the real page surface
  in for 180-220 ms. A redirected or mismatched destination gets a neutral fade
  or no motion.
- Use a dedicated `[data-page-surface]` wrapper and the persistent document
  background instead of transforming/cloning `body`. Never copy HTML, styles,
  scripts, IDs, or focusable controls into an overlay.
- A fallback traversal can derive entry direction from the stored source route
  and the restored route. It should not delay browser Back/Forward; if the
  outgoing half cannot be observed, run only the incoming half.
- Never intercept forms, same-page fragments, downloads, external links,
  `target` links, non-primary clicks, modifier-key clicks, programmatic
  navigations, or links already handled with `defaultPrevented`.
- If storage, animation APIs, the page surface, or the route model is missing,
  navigate immediately. Double activation must result in at most one assigned
  navigation and must never leave the page inert.

This fallback is intentionally less cinematic than the native two-snapshot pan.
It still moves the whole page in Firefox without creating a second document in
the DOM or taking ownership of history, scripts, and page hydration.

## Navigation and lifecycle rules

### History and BFCache

- Use actual source/destination routes for direction. Preserve a namespaced,
  versioned key in `history.state` only if forward/back labels are needed, and
  always merge existing application state.
- Treat `pageshow.persisted` as a restoration, not a fresh initialization.
  Remove stale classes, attributes, `inert`, `pointer-events`, `will-change`,
  timers, and temporary transition names before accepting input.
- Await/catch native `ready` and `finished` promises without allowing rejection
  to become an unhandled error. The outgoing and incoming promises have
  different behavior; do not share one assumed lifecycle.
- Do not add unload handlers or resources that disqualify BFCache. Add a test
  assertion or diagnostic for `pageshow.persisted`, with a manual DevTools
  BFCache check when the engine cannot expose it deterministically in automation.

### Redirects, reloads, and failures

- Keep canonical internal hrefs and `wrangler.jsonc` direct 200 handling. Add an
  HTTP assertion for `/about`, `/software`, representative detail routes, and
  both slash variants so the deployed behavior is known rather than assumed.
- Do not promise animation through redirects. Cross-origin redirects make a
  native transition ineligible, and redirect chains/final URLs can change the
  relationship. Unknown project redirects to `/404?code=PROJECT_NOT_FOUND`
  must always complete and may use neutral/no motion.
- Direct loads, bookmarks, address-bar entry, and reload remain ordinary page
  loads. The coordinator consumes no stale transition older than a short TTL.
- On native skip/timeout, on animation cancellation, during slow navigation, or
  after any thrown error, clear temporary state and preserve the requested URL.
  Animation failure is never shown as an application error.

### Focus, reading order, and announcements

- Preserve semantic anchors and real document navigation. Do not insert a
  second page DOM or move focus into a visual overlay.
- Give each route an accurate document title and one logical `h1`. Let a fresh
  document follow normal browser focus behavior; do not unconditionally focus a
  heading after cross-document navigation.
- On BFCache traversal, preserve the browser-restored focused control when it is
  still valid. If testing finds focus left on an inert/stale element, restore a
  saved focus key or the document start only after the transition is finished.
- Never leave the new live view unavailable to keyboard or assistive technology.
  Sequential focus must retain meaningful order, as required by
  [WCAG 2.2 focus order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html).
- Validate with keyboard-only navigation and VoiceOver/NVDA. Transition state is
  visual and should not use live regions unless user testing finds an actual
  announcement gap.

### Reduced motion

- Evaluate `prefers-reduced-motion` before click interception and again at each
  lifecycle event so a live preference change is honored.
- For `reduce`, skip transform/clip/scale motion, native shared-element travel,
  fallback delay, smooth scrolling, and scroll-triggered animation. A very short
  opacity change is optional only after accessibility review; the default target
  is immediate navigation.
- Provide a preview-only force-reduce mode for deterministic testing. W3C's
  [Animation from Interactions guidance](https://www.w3.org/WAI/WCAG22/Understanding/animation-from-interactions.html)
  specifically uses page transitions respecting `prefers-reduced-motion` as an
  example.

### Scroll

- Leave `history.scrollRestoration = 'auto'` for document navigation. New pushes
  should start at the browser's normal location; traversals should restore the
  previous position; fragments should use native anchor scrolling.
- Scope `storyscroll.ts` and its manual restoration to pages that actually have
  carousel hash navigation. Merge its `history.state` keys and return restoration
  ownership when the feature is inactive.
- Record scroll positions before and after forward/back tests. Acceptance is
  within 2 CSS pixels after layout settles on representative short, long, and
  full-window pages.
- Test classic and overlay scrollbars, mobile dynamic viewports, orientation
  change, 200% zoom, and the full-window `/software/gta-map` route. No transition
  may introduce a horizontal scrollbar or shift the stable top navigation.

## Performance budgets

These are release gates, not aspirations:

| Measure | Budget |
| --- | --- |
| Native click handling | No `preventDefault`, synchronous handler under 8 ms in a throttled lab run. |
| Fallback exit delay | 160 ms target; hard watchdog at 200 ms before `location.assign`. |
| Visible native transition | 250-450 ms root; no shared group over 500 ms. |
| Fallback entry | 180-220 ms; input available immediately, with no full-page pointer lock. |
| Main-thread work | No transition-owned task over 50 ms; route resolution and state serialization under 2 ms. |
| Layout stability | No transition-caused layout shift; route CLS remains at or below 0.1. |
| Runtime footprint | Coordinator plus route model at or below 6 KiB gzip; no document DOM cache and no eager asset crawler. |
| Animation properties | Root/page surface uses only transform and opacity; `will-change` exists only while active. |
| Cleanup | All transition attributes, names, timers, and locks removed within 750 ms or on the first restore event. |

Measure with production builds under 4x CPU slowdown and a constrained mobile
profile. Capture performance marks for `intent`, `navigation-assigned`,
`pagereveal`, `animation-ready`, `animation-finished`, `skipped`, and `failed`.

## Test strategy

### Automated coverage

Add Playwright Test with `chromium`, `webkit`, and `firefox` projects, desktop
and one mobile-sized project, plus `reducedMotion: 'reduce'`. Playwright supports
[multi-browser projects](https://playwright.dev/docs/test-projects), branded
Chrome/Edge channels, mobile emulation, and reduced-motion emulation. Retain
[traces with screenshots](https://playwright.dev/docs/trace-viewer) on retry and
failure.

The suite should cover:

- Pure route-model cases for every route pair, query/hash normalization,
  unknown routes, and direction symmetry.
- Home -> About, Home -> Software, Software -> detail, Home -> Blog,
  breadcrumb -> section, Home -> full-window map, and each return path.
- Browser Back and Forward across at least three entries, including repeated
  paths with different query/hash values and both BFCache/restored and reloaded
  outcomes.
- Direct load, reload, 404 redirect, same-origin redirect fixture,
  cross-origin/external link, fragment, download, target, modifier click, and a
  rapid double click.
- Reduced motion at initial load and changed live; no transform animation and
  no fallback navigation delay.
- Storage denied/throwing, CSS animation disabled, missing page surface,
  native transition skipped/rejected, slow CSS/image/font, offline target, and
  a fallback watchdog path.
- Correct final URL, heading/title, focus target, scroll position, one history
  entry per navigation, absence of duplicate IDs, and no page/console errors.
- Cleanup of transition attributes and temporary names after completion,
  cancellation, pagehide, and `pageshow.persisted`.
- Light/dark and both theme families, scrollbar presence changes, narrow/tall
  viewports, and screenshots at stable start/end states. Use filmstrip/video for
  mid-animation review rather than brittle pixel assertions on every frame.

CI should run the route model and reduced-motion smoke on every PR, then the full
three-engine navigation suite on animation changes. Cloudflare preview tests
must additionally assert final response status/canonical URL because local
Astro preview does not reproduce every Workers asset rule.

### Manual browser/device matrix

| Platform | Minimum manual coverage | Expected behavior |
| --- | --- | --- |
| Windows | Current Chrome, Edge, Firefox; Firefox ESR | Native on Chromium browsers, fallback/baseline on Firefox. Check classic scrollbars and NVDA. |
| macOS | Current Safari plus Safari 18.2 floor, Chrome, Firefox | Native on Safari/Chrome, fallback/baseline on Firefox. Check overlay scrollbars and VoiceOver. |
| iOS/iPadOS | Current Safari and an 18.2-class device/simulator | Native WebKit; test dynamic toolbars, rotation, swipe Back, low-power mode, and Reduce Motion. |
| Android | Current Chrome and Firefox | Native Chromium versus Firefox fallback, touch activation, system Back, and low-memory restore. |

For every platform, sample light/dark, both site theme families, keyboard where
available, 200% zoom/text enlargement, slow network, private/storage-restricted
mode, long and short pages, and rapid navigation. Playwright WebKit is an early
signal, not a substitute for real Safari/iOS sign-off.

## Diagnostics, flags, and rollout

- Expose the resolved tier and state through stable `data-vt-tier` and
  `data-vt-state` values for tests. Do not include browser names in policy.
- In non-production or with an explicit debug flag, dispatch structured custom
  events containing transition ID, source/destination categories, tier, state,
  duration, and skip/failure reason. Never include content or arbitrary query
  values.
- Use `performance.mark`/`measure` locally. Do not add a telemetry vendor or send
  navigation data until an endpoint, sampling policy, retention policy, and
  privacy review exist.
- Provide a build-level `off` kill switch and preview-only forced-tier controls.
  With the current assets-only deployment, production rollback is a previous
  Workers version or a small disable-and-deploy change; do not pretend there is
  remote percentage rollout infrastructure.
- Roll out through immutable PR preview -> owner/browser matrix -> production
  with root animation only -> shared elements one at a time. Observe console
  errors, navigation completion, page lifecycle marks, and user reports between
  stages. The kill criterion is any blocked/wrong navigation, persistent inert
  UI, broken Back/Forward/scroll restoration, or a new accessibility regression.

## Phased delivery and acceptance

### Phase 0: characterize and add safety tests

Deliver route inventory, current animation recordings, Playwright scaffolding,
route/final-URL smokes, reduced-motion coverage, and response/canonical-route
checks. Record current behavior in Chromium, WebKit, and Firefox before deleting
the fallback.

Acceptance: the build is unchanged; tests can distinguish native, fallback, and
baseline; every navigation still completes when animation code is disabled.

### Phase 1: centralize relationship and lifecycle state

Deliver the pure route model, the focused transition config, a small head
coordinator, explicit state transitions, diagnostic marks, and consolidated
page metadata. Remove duplicated `pageswap`/`pagereveal` scripts from pages and
layouts. Separate theme bootstrap from animation behavior.

Acceptance: route-model cases pass; handlers install once; actual from/to routes
determine direction for click, Back, and Forward; all failure paths clean up.

### Phase 2: ship the native root transition

Deliver scoped relationship types, root animations, stable canvas behavior, and
reduced-motion skipping for Chromium/WebKit. Remove the Edge UA override and all
wildcard fallback suppression from the native path.

Acceptance: Chrome, Edge, Safari, and iOS Safari pass the route matrix without
flash, scrollbar shift, duplicate transition names, blocked input, or wrong
direction. Firefox remains fully navigable without native assumptions.

### Phase 3: replace the Firefox fallback

Delete document/asset prefetch caches, HTML sanitization, stylesheet/body
cloning, preview DOM, and UA regex configuration. Add the bounded split
exit/entry fallback and watchdog, or select baseline when any prerequisite is
missing.

Acceptance: current Firefox and Firefox ESR complete every navigation and
history scenario; no duplicate DOM exists; no click waits more than 200 ms;
storage denial and animation cancellation navigate immediately.

### Phase 4: restore shared-element choreography

Reintroduce `home-mark`, then `tagline`, `nav-crumb`, and finally `arrow-fly` as
separate, reviewable changes. Keep only morphs that are stable in both native
engines; Firefox continues to use whole-page fallback without simulated clones.

Acceptance: each morph passes real Chrome/Edge and Safari/iOS recordings,
reduced motion, BFCache cleanup, light/dark themes, zoom, and rapid navigation.
Removing any morph leaves the root transition intact.

### Phase 5: scroll, focus, performance, and production rollout

Scope `storyscroll` restoration, finish keyboard/screen-reader testing, enforce
budgets, run the full device matrix, document flags/rollback, and roll through
preview and root-only production before enabling accepted morphs.

Acceptance: CI and manual matrix are green; route titles/headings are correct;
focus and scroll semantics match normal navigation; budgets pass on the mobile
profile; the owner can disable/rollback without a source hotfix; no merge occurs
until the production-ready review explicitly accepts the browser differences.

## Explicit disposition of PR #51 mechanisms

| Mechanism | Decision |
| --- | --- |
| Static Astro MPA and semantic links | Keep. |
| `@view-transition` and native root snapshots | Keep and make the primary enhancement. |
| Prepaint theme/`--vt-bg`, backdrop, stable gutter | Keep; isolate from transition control. |
| Route-grid mental model | Keep; move to one tested source/destination resolver. |
| Shared element names | Keep provisionally; stage and gate each morph. |
| `wrangler.jsonc` canonical direct responses | Keep; add deployed response tests. |
| Per-page lifecycle scripts and blanket `back-nav` | Replace with the central coordinator and actual relationship. |
| UA regex modes in `content.config.ts` | Remove. |
| Edge forced fallback | Remove. |
| HTML/stylesheet/body preview cloning and eager asset crawling | Remove. |
| 24-document in-memory cache | Remove. |
| 360 ms body transforms controlling navigation | Replace with bounded page-surface exit/entry fallback. |
| Global pointer lock and 480 ms timer | Replace with a short watchdog and idempotent state cleanup. |
| Broad inactive pseudo-element rules | Scope/refactor. |
| Global manual scroll restoration in `storyscroll.ts` | Scope to the carousel and merge state. |
