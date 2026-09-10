# Front-end analytics design

Status: proposed — nothing in this document is implemented

Last reviewed: 2026-09-10

This is the design of record for adding analytics to builtbywoodley.ca. It
supersedes the first draft plan
(`~/.claude/plans/design-a-front-end-analytics-calm-bunny.md`) and folds in the
review that rejected that draft verbatim. That review lived at
`docs/front-end-analytics-plan-review.md`; it was removed once its conclusions
were absorbed here, and remains readable in git history at commit `44c137e`.

Repository facts were re-checked against the tree on 2026-09-09. Vendor
behaviour, free-tier limits and pricing come from the documentation linked at
the end; they are external state and must be re-verified at implementation
time, not treated as guarantees of this repository.

## Purpose

The site ships **zero analytics** today — no vendor script, no consent code, no
beacon anywhere in `src/`, `public/`, `astro.config.ts` or `wrangler.jsonc`. As
a result there is no way to answer the questions the site exists to raise:

- Does anyone read the landing-page narrative past the first chapter, or does
  the pinned horizontal archive lose them?
- Does anyone click through to a software case study, and from there to a
  repository or a live project?
- Is the contact CTA — a `mailto:` link, the site's only conversion — ever
  used? It produces no pageview, so nothing about it is currently observable.
- Is any of the photography archive reached at all?
- What does the site actually cost a real device? This is a photography site
  with a GSAP-driven landing reveal and a full-resolution zoom view, and every
  load measurement that exists today is a lab one:
  `scripts/measure-image-delivery.mjs` models `dist/`, and the `?stats=true`
  probe shows one device's numbers to whoever is holding it. Neither reports
  what visitors got.

The goal is a small, honest measurement layer that answers those questions
without turning a static portfolio into a surveillance surface, without a
service of our own to run, and without weakening the security posture the
repository already maintains.

### Non-goals

- Per-person identity, person profiles, funnels tied to individuals, or any
  cross-session stitching.
- Session replay, heatmaps, dead-click/rageclick detection, exception capture,
  surveys, feature flags, or A/B testing.
- Marketing attribution beyond whatever referrer the platform records by
  default.
- Instrumenting `/viz/gta-crime-map.html` beyond the edge request baseline. It
  is a hand-written file in `public/`, not an Astro page, and it has its own
  CSP block; instrumenting it is deliberately out of scope.
- Replacing the smoke suite as the correctness signal. Analytics measures
  visitors, not the build.
- Replacing lab measurement. `measure:images` and the `?stats=true` probe stay
  the tools for *diagnosing* a build on a machine you control. Field timing
  answers a different question — what real devices experienced — and neither
  substitutes for the other.
- Per-asset waterfalls, error/exception monitoring, or anything that would make
  this an APM product. The performance requirements below are a handful of
  numbers per pageview, not a trace.

## Requirements

### Functional

| ID | Requirement | Notes |
| --- | --- | --- |
| R1 | Which named control was activated | An allowlisted set of navigation, CTA, project, disclosure, theme, photo and map controls. Not "every click on the page". |
| R2 | How long a visitor stayed | Per-page elapsed time and aggregate session duration. |
| R3 | How far a visitor scrolled | Document depth per pageview. |
| R4 | Which narrative chapter was reached | `hero → about → work → archive → contact` on Home. Added by this design; see C4 for why R3 alone is not enough. |
| R5 | A traffic baseline that does not depend on a browser script | Something to sanity-check R1–R4 against when a visitor blocks JavaScript analytics. |
| R6 | How fast the page rendered and finished loading | Server response, first render, largest paint, layout stability, interaction latency, "fully loaded", and the long tasks the Home reveal spends — per pageview, with hard loads and ClientRouter soft navigations kept apart. |
| R7 | What images cost and how fast the photo viewer responded | Which srcset rung this device actually chose and what it transferred; the latency of opening the photo viewer, and of entering the 1:1 zoom — including whether the master was already warm. |

R6 and R7 are the reason the analytics layer has to justify its own weight
twice over: it is measuring a page whose whole argument is that it feels fast,
so the measurement must be small enough not to be the thing that slows it down.
Acceptance criterion 4 under *CSP, Cloudflare and performance* exists for
exactly that, and R6 is what tells us afterwards whether it held in the field.

### Constraints from this codebase

| ID | Property | Where | Consequence |
| --- | --- | --- | --- |
| C1 | Static Astro on Workers static assets, **no Worker script today** | `wrangler.jsonc` | A first-party proxy means introducing a `main` entry point, an `ASSETS` binding and a Worker deploy path for the first time. That is the single largest structural change in this design. |
| C2 | Astro `ClientRouter` soft navigations | `src/components/NavigationTransitionHead.astro` | Pageviews must follow `history.pushState`, not `load`. Page-scoped listeners and observers must be torn down and rebuilt on every swap, following the lifecycle `home-scroll.ts` and `storyscroll.ts` already use. |
| C3 | Strict CSP with `connect-src 'self'`, plus a **second policy** for `/viz/*` that unsets the global one | `public/_headers` | Every third-party origin is a deliberate, reviewed edit — and any edit that must also apply to the map has to be made twice. |
| C4 | Lenis + GSAP ScrollTrigger, including a pinned horizontal archive | `src/scripts/smooth-scroll.ts`, `src/scripts/home-scroll.ts` | Scrolling is native document scroll, so scroll percentage works. But pin spacers inflate document height: the number stays monotonic and comparable *between visitors* while ceasing to mean "percent of prose read". Hence R4. |
| C5 | Free hosted plans, no service of our own | — | Rules out self-hosting; makes vendor free-tier limits a live risk to record and alert on. |
| C6 | Public repository with enforced CI gates | `.github/workflows/`, `AGENTS.md` | gitleaks, `npm audit --audit-level=high`, CodeQL, dependency review and the smoke suite all gate `mainline`. New dependencies and any new CI variable must pass them. |
| C7 | Reduced-motion contract | `AGENTS.md`, smoke suite runs `reducedMotion: 'reduce'` | Analytics must work identically under reduced motion. An `IntersectionObserver` creates no motion, so it runs for everyone — but it must not be nested inside an existing motion guard. |
| C8 | A build-time image model and an on-device probe already exist | `scripts/measure-image-delivery.mjs`, `src/scripts/image-perf.ts`, `src/components/ImagePerfProbe.astro` | Field timing must reuse their definitions rather than invent a second set of numbers — and must **not** import the probe module. Its separation from the critical path is asserted on every build by `scripts/check-asset-sizes.mjs`, because inlining it would put ~4 KB of debugging on all 36 pages. |
| C9 | The photo viewer decodes in two stages and can cancel | `src/scripts/photo-viewer.ts` — `revealPicture()` (`:451`), `openZoom()` (`:207`), `masterReady`, `zoomToken` | Latency here is not one number. A zoom paints an upscaled stand-in immediately and swaps in the decoded master when it lands, and a hold-to-zoom can end before either. Any timing that ignores this will report cancelled interactions as fast ones. |

Two facts from the first draft are now stale and should not be carried forward:
`not_found_handling` **is** set to `404-page` in `wrangler.jsonc` (it is no
longer an open item to fold into the Worker change), and the landing page's
five chapters do **not** all have IDs — `hero` and `contact` are unlabelled
(`src/pages/index.astro:238` and `:762`), so event names cannot be derived from
IDs.

### Privacy requirements

