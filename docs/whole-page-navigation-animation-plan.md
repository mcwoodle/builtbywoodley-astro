# Whole-page navigation animation architecture

Status: implemented

Last reviewed: 2026-08-07

## Outcome

The site remains statically generated, with semantic links and independently
loadable route documents. After the initial load, Astro's `ClientRouter`
intercepts eligible same-origin navigation and swaps the next static document
inside a same-document View Transition.

This gives current Firefox, Chrome, and Edge the same snapshot model and the
same directional animation CSS. Browsers without the same-document View
Transition API use Astro's bounded CSS exit/swap/entry fallback. With
JavaScript disabled, links retain ordinary document navigation.

The previous cross-document design was replaced because Firefox does not yet
support `@view-transition`, `PageSwapEvent`, or `PageRevealEvent`. A native
two-snapshot MPA pan therefore could not be consistent across the three target
browsers.

## Browser baseline

| Engine | Same-document View Transitions | Runtime path |
| --- | --- | --- |
| Chromium / Chrome / Edge | Supported | Native same-document snapshots. |
| Firefox 144+ | Supported | Native same-document snapshots. |
| Firefox ESR or older engines without the API | Not assumed | Astro sequential CSS fallback. |
| JavaScript unavailable | Not applicable | Ordinary document navigation. |

Direction styling uses temporary `data-nav-*` attributes rather than requiring
`ViewTransition.types`, so Firefox 144-146 can use the same choreography even
though transition types arrived later. Types are still attached when available
for diagnostics and future styling.

## Implementation

### Router head

`src/components/NavigationTransitionHead.astro` installs one
`<ClientRouter fallback="animate" />` in `BaseLayout` and loads the navigation
coordinator. There is no user-agent selection and no animation policy in the
content collection configuration.

The router owns eligible link clicks, Back/Forward history entries, route
announcements, DOM swapping, script execution, and its unsupported-browser
fallback. External, download, targeted, modified, and non-page links retain
their normal behavior.

### Route relationship model

`src/scripts/navigation-transitions/route-model.ts` is the side-effect-free
source of navigation geometry. It classifies Home, About, software index and
detail, blog index and detail, 404, and unknown routes.

The destination's position relative to the source becomes one of:

- `right`: old page exits left; new page enters from the right.
- `left`: old page exits right; new page enters from the left.
- `down`: old page exits up; new page enters from below.
- `up`: old page exits down; new page enters from above.
- `neutral`: a short cross-fade.

Software index-to-project navigation uses the neutral cross-fade in both
directions. Other index/detail relationships continue to follow route
geometry.

Because every transition resolves from its actual source and destination,
Back and Forward are geometric inverses without a blanket `back-nav` rule.

### Transition coordinator

`src/scripts/navigation-transitions/client-router.ts` listens to Astro's
`astro:before-preparation` and `astro:before-swap` events.

Before the old snapshot it:

- resolves the initial source/destination relationship;
- installs direction and route-role attributes on `<html>`;
- isolates the fixed top navigation from the moving root snapshot.

Before the DOM swap it:

- recalculates from the final URL after any same-origin redirect;
- places the same relationship attributes on the incoming document;
- swaps the old/new navigation snapshots without animating them;
- copies the live theme mode, family, background, and color-scheme state to the
  incoming root before Astro swaps root attributes;
- adds diagnostic transition types when the browser exposes them.

Temporary relationship attributes and names are removed after the transition's
`finished` promise settles, including rejection. A new navigation also clears
stale state before it begins.

### CSS choreography

`src/styles/view-transitions.css` contains one animation definition for every
native target engine:

- root canvas pan using only `transform`;
- a neutral opacity transition for unrelated/unknown routes;
- a stable, non-animated `top-nav` snapshot above the moving page;
- the `tagline` shared page-content group;
- a shorter sequential fallback keyed by Astro's
  `data-astro-transition-fallback` attribute;
- complete animation cancellation under `prefers-reduced-motion: reduce`.

There is no `@view-transition` cross-document opt-in, cloned preview document,
HTML sanitization, page cache, asset crawler, global pointer lock, or timer that
controls native navigation.

## Script lifecycle

Client-side document swapping means bundled module scripts execute once per
visit, not once per route. Page behavior follows these rules:

- Theme controls use document-level event delegation and resynchronize on
  `astro:page-load`, so replacement TopNav buttons remain interactive.
- Carousel controls abort their old listeners on `astro:before-swap` and bind
  the new controls on `astro:page-load`.
- `storyscroll.ts` only creates Lenis and GSAP behavior on pages that contain
  the carousel/project log. It destroys animations, listeners, and its RAF on
  swap.
- Story-scroll history uses Astro's `navigate()` and a namespaced state key,
  while merging the existing router history state.
- The full-window map's inline initializer uses `data-astro-rerun` because its
  iframe and controls must be initialized on every visit.
- The 404 details initializer runs on `astro:page-load`.

Every route now supplies a useful document title so Astro's route announcer can
announce the destination rather than the same site title on every navigation.

## Accessibility and safety

- `prefers-reduced-motion: reduce` disables native and fallback animation.
- Semantic anchors remain the baseline; `ClientRouter` provides its route
  announcer for client navigation.
- Theme state is applied before first paint and copied before each DOM swap.
- No transition duplicates live IDs or inserts a second interactive page.
- Failure to fetch or prepare a client-routed document falls back to ordinary
  navigation through Astro's router behavior.
- Page-specific listeners use `AbortController` or persistent event delegation
  to avoid stale references after swaps.

## Verification

The production build generates all 33 routes successfully.

Browser checks completed against the production preview:

- Chrome: Home -> About, Home -> Software, Software -> detail, detail -> Back,
  theme changes across swaps, titles, route roles, duplicate-ID check, and a
  stationary top navigation with no active transition animation.
- Firefox 153: native Home -> About using `to-down`, `home-edge`, `from-home`,
  and `about-edge`, with the correct title/theme, a stationary non-animated
  top navigation, and no console warnings.
- Reduced-motion Chromium context: navigation completed with zero active
  transition animations.
- Blog carousel: slider initialization, hash navigation, namespaced history
  state, Back, and restored scroll position.
- Full-window map: direct load, Home navigation, Back, and iframe/control
  reinitialization.

Before release, manually sample branded Edge and real desktop/mobile devices.
Edge uses the same Chromium API path, but a branded-browser smoke remains a
release check rather than being inferred from the engine alone.

## Disposition of the previous implementation

| Mechanism | Decision |
| --- | --- |
| Static Astro output and semantic links | Kept. |
| Route-grid mental model | Centralized in the route model. |
| Root and shared-element animations | Kept on the common same-document API. |
| `@view-transition` MPA opt-in | Removed. |
| Per-page `pageswap` / `pagereveal` scripts | Removed. |
| User-agent mode configuration | Removed from `content.config.ts`. |
| Edge and Firefox forced body fallback | Removed. |
| Preview DOM/style cloning and HTML sanitization | Removed. |
| Page/asset prefetch caches | Removed. |
| Global pointer lock and 480 ms navigation timer | Removed. |
| Global `DOMContentLoaded`-only initialization | Replaced with Astro lifecycle handling. |
| History state replacement in `storyscroll.ts` | Replaced with namespaced, merged state. |
