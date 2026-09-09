# Front-end analytics design

Status: proposed — nothing in this document is implemented

Last reviewed: 2026-09-09

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

## Requirements

### Functional

| ID | Requirement | Notes |
| --- | --- | --- |
| R1 | Which named control was activated | An allowlisted set of navigation, CTA, project, disclosure, theme, photo and map controls. Not "every click on the page". |
| R2 | How long a visitor stayed | Per-page elapsed time and aggregate session duration. |
| R3 | How far a visitor scrolled | Document depth per pageview. |
| R4 | Which narrative chapter was reached | `hero → about → work → archive → contact` on Home. Added by this design; see C4 for why R3 alone is not enough. |
| R5 | A traffic baseline that does not depend on a browser script | Something to sanity-check R1–R4 against when a visitor blocks JavaScript analytics. |

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
| R5 traffic baseline | Cloudflare zone/edge Analytics | Requests reaching Cloudflare. Do not expect it to reconcile one-for-one with PostHog sessions or pageviews. |
| Optional performance view | Cloudflare Web Analytics | Browser RUM and SPA navigation metrics, if explicitly enabled. A cross-check, not a baseline. |

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
  capture_performance: false,
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
opt-out control. Decide whether Web Analytics earns its second beacon.

**Phase 1 — Worker proxy.** `src/worker/index.ts`, the `wrangler.jsonc` change,
wrangler and generated binding types as devDependencies, and the three scripts
above.

**Phase 2 — Minimal PostHog client.** `npm i posthog-js`,
`src/scripts/analytics.ts`, the `BaseLayout.astro` hook, the opt-out plumbing.

**Phase 3 — Explicit instrumentation.** Annotations on the real controls, the
delegated handler, the chapter observer.

**Phase 4 — Cloudflare baseline.** Read edge Analytics. Enable Web Analytics
only if Phase 0 decided it is worth it, with the CSP edits above.

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
   rather than relying on the first draft's unverified SDK-size estimate.
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
| **B.** Cloudflare Web Analytics alone | One beacon, one CSP host | Partial R2, no R1/R3/R4 | Rejected; optional add-on at most. |
| **C.** PostHog direct to vendor hosts, no proxy | Two CSP exceptions, no Worker | R1–R4 | Rejected on measurement validity for this audience. |
| **D.** PostHog with autocapture + localStorage (the first draft) | Lowest build cost | R1–R4, fails P1/P2 | Rejected. |
| **E.** Self-hosted (Umami, Plausible CE, Matomo) | A service, a database, backups, patching | R1–R5, best privacy story | Rejected against C5. |
| **F.** Paid hosted privacy analytics (Plausible, Fathom) | ~$9–14/month | R1–R3, R4 with the same instrumentation work | Rejected on cost for a personal site; the natural upgrade if PostHog's free tier stops fitting. |
| **G.** Minimal free hosted (GoatCounter, Counter.dev) | Tiny script | R2 partially, not R3/R4 | Rejected on capability. |
| **H.** Build our own: Worker + Analytics Engine/D1 + tiny beacon | We own ingest, schema, retention, bot filtering, dashboards | R1–R5, no third-party processor | Rejected as the primary; kept as the escape hatch. |

**A. Cloudflare zone/edge Analytics alone.** Free, invisible, unblockable,
already running. It reports requests, paths, referrers and countries — and
nothing about clicks, dwell or depth. It fails R1–R4 outright. Its value is
precisely that it is the one dataset a blocker cannot touch, which is why it is
adopted as the R5 baseline rather than discarded.

**B. Cloudflare Web Analytics alone.** Adds pageviews, visits, referrers and
page-load timing from a browser beacon, with no cookies. But it has no custom
events, no scroll depth and no chapter concept, so R1, R3 and R4 are
unreachable. The first draft's framing of it as "an unblockable traffic
baseline" was simply wrong: it is JavaScript, and it is blockable. It survives
here only as an optional performance cross-check.

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

## Risks and open questions

**Open decisions (Phase 0 blocks on these).**

1. PostHog **US or EU** region — a deployment decision that must be recorded in
   one Worker config block and in the privacy disclosure.
2. Whether Cloudflare Web Analytics earns a second browser beacon and a CSP
   edit made in two places.
3. Whether project cards and the Home *All projects* / *View the archive* links
   are in scope for R1.
4. Whether PostHog's autocapture-derived bounce metric matters enough to enable
   the narrow autocapture exception under D.

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

## References

- [PostHog JavaScript configuration](https://posthog.com/docs/libraries/js/config)
- [PostHog cookieless tracking](https://posthog.com/tutorials/cookieless-tracking)
- [PostHog Cloudflare reverse proxy](https://posthog.com/docs/advanced/proxy/cloudflare)
- [PostHog Web Analytics dashboard](https://posthog.com/docs/web-analytics/dashboard)
- [Cloudflare static asset bindings and selective worker-first routing](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Cloudflare Web Analytics setup](https://developers.cloudflare.com/web-analytics/get-started/)
- [Cloudflare Web Analytics CSP and automatic-injection FAQ](https://developers.cloudflare.com/web-analytics/faq/)
- [Cloudflare Web Analytics SPA tracking](https://developers.cloudflare.com/web-analytics/get-started/web-analytics-spa/)
- [Cloudflare Workers Analytics Engine](https://developers.cloudflare.com/analytics/analytics-engine/) — alternative H