| ID | Requirement |
| --- | --- |
| P1 | A normal visit leaves no analytics identifier in cookies, `localStorage` or `sessionStorage`. Only a site-owned opt-out preference may persist, and it must be named in the disclosure. |
| P2 | No personal data and no page content in event payloads. In particular the `mailto:` address must never travel as an event property, and no visible text, class list or element ancestry is sent. |
| P3 | Global Privacy Control and best-effort Do Not Track are honoured, and a discoverable site opt-out works **mid-visit**, not only after a hard reload. |
| P4 | The processor, its region, retention period and the transient use of IP/user-agent are documented in the repository and disclosed on the site. |
| P5 | Local development and PR previews never enter production data, and there is a documented way to run a real end-to-end test that does not. |
| P6 | Timing payloads carry no URLs and no image paths beyond a build-stable basename, are rounded to whole milliseconds, and describe device shape only in coarse buckets. |

P6 is where the performance requirements press hardest on the privacy ones.
Viewport width and device pixel ratio are what make R7 answerable at all — the
srcset ladders in `src/config/image-ladders.mjs` are chosen against exactly
those two axes — but they are also fingerprinting surface. The design records
them **bucketed** (viewport rounded to the nearest 160 px, DPR to 1/2/3) and
records nothing else about the device: no `deviceMemory`, no
`hardwareConcurrency`, no `navigator.connection` unless a specific question
later needs it. The mitigation that matters most is structural: cookieless
server-hash mode means there is no stable identifier for that entropy to
accumulate against.

P1–P4 are a product and privacy decision, not a legal conclusion. This design
avoids analytics storage and identification, which is the reason no consent
banner is proposed; that is a position to confirm against the site's actual
obligations before launch, not something the architecture proves.

### Operational

- No new always-on infrastructure; the Worker runs only on the analytics path.
- Deployable and rollbackable through the existing Cloudflare Worker version
  flow.
- Every requirement above must be verifiable — see
  [Verification and acceptance criteria](#verification-and-acceptance-criteria).

## Recommendation

**PostHog Cloud (free tier) in cookieless server-hash mode, reached through a
same-origin Cloudflare Worker proxy at `/sawdust/*`, with `posthog-js` bundled
from npm, explicit `data-analytics-*` annotations consumed by one delegated
click handler, a leading-edge chapter observer on Home, and Cloudflare's
zone/edge Analytics as the non-JavaScript request baseline.**

The SDK is bundled rather than loaded from a vendor host, so the only script
origin stays `'self'`. Events go to a neutral same-origin path, so
`connect-src 'self'` is unchanged. Nothing in the core design requires a CSP
edit at all; the only candidate edit belongs to the *optional* Cloudflare Web
Analytics beacon.

```text
                       builtbywoodley.ca (Cloudflare)
  browser
    │
    ├─ /_astro/*.js ─────────► static assets      posthog-js is BUNDLED: the SDK
    │                                             is first-party, no CSP exception
    │
    ├─ /sawdust/*  ──► Worker ──► <region> API    ingest + config; header-minimised,
    │                          └─► <region> assets body-buffered, cookies stripped
    │
    ├─ everything else ──────► env.ASSETS.fetch() byte-identical to today
    │
    ├─ page requests ────────► Cloudflare edge Analytics   (R5, dashboard-only)
    │
    └─ /cdn-cgi/rum ─────────► optional Web Analytics beacon (opt-in, CSP edit)
```

### Boundaries this design does not pretend to cross

- The proxy is same-origin, but PostHog remains a named third-party processor.
- A neutral path avoids common vendor-domain blocklists. It does **not** make
  collection invisible or unblockable; heuristic blocking and JavaScript-off
  visitors still exist, which is exactly what R5 is for.
- Cloudflare Web Analytics is a *second browser beacon*, not an unblockable
  dataset. Only zone/edge Analytics satisfies R5.
- The Worker must target only the two fixed PostHog hosts for the chosen
  region, resolved from a constant. It must never take an upstream host from a
  query parameter or request header.

### Key decisions

| Decision | Chosen | Rejected alternative | Why |
| --- | --- | --- | --- |
| Storage/identity | PostHog **cookieless server hash mode** (`cookieless_mode: 'always'`, `person_profiles: 'never'`, no `persistence` setting) | `persistence: 'localStorage'` + `person_profiles: 'identified_only'` (the first draft) | localStorage persistence stores a durable visitor ID; it is not cookieless, and `person_profiles` governs profile processing, not storage. Server-hash mode is the only configuration that satisfies P1. |
| Click capture | Explicit `data-analytics-*` annotations read by one delegated handler | PostHog autocapture | Autocapture collects link text, class lists, element hierarchy and `href` — including the `mailto:` address, violating P2. The delegated handler sends a fixed allowlist and nothing else. |
| SDK delivery | Bundled from npm | Proxying `array.js` from the vendor | Keeps `script-src 'self'`, removes a runtime dependency on the proxy for the SDK itself, and makes the payload visible to the build. |
| Ingest path | Same-origin `/sawdust/*` via Worker | Direct `us.i.posthog.com` | Direct ingest needs a `connect-src` exception (C3) and is on every common blocklist, for a developer-heavy audience. |
| Chapter measurement | `data-analytics-chapter` on all five sections; count when the leading edge enters a stable viewport band (threshold `0` with a negative bottom `rootMargin`) | 50% intersection over sections with derived IDs | A `0.5` threshold can never fire for a section taller than twice the viewport, which About and Work routinely are. Two of the five sections have no ID at all. |
| Traffic baseline (R5) | Cloudflare **zone/edge** Analytics, dashboard-only | Cloudflare **Web** Analytics as "the unblockable baseline" | Web Analytics is a JavaScript beacon and is blockable. Edge Analytics counts requests at Cloudflare with no code change. |
| Page timing source (R6) | PostHog's own web-vitals capture: `capture_performance: { web_vitals: true, network_timing: false }` | A hand-rolled `PerformanceObserver` per vital; or PostHog's defaults with `network_timing` left on | The SDK already carries a maintained web-vitals implementation, and its property names are what the Web Analytics dashboard reads. `network_timing` emits a resource-timing entry per asset — high volume, and URL-bearing, so it stays off (P6). |
| Soft-navigation timing | A custom `page_load_timing` event carrying `nav_type: 'soft'` and a mark-to-first-frame measure | Letting ClientRouter swaps be timed as ordinary navigations | FCP and LCP are hard-load metrics; they do not re-fire on a `pushState` swap. Recording a soft-nav render time under the same property name would quietly corrupt both populations. |
| Component latency (R7) | Custom `photo_viewer_opened` / `photo_zoom_used` events timed around the viewer's existing decode points (C9) | Inferring it from INP, or from PostHog's generic slow-interaction signals | INP is a page-level aggregate: it can say the page felt slow, never *which stage* was slow. The viewer's two-stage decode is the thing worth measuring and is already a distinct code path. |
| Image cost (R7) | One bucketed `image_cost` summary per pageview, sampled | A resource-timing event per image | Ten images per gallery page per visitor is a volume and cardinality problem for no extra insight. The ladder question is answered by the summary plus viewport and DPR. |
| Init timing | Dynamic import promptly after the first `astro:page-load`, then measure the cost | `requestIdleCallback` with a 2s timeout | Up to two seconds of idle delay undercounts short visits, early clicks, initial dwell and quickly-passed chapters. If a delay is reinstated after measurement, annotated clicks must be queued synchronously and the timing bias documented. |
| Enablement | Explicit build-time switch (`PUBLIC_ANALYTICS_ENABLED`) plus key presence | Hostname sniffing (`localhost`/`*.workers.dev` always suppressed) | Hostname suppression makes local and preview verification impossible — the first draft asked for a local click test that its own code could never allow. |

### Measurement contract

What each requirement means, decided before any dashboard card is built:

| Requirement | Source of truth | Definition |
| --- | --- | --- |
| R1 clicks | PostHog custom events | An annotated navigation, CTA, project link, disclosure, theme, photo or map-mode control was activated. Properties come from a fixed allowlist, never from DOM content. |
| R2 time on site | PostHog Web Analytics | Average session duration in aggregate; `$prev_pageview_duration` (seconds) for page-level diagnostics. Elapsed time, not active reading time; pageleave delivery is best effort. |
| R3 scroll depth | PostHog pageview/pageleave properties | `$prev_pageview_max_scroll_percentage` and `$prev_pageview_max_content_percentage`, both `0..1`. Technical document depth, distorted by pin spacers (C4). |
| R4 narrative depth | PostHog `chapter_viewed` | The named chapter's leading edge reached the agreed viewport band once during that Home pageview. **This is the primary reading-depth metric**, and R3 is the diagnostic. |
| R5 traffic baseline | Cloudflare zone/edge Analytics | Requests reaching Cloudflare. On a **Free** zone this is a site-level count — requests, bandwidth, unique visitors and countries, delayed 24 hours — not a per-path breakdown; paths and referrers begin at Pro. Do not expect it to reconcile one-for-one with PostHog sessions or pageviews. |
| R6 page load | PostHog web vitals + `page_load_timing` | TTFB, FCP, LCP, CLS and INP as the `web-vitals` library defines them, for **hard loads only**. `load_ms`, `dom_content_loaded_ms`, `long_task_ms` and, for soft navigations, `render_ms` come from the custom event. A metric the browser did not report is **missing**, never zero. |
| R7 image cost | PostHog `image_cost` | For one sampled pageview: how many `<img>` elements resolved, the total transferred kilobytes (bucketed), the slowest single image, how many came from cache, and the viewport/DPR bucket that explains which rung was chosen. Mirrors what `?stats=true` shows on the device and what `measure:images` models from `dist/`. |
| R7 viewer latency | PostHog `photo_viewer_opened`, `photo_zoom_used` | Milliseconds from the activating input to the frame that shows the decoded image. Zoom is two numbers — stand-in painted, then master swapped — because the code is two stages (C9). Cancelled interactions are dropped, not recorded as fast. |
| Optional performance view | Cloudflare Web Analytics | Browser RUM and SPA navigation metrics. A cross-check, not a baseline: redundant with PostHog on the vitals themselves, but **not** on the blocked-rate cross-check described under [Cloudflare's free tier](#cloudflares-free-tier-what-it-already-covers). |

### Event dictionary

A few stable event names with low-cardinality properties, defined before any
component is edited — not one event name per button label.

| Event | Required properties | Examples |
| --- | --- | --- |
| `navigation_clicked` | `destination`, `placement` | `software` / `top-nav`, `photography` / `home-archive`, `about` / `top-nav` |
| `contact_clicked` | `method`, `placement` | `email` / `home-contact`, `linkedin` / `home-contact` |
| `project_link_clicked` | `project`, `kind` | `builtbywoodley-site` / `repo`, `fake-blog` / `live` |
| `control_used` | `control`, optional `value` | `theme` / `dark`, `photo-step` / `next`, `photo-close`, `map-mode` / `mobile` |
| `disclosure_opened` | `kind` | `ai-generated`, `human-written` |
| `chapter_viewed` | `chapter` | `hero`, `about`, `work`, `archive`, `contact` |
| `page_load_timing` | `nav_type`, plus the timings the browser supplied | `hard` / `load_ms`, `dom_content_loaded_ms`, `long_task_ms`; `soft` / `render_ms`, `long_task_ms` |
| `image_cost` | `images`, `bytes_kb`, `slowest_ms`, `from_cache`, `viewport_bucket`, `dpr` | `9`, `1400`, `620`, `3`, `1440`, `2` |
| `photo_viewer_opened` | `open_ms`, `source`, `warm` | `210` / `gallery-link` / `false`, `90` / `step` / `true` |
| `photo_zoom_used` | `to_standin_ms`, `to_master_ms`, `warm`, `input` | `16` / `540` / `false` / `hold`, `12` / `0` / `true` / `pointer` |

Two naming conventions are in play and should stay distinct: interaction events
are past-tense verbs (`chapter_viewed`, `photo_zoom_used`), and measurement
snapshots are nouns (`page_load_timing`, `image_cost`). All durations are whole
milliseconds; all byte counts are kilobytes rounded to the nearest 100. Web
vitals themselves are **not** in this table — they arrive under PostHog's own
`$web_vitals_*` properties, and duplicating them into custom events would
create two numbers that disagree.

PostHog supplies timestamps. Project slugs are derived at render time; titles
and full URLs are not sent. The theme value is captured from the resulting
`themechange`, because a raw button click does not reveal which of the three
modes was selected.

The first draft's control inventory contained semantic errors that this
dictionary corrects: the GTA map buttons select **Desktop/Mobile variants**
(`map-mode`), not map layers; Previous and Next need a `direction` rather than
sharing one undifferentiated `photo-step`; and on Home the primary contact link
is **LinkedIn** (`src/pages/index.astro:771`) with the `mailto:` button second
(`:777`).

### Component design

#### Worker proxy (`src/worker/index.ts`)

Contract, following PostHog's current Cloudflare guidance rather than the first
draft's minimal forwarder:

- Only `/sawdust/*` is proxied; the prefix is stripped and the query string
  preserved. Everything else falls through to `env.ASSETS.fetch(request)`.
- `/static/*` and `/array/*` go to the region's **assets** host; ingest and
  config endpoints go to the region's **API** host. Both hosts are constants in
  one config block, never derived from the request.
- Headers are cloned and minimised, and `cookie` is deleted before forwarding.
- With server-hash mode, `X-Forwarded-For` is set from Cloudflare's verified
  `CF-Connecting-IP` — never from a browser-supplied forwarding header — and
  that transient IP use is documented in the disclosure.
- Non-`GET`/`HEAD` bodies are buffered with `await request.arrayBuffer()`
  rather than streamed through `new Request(url, request)`.
- `Host` is left to `fetch()` to derive from the upstream URL; it is not set
  manually.
- Only the asset/config paths PostHog documents as cacheable are cached, via
  the execution context's `waitUntil()`.
- Unexpected upstream failures return a controlled `502`. Event bodies and
  visitor identifiers are never logged.

The path name is deliberately not `/analytics`, `/track` or `/posthog` —
PostHog's own proxy guide names those as the strings blocklists match.

`wrangler.jsonc` gains `main` and, inside the existing `assets` block, a
`binding` and selective worker-first routing. `directory`, `html_handling`,
`not_found_handling`, `routes` and `preview_urls` are untouched:

```jsonc
"main": "./src/worker/index.ts",
"assets": {
  "directory": "./dist",
  "html_handling": "drop-trailing-slash",
  "not_found_handling": "404-page",
  "binding": "ASSETS",
  "run_worker_first": ["/sawdust/*"]
}
```

`run_worker_first` as an array requires wrangler ≥ 4.20.0; both deploy
workflows already pin `wranglerVersion: "4"`. `_headers` continues to govern
asset responses, because asset responses still come from the asset router.

Worker types come from `wrangler types`, tied to `wrangler.jsonc`, rather than
a hand-maintained `Env`. `astro build` does not validate the Worker entry
point, so the scripts are:

```json
{
  "preview:worker": "astro build && wrangler dev",
  "typegen:worker": "wrangler types",
  "check:worker": "wrangler deploy --dry-run"
}
```

#### PostHog client (`src/scripts/analytics.ts`)

The privacy-critical configuration:

```ts
posthog.init(KEY, {
  api_host: '/sawdust',
  ui_host: POSTHOG_UI_HOST,
  defaults: '2026-05-30',
  cookieless_mode: 'always',
  person_profiles: 'never',
  capture_pageview: 'history_change',
  capture_pageleave: true,
  autocapture: false,
  disable_session_recording: true,
  disable_surveys: true,
  capture_heatmaps: false,
  capture_dead_clicks: false,
  capture_exceptions: false,
  capture_performance: { web_vitals: true, network_timing: false },
  rageclick: false,
  respect_dnt: true,
});
```

`capture_pageview: 'history_change'` and `capture_pageleave` are set
explicitly rather than inherited from `defaults`, because C2 is the whole
reason they matter. This configuration gives up PostHog's
autocapture-dependent bounce definition in exchange for a far smaller
collection surface; if that card turns out to matter, the documented escape is
to enable autocapture scoped to clicks on annotated anchors and buttons only,
after confirming in real payloads that text, hierarchy and `href` data are
acceptable under P2.

`capture_performance` is the one capture flag deliberately *not* set to
`false`, because R6 depends on it. The object form is what makes that safe:
`web_vitals` is a bounded set of numeric metrics per hard load, while
`network_timing` would send a resource-timing entry — carrying a URL — for
every asset on the page, which fails P6 and would dominate the free-tier event
budget on a gallery page. Verify the accepted shape of this option against the
installed `posthog-js` version at implementation time; it is vendor surface,
not a repository guarantee.

Lifecycle — SDK initialisation and page-scoped instrumentation are separate
responsibilities:

- The SDK starts **once per browser visit**, guarded by a module-level promise
  or state machine so concurrent calls initialise once.
- The delegated click listener is installed **once** and survives ClientRouter
  swaps.
- The chapter observer is disconnected on `astro:before-swap` and recreated on
  every `astro:page-load` where Home is the active document, with a fresh
  `seen` set per Home pageview. Guarding the whole module after the first call
  — as the first draft did — would prevent observer setup on later visits to
  Home.
- Opt-out works both before and after initialisation.
- GPC, DNT and the stored site preference are checked **before** importing
  `posthog-js`, so an opted-out visitor never downloads it.
- Enablement comes from explicit build configuration, not hostname guesses.

`BaseLayout.astro`'s existing bottom `<script>` block (currently importing
`nav-scroll-visibility`, `storyscroll` and `home-scroll`) gains one import and
an `astro:page-load` listener. Every page inherits it.

#### Instrumentation

`data-analytics-event` plus allowlisted property attributes go on the real
controls: `TopNav.astro`, `ThemeToggle.astro`, `PhotoViewer.astro`,
`AiSlopMark.astro`, `HumanWrittenMark.astro`,
`src/pages/software/gta-map.astro`, `SoftwarePageLayout.astro`, and the Home
contact and chapter links in `src/pages/index.astro`. A single document-level
click handler uses `closest()` to find the annotation and copies only known
fields into `posthog.capture()`.

Two scope questions to settle while doing this: whether project cards and the
Home *All projects* / *View the archive* links are in scope (measuring only the
TopNav equivalents would systematically under-count the narrative path), and
that the email event is delivered before control passes to the mail client.

All five chapters are annotated explicitly with
`data-analytics-chapter="hero|about|work|archive|contact"` — including the two
sections that have no ID today.

#### Performance and interaction timing (`src/scripts/perf.ts`)

Four sources, deliberately kept apart because they answer different questions
and fail in different ways.

**1. Web vitals — hard loads only.** TTFB, FCP, LCP, CLS and INP arrive from
`posthog-js` itself once `capture_performance.web_vitals` is on. No code beyond
the flag. One caveat belongs on the dashboard card rather than in the data: on
Home the largest paint is usually an element the GSAP intro timeline is still
animating (C4), so Home's LCP reads as *when the reveal settled* and is only
comparable against itself. Software and photography pages carry the honest
cross-page number.

**2. Navigation and long tasks — `page_load_timing`, one per pageview.**

- *Hard load*: `load_ms` and `dom_content_loaded_ms` from the
  `PerformanceNavigationTiming` entry. "Fully loaded" is a weaker claim than it
  sounds here — `load` fires when subresources finish, while the landing page
  goes on building GSAP timelines and a Lenis loop afterwards. That gap is the
  reason for the next property.
- *Both*: `long_task_ms`, the summed duration of `longtask` entries seen before
  the event is sent, with their count. This is the number that says whether the
  analytics layer itself cost frames during the Home reveal — the field version
  of acceptance criterion 4.
- *Soft navigation*: `render_ms`, marked at `astro:before-preparation` and
  measured at the first `requestAnimationFrame` after `astro:after-swap`, with
  `astro:page-load` as the scripts-ran checkpoint. It is sent with
  `nav_type: 'soft'` and **never** under a vitals property name, because FCP
  and LCP do not re-fire on a `pushState` swap and a soft-nav render time
  averaged into them would corrupt both.

**3. Image cost — `image_cost`, sampled, one per pageview.** This reuses the
probe's definitions rather than inventing new ones (C8): `currentSrc` for the
rung the browser actually chose after weighing DPR, connection and its own
cache; the matching resource-timing entry for `transferSize`; and the
`transferSize === 0` with non-zero `encodedBodySize` test that
`image-perf.ts:172` already uses to mean "came from cache".

The summarising logic moves into a small shared module — `src/lib/image-cost.ts`
— imported by both `image-perf.ts` and the analytics chunk. The HUD's DOM,
styles and observers stay in the probe, so the chunk split that
`scripts/check-asset-sizes.mjs` asserts on every build is unaffected; the
analytics module must never import `image-perf.ts` itself. Only basenames
leave the browser, which is what the probe already does at `image-perf.ts:178`.

**4. Photo viewer latency — `photo_viewer_opened` and `photo_zoom_used`.** The
viewer has three ways in and a two-stage decode, and the timing has to respect
both (C9):

- *Opening* starts at a delegated gallery-link click
  (`photo-viewer.ts:741`), a hash arrival or `popstate` through `sync()`
  (`:585`), or a `step()`/`advance()` to the next frame (`:606`). Take `t0`
  from the input event's `timeStamp` — same monotonic clock as
  `performance.now()`, and it includes the queueing delay the visitor actually
  felt — and `t1` at the first `requestAnimationFrame` after
  `revealPicture()`'s decode settles (`picture.decode()` at `:491`, with the
  `load` listener at `:494` as the fallback path). `source` distinguishes the
  three entries; `warm` records whether that frame had already been decoded.
  One subtlety decides whether `source` is trustworthy: `step()` navigates by
  replacing the hash (`:608`), so a prev/next arrival reaches `sync()` by
  exactly the route a shared deep link does. `source` must be set from the
  initiating input, not inferred at the hash, or every step lands in the data
  as a deep link.
- *Zoom* is two numbers because `openZoom()` (`:207`) is two stages. It paints
  an upscaled stand-in from the panel's `currentSrc` immediately, then swaps in
  the full master once `master.decode()` resolves (`:261`). `to_standin_ms` is
  what the finger feels; `to_master_ms` is when it sharpens, and is `0` with
  `warm: true` when `masterReady` already held it. Reporting only one of these
  would either flatter the interaction or libel it.
- *Cancellation is the trap.* A hold-to-zoom that lifts early, or a pending
  decode invalidated by a newer `zoomToken`, must **drop** its measurement.
  Recording those would give the best-looking numbers to the interactions that
  never finished.

The viewer must not import the analytics module. It runs for every visitor,
including opted-out ones, and it should keep working with analytics absent.
Instead it dispatches two small DOM events carrying the timings in `detail`
(`photo:opened`, `photo:zoomed`), and the analytics module listens for them —
the same separation the delegated click handler uses for R1. With analytics
suppressed, those events dispatch into an empty room.

**Volume.** A gallery visit that opens three photographs and zooms twice
produces roughly a dozen events including pageview and pageleave. That is
comfortable, but the levers exist: `image_cost` is sampled from the start, and
`page_load_timing` can be sampled too if the free tier tightens. Sampling rate
is a Phase 0 decision so it is recorded rather than discovered.

**Missing is not zero.** Support for these entry types differs across browsers,
and some are absent in Safari. When a metric is unavailable the property is
omitted; a zero would be indistinguishable from an instantaneous load and would
quietly drag every average down.

#### Cloudflare layer

Zone/edge Analytics satisfies R5 with **no code change**: read it in the
dashboard.

Cloudflare Web Analytics is optional and separate. If enabled, prefer automatic
injection on the proxied production hostname, and then:

- keep `connect-src 'self'`;
- allow exactly `https://static.cloudflareinsights.com` in `script-src`;
- make the same edit to **both** the global `/*` policy and the separately
  defined `/viz/*` policy — the latter unsets the former (C3) — or exclude
  `/viz/*` from Web Analytics, or explicitly accept that the map is unmeasured;
- verify the injected script carries SRI and that `/cdn-cgi/rum` receives
  POSTs;
- verify Astro `ClientRouter` navigations are counted once, since Cloudflare's
  SPA tracking keys off soft-navigation/Navigation API/History API signals;
- do not treat automatic injection on a `*.workers.dev` preview URL as proof of
  production hostname behaviour.

The manual-snippet fallback additionally needs `https://cloudflareinsights.com`
in `connect-src` — a different CSP change, not to be committed speculatively.

#### Configuration and environments

- `PUBLIC_POSTHOG_KEY` stays a GitHub repository **variable**, not a secret: it
  is a publishable `phc_…` project token that ships in the bundle, and masking
  it only makes CI logs harder to read.
- `PUBLIC_ANALYTICS_ENABLED` (or equivalent) is the explicit production switch.
- Normal previews stay disabled. A documented test build points at a **separate
  PostHog test project** so end-to-end verification is possible before
  production (P5).
- `.env.example` documents both variables with no real values.
- `AGENTS.md` gains a short section describing the analytics layer, `/sawdust`,
  the region, the event dictionary, the cookieless project setting and the
  opt-out key — so a future agent does not "clean up" an unexplained Worker or
  CSP host.

### Implementation phases

**Phase 0 — Privacy and project decisions (no code).** Choose the US or EU
PostHog region. Create separate production and test projects. Enable
**Cookieless server hash mode in each project** — PostHog drops cookieless
events if the project-side setting is absent. Set retention, disable session
replay and surveys, decide on GeoIP. Draft the analytics disclosure and the
opt-out control. **Enable Cloudflare Web Analytics now**, with the CSP edits
under *Cloudflare layer*, so a field baseline is accumulating before
`posthog-js` ships — see [Cloudflare's free
tier](#cloudflares-free-tier-what-it-already-covers). Set the `image_cost`
sampling rate and confirm that bucketed viewport and DPR are acceptable to
record (P6).

**Phase 1 — Worker proxy.** `src/worker/index.ts`, the `wrangler.jsonc` change,
wrangler and generated binding types as devDependencies, and the three scripts
above.

**Phase 2 — Minimal PostHog client.** `npm i posthog-js`,
`src/scripts/analytics.ts`, the `BaseLayout.astro` hook, the opt-out plumbing.

**Phase 3 — Explicit instrumentation.** Annotations on the real controls, the
delegated handler, the chapter observer.

**Phase 3b — Timing instrumentation.** The `capture_performance` flag,
`src/scripts/perf.ts`, the `src/lib/image-cost.ts` extraction shared with the
probe, and the two DOM events dispatched by `photo-viewer.ts`. Separable from
Phase 3 and independently revertable: R1–R5 do not depend on any of it.

**Phase 4 — Cloudflare baseline.** Read edge Analytics, and read the Web
Analytics data that has been accumulating since Phase 0 — including its pageview
ratio against PostHog. Enabling the beacon is no longer this phase's work; it
moved ahead of the PostHog build for the reasons in [Cloudflare's free
tier](#cloudflares-free-tier-what-it-already-covers), and this is where the
keep-or-retire rule is applied.

**Phase 5 — Configuration, documentation, rollout.** CI variables,
`.env.example`, `AGENTS.md`, recorded vendor limits and a usage alert.

## Verification and acceptance criteria

### Build and Worker

1. `npm run build` succeeds, postbuild guards included.
2. Generated Worker types are current; `wrangler deploy --dry-run` succeeds.
3. `npm run preview:worker` serves `/` and `/software` with the existing
   routing (no trailing-slash redirect) and the full `_headers` security set.
4. `/sawdust/static/array.js` reaches the selected PostHog asset host — a proxy
   smoke test only, not proof of ingest.
5. A **browser-generated** `/sawdust/e/` POST reaches PostHog with its binary
   body and query intact, and the corresponding event appears in the project.
   Worker-side inspection confirms cookies are stripped and the forwarding
   header policy is as documented.
6. No request can steer the proxy to an arbitrary upstream host.

### Analytics behaviour

1. A direct page load produces exactly one `$pageview`.
2. Home → Software, Back and Forward each produce exactly one pageview for the
   resulting pathname. `/#about` produces a navigation/chapter event but no
   duplicate pathname pageview.
3. Leaving a page produces matching previous-page duration and scroll
   properties, with percentages in `0..1` (bottom ≈ `1`, not `100`).
4. Hero, About, Work, Archive and Contact each emit **once** on a full Home
   traversal — desktop with the pinned archive, mobile, reduced motion, and a
   direct `/#about` arrival. Scrolling back does not repeat them.
5. Every annotated control emits its documented event and properties, and no
   payload contains the email address, DOM hierarchy, visible copy or
   unexpected high-cardinality values.
6. The email event is delivered before control passes to the mail client.

### Timing and performance data

1. A hard load reports web vitals and one `page_load_timing` with
   `nav_type: 'hard'`; a ClientRouter navigation reports one with
   `nav_type: 'soft'` and a `render_ms`, and **no** second set of vitals.
2. A browser lacking an entry type omits the property. No metric arrives as `0`
   where it means "not measured".
3. `image_cost` fires at the configured sampling rate, and its `images`,
   `bytes_kb` and cache counts agree with what `?stats=true` shows on the same
   device and page, and with `npm run measure:images` for that build. Three
   numbers that disagree mean the shared `image-cost` module is wrong.
4. Opening a photograph reports `photo_viewer_opened` once per open, from each
   of the three sources (gallery link, hash/`popstate`, prev/next step), with
   `warm` reflecting whether it was already decoded.
5. Zoom reports `to_standin_ms` and `to_master_ms` separately, `to_master_ms: 0`
   with `warm: true` on a repeat zoom of the same frame, and reports **nothing**
   for a hold released before the master lands or a zoom superseded by a newer
   one.
6. No timing payload contains a URL, a full image path, or an unbucketed
   viewport/DPR value.
7. `npm run build` still passes `scripts/check-asset-sizes.mjs` — extracting
   `src/lib/image-cost.ts` must not pull the probe's HUD onto the critical path,
   and the analytics chunk must not import `image-perf.ts`.

### Privacy and environment isolation

1. A normal visit leaves no PostHog identity in cookies, `localStorage` or
   `sessionStorage`; only the named site opt-out preference may persist.
2. GPC, DNT and the site opt-out each prevent `/sawdust` requests entirely.
3. Opting out **mid-visit** stops collection in the same ClientRouter session,
   not only after a reload.
4. Local development and PR previews produce no production data.
5. The documented test mode works and is visibly separated from production.

### CSP, Cloudflare and performance

1. No CSP violations on `/`, `/software`, `/photography` or
   `/viz/gta-crime-map.html`.
2. If Web Analytics is enabled, automatic injection loads through the exact
   allowed script path and posts same-origin to `/cdn-cgi/rum` in production.
3. Neither browser tool double-counts Astro soft navigations.
4. A production build is compared before and after for transferred JavaScript,
   long tasks during the Home reveal, and LCP. **Record the measurement**
   rather than relying on the first draft's unverified SDK-size estimate. This
   is the lab half; `long_task_ms` and LCP from R6 are the field half, and the
   first production day is when they are compared against it.
5. `npm audit --audit-level=high` is clean after adding `posthog-js` and
   wrangler, and the smoke suite still passes.

Roll out as a Cloudflare Worker version that can be rolled back in one step.
After the first production day, inspect event volume, property cardinality,
duplicate pageviews, chapter progression, pageleave coverage, Worker request
counts and vendor quota consumption before calling the work done.

## Alternatives considered

| Option | Cost | Satisfies | Verdict |
| --- | --- | --- | --- |
| **A.** Cloudflare zone/edge Analytics alone | Zero — no code, no script | R5 only | Rejected as the whole answer; **adopted as a component**. |
| **B.** Cloudflare Web Analytics alone | One beacon, one CSP host | Partial R2 and R6, no R1/R3/R4/R7 | Rejected; optional add-on at most. |
| **C.** PostHog direct to vendor hosts, no proxy | Two CSP exceptions, no Worker | R1–R4 | Rejected on measurement validity for this audience. |
| **D.** PostHog with autocapture + localStorage (the first draft) | Lowest build cost | R1–R4, fails P1/P2 | Rejected. |
| **E.** Self-hosted (Umami, Plausible CE, Matomo) | A service, a database, backups, patching | R1–R5, best privacy story | Rejected against C5. |
| **F.** Paid hosted privacy analytics (Plausible, Fathom) | ~$9–14/month | R1–R3, R4 with the same instrumentation work | Rejected on cost for a personal site; the natural upgrade if PostHog's free tier stops fitting. |
| **G.** Minimal free hosted (GoatCounter, Counter.dev) | Tiny script | R2 partially, not R3/R4 | Rejected on capability. |
| **H.** Build our own: Worker + Analytics Engine/D1 + tiny beacon | We own ingest, schema, retention, bot filtering, dashboards | R1–R7, no third-party processor | Rejected as the primary; kept as the escape hatch. |
| **I.** Lab-only performance measurement (Lighthouse CI, Playwright traces) | CI time, no field data, no privacy surface | R6 in the lab, never R7 in the field | Rejected as the answer to R6; **worth adding alongside**. |

**A. Cloudflare zone/edge Analytics alone.** Free, invisible, unblockable,
already running. On this site's **Free** zone it reports requests, bandwidth,
unique visitors and countries, delayed 24 hours — and nothing about clicks,
dwell or depth. Paths, referrers and page views are the Pro-and-above
"Privacy-first HTTP Traffic Analytics", so the free baseline is a site-level
number rather than a per-page one. It fails R1–R4 outright. Its value is
precisely that it is the one dataset a blocker cannot touch, which is why it is
adopted as the R5 baseline rather than discarded.

**B. Cloudflare Web Analytics alone.** Adds pageviews, visits, referrers and
page-load timing from a browser beacon, with no cookies. But it has no custom
events, no scroll depth and no chapter concept, so R1, R3 and R4 are
unreachable. The first draft's framing of it as "an unblockable traffic
baseline" was simply wrong: it is JavaScript, and it is blockable. Where it is
better than this list first credited is R6: since 2026-08-21 it measures
Astro-style soft navigations natively, which is the one thing C2 otherwise
forces this design to hand-roll. It survives here as an optional performance
cross-check and as the blocked-rate probe described under [Cloudflare's free
tier](#cloudflares-free-tier-what-it-already-covers).

**C. PostHog direct, no proxy.** The cheapest path to R1–R4: skip the Worker
entirely and let the SDK talk to `us.i.posthog.com`. Two objections. First, it
requires a `connect-src` exception (and, if the SDK is not bundled, a
`script-src` one too), which is a permanent widening of C3. Second, and worse,
this site's audience is developer-heavy and `i.posthog.com` is on the common
blocklists — the resulting data would be biased in exactly the population the
site is written for, with no way to tell how badly. **Revisit if** the Worker
turns out to be operationally painful and the bias is measured as small
against the edge baseline.

**D. PostHog with autocapture and localStorage persistence.** This was the
first draft, and its appeal is real: instrumentation becomes attribute edits
with no handler code, and PostHog's bounce metric comes free. It is rejected
because it fails two stated requirements rather than because it is
unattractive. `persistence: 'localStorage'` stores a durable visitor ID (P1),
and autocapture ships link text, class lists, element ancestry and `href`
values — including the `mailto:` address that is the site's only conversion
(P2). **Revisit narrowly:** autocapture scoped to clicks on annotated anchors
and buttons is an acceptable addition if the bounce card proves valuable and
real payloads are inspected first.

**E. Self-hosted open-source analytics.** Umami, Plausible CE or Matomo on our
own infrastructure gives complete data ownership, no third-party processor and
no free-tier ceiling. It costs a running service, a database, backups, upgrades
and a security surface — for one personal portfolio. That is a direct
contradiction of C5, and it is the clearest rejection in this list.

**F. Paid hosted privacy analytics.** Plausible or Fathom are cookieless by
default, ship a much smaller script than `posthog-js`, and have a simpler
privacy story to disclose. Three reasons they lose here: monthly cost for a
personal site; custom events with structured properties are the weaker part of
their product, and R4 depends entirely on custom events; and blocker resistance
still needs the same proxy work, so the Worker is not avoided. **Revisit if**
PostHog's free tier changes, or if the SDK's measured weight (see acceptance
criterion 4 under performance) turns out to hurt the landing animation.

**G. GoatCounter, Counter.dev and similar.** Admirably small and free. No
reliable scroll depth, no event properties worth building a dictionary on.
R3 and R4 are out of reach, so they cannot be the answer for a site whose main
question is "did anyone read to the end".

**H. Build our own.** A `/sawdust`-style Worker already exists in this design;
pointing it at Workers Analytics Engine instead of PostHog would keep every
byte first-party, remove the processor from the privacy disclosure entirely,
and impose no vendor quota. The event set here is small enough that ingest is
genuinely a day's work. What is *not* a day's work is everything after ingest:
schema evolution, retention, bot filtering, session stitching, and — most of
all — a query and dashboard layer, since Analytics Engine offers a SQL API and
expects you to bring Grafana. That is a second product to maintain, and C5 says
no. **Revisit if** PostHog's pricing or limits change, or if the privacy
disclosure becomes a reason to remove the processor: the Worker boundary in
this design is deliberately the seam where that swap would happen.

**I. Lab-only performance measurement.** Lighthouse CI or a Playwright trace on
every PR would catch a regression before it ships, deterministically, with no
visitor data involved at all — and this repository already runs a Playwright
suite, so the harness exists. It cannot answer R6 or R7, because the questions
are about *devices we do not own*: which srcset rung a 3× phone on a slow
connection actually chose, and how long its zoom took to sharpen. A lab machine
answers a different question very well. **Adopt it as a complement** when
regressions start slipping through; it is not a substitute, and neither is a
substitute for the other.

## Risks and open questions

**Open decisions (Phase 0 blocks on these).**

1. PostHog **US or EU** region — a deployment decision that must be recorded in
   one Worker config block and in the privacy disclosure.
2. Whether to **keep** Cloudflare Web Analytics past the first few weeks.
   Enabling it no longer blocks Phase 0 — that phase turns it on — but the
   second beacon and its CSP host in two places are only worth keeping under
   the rule in [Cloudflare's free
   tier](#cloudflares-free-tier-what-it-already-covers), and that call needs
   production numbers.
3. Whether project cards and the Home *All projects* / *View the archive* links
   are in scope for R1.
4. Whether PostHog's autocapture-derived bounce metric matters enough to enable
   the narrow autocapture exception under D.
5. The `image_cost` sampling rate, and whether bucketed viewport and DPR are
   acceptable to record at all (P6). Recording neither still leaves R6 intact;
   it costs R7 its explanatory half.

**Risks.**

- **Vendor free-tier limits are external state.** Record them at implementation
  time and set a usage alert; do not encode them as repository facts.
- **`$pageleave` is best effort.** R2 and R3 both ride on it, so some visits
  will report no duration and no scroll depth. R4 does not depend on pageleave,
  which is a second reason it is the primary depth metric.
- **The pinned archive may distort scroll percentage badly** (C4). If
  `max_scroll_percentage` clusters near zero in practice, that is expected
  behaviour to document, not a bug to chase — the chapter events carry the
  meaning.
- **The chapter viewport band needs tuning** against the real pinned layout,
  desktop and mobile, before its numbers can be trusted.
- **`decode()` resolving is not the same as a frame on screen.** The viewer
  timings measure to the first `requestAnimationFrame` after the decode
  settles, which is close but not identical to presentation time. It is a
  consistent definition, so trends are trustworthy; the absolute number should
  not be quoted as "time to pixels".
- **Browser coverage for timing APIs is uneven**, so R6 will be
  better-populated on Chromium than elsewhere. Segment by browser before
  concluding that anything got faster or slower.
- **Field and lab numbers will disagree**, and that is not a bug. The lab
  measures a controlled machine; R6 measures whatever hardware and network a
  visitor brought. Neither corrects the other.
- **Timing instrumentation is the part most likely to be cut.** It is the least
  privacy-sensitive and the most code, which is why it is Phase 3b and
  independently revertable.
- **Adding a Worker to a deployment that has never had one** is the largest
  structural risk here. Selective `run_worker_first` keeps normal asset
  requests off the Worker path, and rollout is a rollbackable Worker version;
  acceptance criterion 3 under *Build and Worker* exists specifically to prove
  the site is byte-identical.
- **A dependency added to a repo with enforced CI gates** — `posthog-js` and
  wrangler must clear `npm audit --audit-level=high`, dependency review and
  CodeQL.

**Known gaps, accepted.**

- `/viz/gta-crime-map.html` inherits no analytics and is counted only at the
  edge.
- Blockers are defeated for the endpoint, not for heuristics; a residual loss
  is expected and the edge baseline is the cross-check.
- Session replay stays off. Turning it on later needs `worker-src 'self' blob:`
  in the CSP and a fresh look at the no-banner position.

## Cloudflare's free tier: what it already covers

Added 2026-09-10, after the design above had settled. The question it answers:
the site is already on Cloudflare, Cloudflare gives analytics away, so how much
of R1–R7 arrives for free — and is the PostHog layer buying anything the
platform does not already provide?

Everything below is vendor state, read from Cloudflare's documentation on
2026-09-10 and linked in *References*. Re-verify at implementation time; free
tiers move.

### Four products, not one

"Cloudflare Analytics" is four separate things with four different answers, and
conflating them is how the first draft ended up calling a JavaScript beacon
unblockable.

| Product | What the free tier actually gives | Blockable? |
| --- | --- | --- |
| **Zone / HTTP traffic analytics** | On a **Free** zone: Requests, Bandwidth, Unique Visitors and a requests-by-country map, with metrics delayed **24 hours**. Data Transfer, Page Views, Visits, API Requests and path/referrer breakdowns are the Pro-and-above "Privacy-first HTTP Traffic Analytics". | No — counted at the edge |
| **Web Analytics** | Free on every plan. Visits, page views, page load time, Core Web Vitals. Dimensions: country, host, path, referer, device type, browser, OS, site, navigation type, plus an exclude-bots filter. **No custom events at any tier.** | Yes — Cloudflare's own FAQ names Adblock Plus and Brave |
| **GraphQL Analytics API** | The export seam for both of the above; RUM data is account-scoped (`rumPageloadEventsAdaptiveGroups`). Dataset selection and query window widen with plan. | n/a |
| **Workers Analytics Engine** | Workers Free: 100k data points written per day, 10k read queries per day, three-month retention, currently unbilled. Ingest plus a SQL API — no dashboard. | n/a — first-party |

Zaraz is sometimes counted as a fifth (1M events/month free, all plans). It is a
tag loader, not an analytics product: it would still need a destination, and the
destination would be PostHog. It changes how an SDK is delivered, not what is
measured, so it is out of scope here.

Two retention numbers matter more than they look. Web Analytics keeps beacon
data unsampled for **7 days**, then aggregates it to roughly 10% for long-term
storage, and applies dynamic sampling between 0.0001% and 100% depending on
volume and filters. Free zone analytics is a 24-hour dashboard window. PostHog's
free tier retains **one year**. Any question of the form "is this better than it
was last spring" is answerable in exactly one of these.

### Scorecard: the free tier against R1–R7

| Req | Cloudflare free tier alone | Verdict |
| --- | --- | --- |
| R1 named control clicks | No custom events exist in the product. The `mailto:` CTA generates no edge request either, so the site's only conversion is invisible to both Cloudflare datasets. | **Out of reach** |
| R2 time on site | Visits and page views, not session duration or time on page. | **No** |
| R3 scroll depth | Not a concept in either product. | **Out of reach** |
| R4 narrative chapter | Requires custom events. | **Out of reach** |
| R5 traffic baseline | Zone analytics, and only zone analytics. Site-level on Free — requests and countries, 24 hours delayed — rather than the per-path baseline. | **Yes; this is why A is adopted** |
| R6 page load | Page load time and Core Web Vitals, split by `navigationType`, for zero instrumentation. Missing: `long_task_ms`, the mark-to-first-frame `render_ms`, and any correlation with an R1–R4 event. | **Substantially yes** |
| R7 image cost, viewer latency | Custom events again, plus per-image resource timing the product does not collect. | **Out of reach** |

R6 is the row that changed while this document was being written. Cloudflare
shipped native Soft Navigation API measurement on **2026-08-21**:
`navigationType` now carries `soft-navigation` and `routing-apis` alongside
`navigate`, and LCP is measured on soft navigations. That is precisely the
hard-versus-soft split C2 forces this design to hand-roll in `page_load_timing`,
arriving free and with no code. The caveat is the usual one — the Soft
Navigation API is a Chromium feature, so treat coverage elsewhere as unproven
until it is checked, which is the same browser-skew warning R6 already carries.

### The choice is not "one or the other"

Zone analytics is free, already running, needs no code and cannot be blocked.
There is no version of this design in which it is switched off — the
*Recommendation* adopts it as the R5 baseline for exactly that reason. So the
real question is narrower than it first appears:

- **Cloudflare alone** — zone analytics, plus the Web Analytics beacon.
- **Cloudflare and PostHog** — the design above, with zone analytics underneath
  it.

The Web Analytics beacon is the only genuinely optional component in either
column, and the only one that costs a CSP edit.

### When Cloudflare alone is the right answer

Choose it, and stop, if any of these hold:

- **Chapter depth and CTA clicks would not change anything.** R1–R4 are worth
  their cost only if a low `chapter_viewed` count for Archive would actually
  cause the landing page to be rewritten. If the honest answer is no, the whole
  PostHog layer is instrumentation for its own sake.
- **The Worker is a step too far.** C1 is candid that a `main` entry point, an
  `ASSETS` binding and a Worker deploy path are the largest structural change
  here, on a deployment that has never had a Worker. Cloudflare's free tier
  needs none of it.
- **Keeping a named processor out of the privacy disclosure matters more than
  R1–R4.** Web Analytics sets nothing client-side and collects no personal data,
  so P1–P4 become close to trivial and the no-banner position gets much easier
  to defend.
- **Traffic is unknown.** At genuinely low volume per-event data is noise, and
  the free baseline is how that gets discovered before anything is built.

What the choice forfeits, stated plainly: every question in *Purpose* except the
cost one. Whether anyone reads past the first chapter, whether the contact CTA
is ever used, whether the photography archive is reached at all — none of them
survive.

### Sequencing: enable Web Analytics in Phase 0, not Phase 4

This is the change the evaluation actually recommends, and it holds whichever
column wins.

1. **It is the only way acceptance criterion 4 becomes a field measurement.**
   That criterion asks for a production build compared before and after for
   transferred JavaScript, long tasks and LCP. Lab numbers can be taken at any
   time; *field* LCP from before `posthog-js` shipped can only be collected
   before `posthog-js` ships. Turning the beacon on in Phase 0 costs one CSP
   host and buys a baseline that cannot be reconstructed afterwards.
2. **It sizes the problem before structure is committed.** Real visit counts say
   whether PostHog's free tier is anywhere near binding — at roughly a dozen
   events per gallery visit, 1M events/month is about 83,000 visits, and usage
   stops at the free tier rather than billing by surprise — and whether R1–R4
   will have the volume to mean anything.
3. **It creates a three-tier cross-check that nothing else can.** Each dataset
   sees a strictly smaller population than the one before it, and the gaps are
   the interesting part:

```text
edge requests  ≥  CF Web Analytics pageviews  ≥  PostHog pageviews
               ^                              ^
               bots + JavaScript-off          analytics blocking
```

The first gap is bots and JavaScript-off traffic. The second is a standing
estimate of how much of this developer-heavy audience blocks analytics — the
bias alternative C raises and then declares unmeasurable. With both beacons
running it becomes a number, and `/sawdust` can be judged on evidence rather
than on the assumption that a neutral path works.

Phase 4 survives, but becomes *reading* the baseline rather than establishing
it.

### Keep-or-retire rule for the second beacon

Open decision 2 asked whether Web Analytics earns a second browser beacon and a
CSP edit made in two places. It does — to start. Whether it keeps earning it is
a question for production data, settled by this rule after the first few weeks:

**Keep it if** the Cloudflare-to-PostHog pageview ratio is a number worth
watching — it is, if it is either large or moving — **or** if PostHog's own
vitals arrive sparse, since `$pageleave` is best effort and browser coverage for
the underlying entry types is uneven.

**Retire it if** the ratio settles somewhere stable and uninteresting and the
duplicated vitals have become two numbers that disagree with no way to
adjudicate. Retiring means removing the `script-src` host from **both** the `/*`
and `/viz/*` blocks — C3 cuts in both directions.

Three honest costs, so the decision is not made on the upside alone: a second
beacon on every page, including the ones this design works hardest to keep
light; a CSP host that must be added in two places and removed from two places;
and sampling that degrades the cross-check with age — read the ratio weekly
while the 7-day unsampled window still holds it, not retrospectively against a
10% aggregate.

### What the free tier does not change

**Quota was never the constraint.** PostHog free is 1M events/month. Workers
Free is 100k requests/day, and static-asset requests are free, unlimited and
excluded from that count, so under the selective `run_worker_first` in the
*Worker proxy* section only `/sawdust/*` consumes it. Analytics Engine free is
100k data points/day. At this site's scale none of them binds. The real
constraints stay what the design already optimises for — CSP surface, page
weight and what has to be disclosed. Choose on capability and weight, not on
limits.

**Alternative H's cost estimate improves; its verdict does not.** Analytics
Engine at 100k data points/day is roughly 8,300 visits/day at this event shape:
free, retained three months, first-party, with no processor to disclose. The
objection was never ingest cost — it was that Analytics Engine ships a SQL API
and expects you to bring Grafana. That is still a second product to maintain,
and C5 still says no.

**Bottom line.** Use both, in this order. Zone analytics is already the R5
baseline and stays. Web Analytics goes on in Phase 0 as a free R6 baseline and
blocked-rate probe, and is reviewed against the rule above once there is data.
PostHog is what buys R1, R3, R4 and R7 — the questions this document exists to
answer — and nothing in Cloudflare's free tier substitutes for it at any tier.

## References

- [PostHog JavaScript configuration](https://posthog.com/docs/libraries/js/config)
- [PostHog cookieless tracking](https://posthog.com/tutorials/cookieless-tracking)
- [PostHog Cloudflare reverse proxy](https://posthog.com/docs/advanced/proxy/cloudflare)
- [PostHog Web Analytics dashboard](https://posthog.com/docs/web-analytics/dashboard)
- [Cloudflare static asset bindings and selective worker-first routing](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Cloudflare Web Analytics setup](https://developers.cloudflare.com/web-analytics/get-started/)
- [Cloudflare Web Analytics CSP and automatic-injection FAQ](https://developers.cloudflare.com/web-analytics/faq/) — also the source for beacon blocking, the 7-day unsampled window and dynamic sampling
- [Cloudflare Web Analytics SPA tracking](https://developers.cloudflare.com/web-analytics/get-started/web-analytics-spa/)
- [PostHog web vitals and performance capture](https://posthog.com/docs/web-analytics/web-vitals)
- [`web-vitals` metric definitions](https://web.dev/articles/vitals) — what TTFB, FCP, LCP, CLS and INP mean, and what they do not
- [MDN: PerformanceObserver and `longtask` entries](https://developer.mozilla.org/en-US/docs/Web/API/PerformanceObserver)
- [MDN: `HTMLImageElement.decode()`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLImageElement/decode)
- [Astro ClientRouter lifecycle events](https://docs.astro.build/en/guides/view-transitions/#lifecycle-events)
- [Cloudflare Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/) — alternative H
- [Cloudflare Web Analytics changelog](https://developers.cloudflare.com/changelog/product/web-analytics/) — the 2026-08-21 soft-navigation measurement entry
- [Cloudflare Web Analytics high-level metrics](https://developers.cloudflare.com/web-analytics/data-metrics/high-level-metrics/) — how visits and page views are defined
- [Cloudflare Web Analytics dimensions](https://developers.cloudflare.com/web-analytics/data-metrics/dimensions/) — including navigation type and the exclude-bots filter
- [Cloudflare Web Analytics data origin and collection](https://developers.cloudflare.com/web-analytics/data-metrics/data-origin-and-collection/)
- [Cloudflare zone analytics](https://developers.cloudflare.com/analytics/account-and-zone-analytics/zone-analytics/) — what a Free zone gets, and where Pro begins
- [Cloudflare analytics FAQ](https://developers.cloudflare.com/analytics/faq/about-analytics/) — the 24-hour delay on Free, and why edge counts differ from browser counts
- [Workers Analytics Engine limits](https://developers.cloudflare.com/analytics/analytics-engine/limits/) and [pricing](https://developers.cloudflare.com/analytics/analytics-engine/pricing/) — the free write and read allowances behind alternative H
- [Workers platform limits](https://developers.cloudflare.com/workers/platform/limits/) and [pricing](https://developers.cloudflare.com/workers/platform/pricing/) — static-asset requests are excluded from the free request count
- [Cloudflare Zaraz pricing](https://developers.cloudflare.com/zaraz/pricing-info/)
- [PostHog pricing and free-tier allowances](https://posthog.com/pricing)
