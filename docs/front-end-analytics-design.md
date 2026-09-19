# Front-end analytics design

Status: **implemented** — Phases 1, 2, 3, 3b and the code half of Phase 5 are
in the tree. Phase 0 (the PostHog
account, projects and project-side settings) and Phase 4 (reading the Cloudflare
dashboards) are account work that has to be done by hand; see
[What is left](#what-is-left) at the end.

**The storage decision changed on 2026-09-19**, and the code changed with it in
the same edit. R8–R10 and the rewritten P1 below adopt a durable first-party
identifier in place of cookieless server-hash mode; `src/scripts/analytics.ts`
and `/privacy` implement it. R10 alone is **not** implemented and remains
conditional — see
[First-touch attribution without profiles](#first-touch-attribution-without-profiles).

Last reviewed: 2026-09-19 · Implemented: 2026-09-10 · Storage decision revised:
2026-09-19

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

- Per-person identity in the sense of knowing *who* someone is: real names,
  person profiles carrying attributes, or funnels presented per individual.
  **Amended 2026-09-19** — cross-session stitching by an anonymous first-party
  identifier is now in scope (R8, R10). What stays out is attaching anything
  identifying to that identifier, or ever presenting one visitor's path.
- Session replay, heatmaps, dead-click/rageclick detection, exception capture,
  surveys, feature flags, or A/B testing.
- Marketing attribution beyond referrer and campaign parameters. **Amended
  2026-09-19** — R10 brings first-touch referrer into scope. Multi-touch
  models, ad-network integrations and conversion pixels stay out.
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
| R8 | Whether a visitor has been here before | New versus returning, and how many distinct people a multi-day date range actually represents. Requires an identifier that outlives one visit; see P1. |
| R9 | Roughly where visitors are, and whether they are human | Country and region enrichment on PostHog events, and PostHog's server-side IP-reputation bot filtering. Both are IP-derived; see [Why R9 was previously impossible](#why-r9-was-previously-impossible). |
| R10 | How someone first arrived, across visits | The referrer and campaign parameters of a visitor's **first** visit, still attached to the visit where they click the contact CTA. |

R6 and R7 are the reason the analytics layer has to justify its own weight
twice over: it is measuring a page whose whole argument is that it feels fast,
so the measurement must be small enough not to be the thing that slows it down.
Acceptance criterion 4 under *CSP, Cloudflare and performance* exists for
exactly that, and R6 is what tells us afterwards whether it held in the field.

R8–R10 were added on 2026-09-19, together with the P1 rewrite that makes them
reachable. They are not new questions — R8 and R10 were previously listed as
non-goals and R9 as an open Phase 0 decision — so the [Non-goals](#non-goals)
section above was amended in the same edit rather than left to contradict them.

The three are ranked by what they are worth here, and the ranking matters
because only R8 is free:

- **R8 is the one that fixes an existing number rather than adding one.** Under
  cookieless server-hash mode PostHog's salt rotates daily, so a visitor who
  returns on three days counts as three people. Every "unique users" figure over
  a window longer than 24 hours was therefore *unique user-days*, silently. R8
  is as much a correctness fix for R2's audience denominator as it is a new
  capability.
- **R9 costs nothing extra once P1 changes** — it is enrichment PostHog applies
  during ingestion, with no client code at all.
- **R10 is the weakest and the only one with a design cost**, and it is the one
  that may not survive verification; see
  [First-touch attribution without profiles](#first-touch-attribution-without-profiles).

#### Why R9 was previously impossible

Worth recording, because it looks like a project setting and is not. In
cookieless server-hash mode the visitor's IP address *is* the identity input:
PostHog hashes it together with the user agent, a daily-rotating salt and
project scoping to synthesise a `distinct_id`, then strips the raw IP **before
the transformation stage of the ingestion pipeline runs**. GeoIP enrichment and
IP-reputation bot detection are transformations. By the time they execute there
is no IP left to read, so they enrich nothing.

That is why "decide on GeoIP" sat unresolved in Phase 0 for as long as it did:
under the old P1 it was not a decision to make. It became one the moment the
identifier stopped being derived from the IP.

Two consequences survive the change and should not be forgotten. The Worker's
`X-Forwarded-For` forwarding from `CF-Connecting-IP` stays **required** — it is
now what GeoIP reads instead of what the hash consumed, so removing it still
breaks the feature, just a different one. And the client-side bot filter in
`posthog-js` is a *separate* mechanism from the server-side one R9 restores: it
matches user agents in the browser and has been working throughout, which is why
the Playwright verification in
[What was verified locally](#what-was-verified-locally-and-how) needed
`opt_out_useragent_filter`. R9 adds IP-reputation filtering underneath it; it
does not replace it.

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
| P1 | Analytics identity is a **first-party, anonymous** durable identifier, written by `posthog-js` to this origin only. No third-party cookie, no identifier shared with or readable by another domain, and nothing identifying ever attached to it. Its storage key is named in the disclosure. **Revised 2026-09-19**; this requirement previously read *"a normal visit leaves no analytics identifier in cookies, `localStorage` or `sessionStorage`"*, and that wording is what R8 and R10 trade away. |
| P2 | No personal data and no page content in event payloads. In particular the `mailto:` address must never travel as an event property, and no visible text, class list or element ancestry is sent. **The IP address is inside this requirement, not outside it:** R9 makes it an ingestion-time input to GeoIP, so it must be discarded at ingestion rather than retained on events. Coarse derived location may be stored; the address it came from may not. |
| P3 | Global Privacy Control and best-effort Do Not Track are honoured, and a discoverable site opt-out works **mid-visit**, not only after a hard reload. |
| P4 | The processor, its region, retention period, **the durable identifier and its storage key**, and the use of IP and user-agent are documented in the repository and disclosed on the site. |
| P5 | Local development and PR previews never enter production data, and there is a documented way to run a real end-to-end test that does not. **Amended at implementation** — see [Environment separation on one project](#environment-separation-on-one-project). PostHog's free tier allows a single project per organisation, so the second half of this is met by labelling and filtering rather than by isolation. |
| P6 | Timing payloads carry no URLs and no image paths beyond a build-stable basename, are rounded to whole milliseconds, and describe device shape only in coarse buckets. |
| P7 | The visitor can erase the identifier from the site itself. The opt-out control **deletes** it rather than merely stopping transmission, and does so mid-visit (P3). Added 2026-09-19: under the old P1 there was nothing to erase, so this obligation did not exist. |
| P8 | No consent banner, as a recorded decision rather than an omission. The reasoning and the conditions that would reverse it live under [Jurisdiction and the no-banner position](#jurisdiction-and-the-no-banner-position). Added 2026-09-19. |

P7 is the requirement that carries the most weight after the P1 change. The old
design could claim that nothing about a visitor persisted; the new one cannot,
so the honest substitute is that whatever persists is first-party, anonymous,
disclosed by name, and removable by the person it describes without leaving the
site. An opt-out that stops collection but leaves the identifier in place would
satisfy the letter of P3 and miss the point of P1.

P6 is where the performance requirements press hardest on the privacy ones.
Viewport width and device pixel ratio are what make R7 answerable at all — the
srcset ladders in `src/config/image-ladders.mjs` are chosen against exactly
those two axes — but they are also fingerprinting surface. The design records
them **bucketed** (viewport rounded to the nearest 160 px, DPR to 1/2/3) and
records nothing else about the device: no `deviceMemory`, no
`hardwareConcurrency`, no `navigator.connection` unless a specific question
later needs it.

**The 2026-09-19 change costs P6 its best mitigation, and the replacement is
weaker.** The old argument was structural: under cookieless server-hash mode
there was no stable identifier for that entropy to accumulate against, so
bucketed viewport and DPR could not compound into anything. R8 creates exactly
such an identifier. What remains is three narrower defences, stated plainly
because they are genuinely a step down from the one they replace:

1. The buckets stay coarse, and the device-property list stays closed. Nothing
   is added to it to take advantage of the new identifier.
2. The identifier is first-party and anonymous, so the entropy accumulates
   against a token that describes a browser on this one origin — not a profile
   joinable with anything else.
3. The visitor can delete it (P7), which is the difference between a stored
   identifier and a fingerprint. A fingerprint is precisely the thing that
   survives deletion, and this design must never acquire one as a fallback.

Point 3 is the one to defend hardest. The moment anything in this layer tries
to *recover* a deleted identifier — from entropy, from the IP, from anything —
the trade made here stops being a trade and becomes a different product.

### Jurisdiction and the no-banner position

Recorded 2026-09-19, so that a future reader finds a decision here rather than
an oversight. This section is a statement of the site's position and the
reasoning behind it. **It is not legal advice and was not written by a
lawyer.**

The site is a personal, non-commercial portfolio. It sells nothing, runs no
advertising, has no customers and no payment flow, and its audience is
Canadian. On that basis:

- **PIPEDA** binds organizations that collect personal information *"in the
  course of commercial activities"*. A personal site with no commercial
  activity is plausibly outside its scope entirely — which is a stronger
  position than complying with it would be.
- **Quebec Law 25** is the one worth naming rather than waving past, because
  its §8.1 requires that technology with **identification, location or
  profiling** functions be deactivated by default. That clause is the reason
  `person_profiles: 'never'` is retained in [Key decisions](#key-decisions)
  even though R10 would be easier with profiles on. The identifier this design
  adds is a session-joining token, not a profile, and keeping it that way is
  deliberate.
- **GDPR and ePrivacy** are not treated as governing. The consent obligation
  for cookies under ePrivacy attaches to storage on the device regardless of
  whether the value is personal data, so if the site were targeting the EU this
  design would need a banner. It is not, and it does not.

**No consent banner (P8).** The trade is stated openly: the site keeps a
first-party anonymous identifier without asking, and in exchange it honours
Global Privacy Control and Do Not Track without asking either (P3), discloses
the identifier by name (P4), and lets anyone delete it in one click (P7). For
this site, that is a better deal for the visitor than a dismissable banner,
which most people click through without reading.

**What would reverse this.** Any one of these, and the position has to be
re-argued rather than assumed:

- the site starts selling anything, taking payment, or running advertising;
- EU or UK traffic becomes a segment the site is written for, rather than
  incidental — R9's country data is, usefully, exactly what will show this;
- person profiles are switched on, or any identifying attribute is attached to
  the identifier;
- the identifier stops being deletable, or a fingerprinting fallback appears.

### Operational

- No new always-on infrastructure; the Worker runs only on the analytics path.
- Deployable and rollbackable through the existing Cloudflare Worker version
  flow.
- Every requirement above must be verifiable — see
  [Verification and acceptance criteria](#verification-and-acceptance-criteria).

## Recommendation

**PostHog Cloud (free tier) with a durable first-party anonymous identifier and
no person profiles, reached through a
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
| Storage/identity | **Durable first-party identifier, no person profiles** (`persistence: 'localStorage+cookie'`, `person_profiles: 'never'`, no `cookieless_mode`) | Cookieless server-hash mode (`cookieless_mode: 'always'`), which this design used from 2026-09-10 to 2026-09-19 | Server-hash mode rotates its salt daily, so returning visitors were uncountable (R8) and the IP was consumed as hash input before GeoIP and bot detection could read it (R9). Revised 2026-09-19 under the rewritten P1; the reasoning is in [Jurisdiction and the no-banner position](#jurisdiction-and-the-no-banner-position). |
| Person profiles | `person_profiles: 'never'` — **retained** | `'identified_only'` or `'always'`, which is the straightforward way to satisfy R10 | Profiles are what Quebec Law 25 §8.1 names, they cost more per event, and they turn an anonymous token into a record with attributes. R10 is the weakest of the three new requirements and does not justify that; see [First-touch attribution without profiles](#first-touch-attribution-without-profiles). |
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

#### First-touch attribution without profiles

R10 is the one new requirement that does not fall out of the P1 change for
free, and it is worth being precise about why.

PostHog's `$initial_referrer` and `$initial_utm_*` are **person properties**.
They are written once against a person record, which means the obvious route to
R10 is `person_profiles: 'identified_only'` — and that is exactly the setting
the Law 25 §8.1 argument above asks this design not to reach for.

The intended way out is to keep profiles off and carry first-touch data as
**event** properties instead. `posthog-js` already persists initial campaign
information in its own storage (`set_initial_person_info`, and the
`initial_person_info` config), so the value exists in the browser whether or
not a person record is ever created. The `before_send` hook that already stamps
`site` on every event is the natural place to stamp a first-touch referrer
alongside it.

**This is unverified vendor surface and must be proven before R10 is claimed.**
The specific question is whether the initial referrer is readable from the
installed SDK (`posthog-js@1.429.5`) via `get_property` or an equivalent when
`person_profiles: 'never'` is set — the config and method both exist in the
installed typings, but "exists" is not "returns a value under this
configuration". Confirm it against a real payload, exactly as the
`capture_performance` object form was confirmed. If it turns out to be
unreachable without profiles, the correct outcome is to **drop R10**, not to
turn profiles on: R8 and R9 are what this change was worth making for.

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
| R8 returning visitors | PostHog Web Analytics | Distinct identifiers seen in the range, and the new/returning split. A person who clears storage, opts out and back in, or uses a second browser counts twice — this is a **lower bound on people and an upper bound on devices**, and the dashboard card should say so. Unlike the cookieless numbers it replaces, it no longer resets daily. |
| R9 geography, bots | PostHog `$geoip_*` properties; PostHog bot filtering | Country and region, derived at ingestion from an IP that is then discarded (P2). City is available and deliberately **not** used: it adds nothing this site would act on and is the most identifying rung of the ladder. Cross-check country against Cloudflare zone analytics, which counts requests rather than pageviews and will not reconcile exactly. |
| R10 first touch | PostHog event property, stamped in `before_send` | The referrer of the visitor's first recorded visit, carried on later events without creating a person profile. **Conditional on the verification under [First-touch attribution without profiles](#first-touch-attribution-without-profiles);** if that fails, R10 is dropped rather than bought with profiles. |
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

One property sits outside this table because it is stamped on *every* event
rather than declared per event: `site`, the hostname with any leading `www.`
removed. See [Production hostnames](#production-hostnames) for why, and for the
three levels of domain granularity it completes.

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
  persistence: 'localStorage+cookie',
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
- Normal previews stay disabled, and local development is off unless a `.env`
  turns it on. That default is what actually keeps test traffic out of the data
  (P5) — the project-side filter below is only for the deliberate end-to-end
  test, which is the one time analytics run anywhere but production.
- `.env.example` documents both variables with no real values.
- `AGENTS.md` gains a short section describing the analytics layer, `/sawdust`,
  the region, the event dictionary, the identifier and its storage key, the
  GeoIP and discard-IP project settings, and the opt-out key — so a future
  agent does not "clean up" an unexplained Worker or CSP host, or "restore
  privacy" by re-enabling cookieless mode and silently breaking R8 and R9.

### Implementation phases

**Phase 0 — Privacy and project decisions (no code).** Choose the US or EU
PostHog region. Create the project — one is all the free tier allows, so see
[Environment separation on one project](#environment-separation-on-one-project)
rather than planning a second. Enable
**GeoIP enrichment** and confirm PostHog's **bot filtering** is active (R9), and
turn on **"discard client IP data"** so the address is dropped after enrichment
(P2) — verify that the derived `$geoip_*` properties survive that setting, as
the two interact. Cookieless server hash mode must be **off**; leaving it on
would strip the IP before GeoIP runs and defeat R9. Set retention, disable
session replay and surveys. Draft the analytics disclosure, the opt-out control
and the identifier-deletion behaviour P7 requires. **Enable Cloudflare Web
Analytics now**, with the CSP edits under *Cloudflare layer*, so a field
baseline is accumulating before `posthog-js` ships — see [Cloudflare's free
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

1. A normal visit stores exactly one PostHog identifier, on this origin only,
   under the key named in the disclosure — and nothing else beyond the site
   opt-out preference. No third-party cookie is set, and nothing is written to
   or readable from any other domain (P1).
2. The site opt-out **deletes** that identifier rather than only suppressing
   requests (P7): after opting out, the key is absent from both `localStorage`
   and `document.cookie`, verified by inspection rather than by the absence of
   network traffic.
3. A second visit in a later browser session is attributed to the same
   identifier, and a visit after clearing site data is not (R8).
4. Events carry `$geoip_country_name` and no `$ip` property (R9, P2). Both
   halves must hold: geography present *and* the address absent. Check this on
   real ingested events, because it is a property of the project settings, not
   of anything in this repository.
5. GPC, DNT and the site opt-out each prevent `/sawdust` requests entirely.
6. Opting out **mid-visit** stops collection in the same ClientRouter session,
   not only after a reload.
7. Local development and PR previews produce no production data — verified by
   the absence of the build-time variables rather than by anything at runtime.
8. A deliberate local test build reaches the project, and every event it
   produces is excluded by the `$host` filter described in
   [Environment separation on one project](#environment-separation-on-one-project).
   Check the filter is applied by confirming the test events are visible with
   it off and absent with it on.

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

   **Measured 2026-09-10** on `/`, counting every chunk reachable by static
   import from the page's own `<script src>` tags:

   | Build | Chunks | Raw | Gzip |
   | --- | --- | --- | --- |
   | Before any analytics work | 5 | 175.2 KB | 65.0 KB |
   | After, switch **off** | 7 | 179.3 KB | 67.1 KB |
   | After, switch **on** | 7 | 179.6 KB | 67.2 KB |

   So the eager cost of the whole layer is **+4.4 KB raw / +2.2 KB gzip**, and
   it is the same whether analytics is switched on or off — the gate is what
   ships, not the SDK.

   `posthog-js` itself is **274.1 KB raw / 89.8 KB gzip**, in its own chunk,
   reached only by the dynamic import inside the consent gate. It is not
   referenced from any HTML file and carries no `modulepreload`, which was
   verified in the build output: a visitor sending GPC, or one who has opted
   out, never requests it.

   That 89.8 KB is the number worth arguing about later, and it is far from
   free for a site whose whole argument is that it feels fast. It is off the
   critical path — imported after `astro:page-load`, never render-blocking —
   but it is still ~90 KB down the wire for every other visitor. This is
   precisely the measurement alternative **F** (Plausible/Fathom, "ship a much
   smaller script") said to revisit once it existed. It now exists.
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
| **D.** PostHog with autocapture + localStorage (the first draft) | Lowest build cost | R1–R4, R8–R10; fails P2 | **Half-adopted 2026-09-19** — the persistence half is now the design; autocapture is still rejected. |
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
first draft, and it is the entry this document has been least fair to. It was
rejected wholesale for failing two requirements, and only one of those
rejections has survived.

*The persistence half is now the design.* `persistence: 'localStorage'` stores
a durable visitor ID, which failed P1 as originally written — and P1 was
rewritten on 2026-09-19 precisely because R8 and R9 are worth more to this site
than the claim that wording protected. The first draft was not wrong about the
mechanism; the design simply valued the trade differently then. Recorded here
rather than quietly amended, because being able to see a decision reverse is
most of what this document is for.

*The autocapture half is still rejected, and for the untouched requirement.*
Autocapture ships link text, class lists, element ancestry and `href` values —
including the `mailto:` address that is the site's only conversion (P2). P2 was
not relaxed and is not up for relaxation; nothing about the storage change
bears on it. **Revisit narrowly:** autocapture scoped to clicks on annotated
anchors and buttons is an acceptable addition if the bounce card proves
valuable and real payloads are inspected first.

**E. Self-hosted open-source analytics.** Umami, Plausible CE or Matomo on our
own infrastructure gives complete data ownership, no third-party processor and
no free-tier ceiling. It costs a running service, a database, backups, upgrades
and a security surface — for one personal portfolio. That is a direct
contradiction of C5, and it is the clearest rejection in this list.

**F. Paid hosted privacy analytics.** Plausible or Fathom are cookieless by
default, ship a much smaller script than `posthog-js`, and have a simpler
privacy story to disclose — a point that got *stronger* on 2026-09-19, since
this design no longer has cookielessness to claim against them. Three reasons
they lose here: monthly cost for a personal site; custom events with structured
properties are the weaker part of their product, and R4 depends entirely on
custom events; and blocker resistance
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

**Open decisions — the original five were settled at implementation on
2026-09-10; three more opened with the storage change on 2026-09-19.**

1. ~~PostHog **US or EU** region.~~ **US.** The project cannot be migrated
   between PostHog's clouds later, so this is effectively permanent. Recorded in
   `src/worker/index.ts` (`UPSTREAM`) and on `/privacy`.
2. Whether to **keep** Cloudflare Web Analytics past the first few weeks.
   Enabling it no longer blocks Phase 0 — that phase turns it on — but the
   second beacon and its CSP host in two places are only worth keeping under
   the rule in [Cloudflare's free
   tier](#cloudflares-free-tier-what-it-already-covers), and that call needs
   production numbers.
3. ~~Whether project cards and the Home *All projects* / *View the archive*
   links are in scope for R1.~~ **Yes, in scope.** Both are annotated, and the
   cards introduced a third `kind` value — `case-study`, alongside `repo` and
   `live` — so a card click and an outbound link stay distinguishable.
4. ~~Whether PostHog's autocapture-derived bounce metric matters enough to
   enable the narrow autocapture exception under D.~~ **No.** Autocapture stays
   off. Revisit only against real payloads, as D says.
5. ~~The `image_cost` sampling rate, and whether bucketed viewport and DPR are
   acceptable to record at all (P6).~~ **100%, with buckets.** Viewport to the
   nearest 160 px and DPR clamped to 1/2/3, in `src/lib/image-cost.ts`. The rate
   is one constant (`IMAGE_COST_SAMPLE` in `src/scripts/perf.ts`) and is the
   first thing to turn down if volume ever matters.
6. **Whether R10 is reachable at all without person profiles.** The open
   question is stated under
   [First-touch attribution without profiles](#first-touch-attribution-without-profiles);
   the answer decides whether R10 ships or is struck. It must not be answered
   by turning profiles on.
7. **Whether PostHog's "discard client IP data" setting preserves the derived
   `$geoip_*` properties.** P2 and R9 both depend on the answer being yes. If
   it is no, the requirements collide and P2 wins — geography is worth less
   than not storing addresses.
8. **Whether R8 was worth the P1 trade.** Decidable only with data. Review it
   after a full month: if the returning-visitor share is small enough that
   nothing about the site would change, the honest response is to revert to
   cookieless mode rather than keep an identifier that earns nothing. Put this
   on the same review as the Web Analytics keep-or-retire rule in item 2.

**Risks.**

- **The privacy disclosure is now load-bearing in a way it was not.** Under the
  old P1 the page described an absence, and an absence cannot drift out of
  date. It now describes a specific mechanism — one identifier, one key, one
  deletion path — and every one of those can be falsified by a later config
  change nobody thinks to read the page about. Treat `/privacy` as a file that
  must be re-read whenever `analytics.ts` changes.
- **Cookieless mode is a tempting-looking "privacy improvement" for a future
  reader.** It is one line, it reads as strictly better, and turning it on
  silently destroys R8 and R9 with no error and no failing test — the data just
  quietly becomes wrong. This is why it is called out in `AGENTS.md` under
  *Configuration and environments* as well as here.

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

**Amended 2026-09-19.** While the design was cookieless, Web Analytics held two
things PostHog structurally could not — a country dimension and IP-based bot
exclusion — and that was a strong independent reason to keep it. R9 gives both
back to PostHog, so that argument is gone and the rule above is the whole case
again. The ratio is now the only thing the second beacon uniquely provides.

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

## What is left

Everything in this document that is code is in the tree. What remains is
account work, and none of it can be done from the repository.

**Phase 0 — PostHog (blocks any real data).**

1. Create the project on PostHog's **US** cloud. The free tier allows one per
   organisation, so there is no separate test project; configure the `$host`
   filter under
   [Environment separation on one project](#environment-separation-on-one-project)
   instead.
2. **Leave cookieless server hash mode off**, and confirm it is off. This
   reverses the instruction that stood here until 2026-09-19. Turning it on now
   would strip the IP before enrichment and silently cost R9, while the daily
   salt rotation would cost R8 — both without any error to notice.
3. **Turn on GeoIP enrichment, confirm bot filtering is active, and turn on
   "discard client IP data"** (R9, P2), then verify that `$geoip_*` properties
   still arrive with the IP discarded. Set retention to one year and confirm
   session replay and surveys are off.
4. Put the `phc_…` key in the GitHub repository **variable**
   `PUBLIC_POSTHOG_KEY` (a variable, not a secret — it ships in the bundle), and
   set `PUBLIC_ANALYTICS_ENABLED` to `true`.
5. Set a usage alert. Free-tier limits are vendor state and move.

**Phase 0 — Cloudflare Web Analytics.** The CSP host is already committed in
both blocks of `public/_headers`, so this is one switch in the Cloudflare
dashboard. Turn it on **before** the first deploy that carries `posthog-js`:
the pre-PostHog field LCP baseline that acceptance criterion 4 wants cannot be
collected retrospectively.

**The storage change is implemented** (2026-09-19).
`src/scripts/analytics.ts` carries `persistence: 'localStorage+cookie'` with
`person_profiles: 'never'` unchanged, and its opt-out path now deletes the
identifier rather than only muting it. `/privacy` was rewritten around what P1,
P4 and P7 actually promise: one named first-party anonymous identifier,
deletable from the page itself, with the old "no cookies, no visitor ID"
opening replaced and the IP sentence corrected — it previously claimed a coarse
location *and* a daily session hash were derived, which was wrong in both
halves. R10 is the one part **not** built; it stays conditional on the
verification under
[First-touch attribution without profiles](#first-touch-attribution-without-profiles).

**Verification that needs a real key.** Acceptance criterion 5 under *Build and
Worker* — a browser-generated `/sawdust/e/` POST arriving in the PostHog project
— is the one check that cannot be faked locally, because it ends in a real
project. Everything around it has been verified locally; see below.

**Phase 4.** Read the dashboards once there is a day of data, and apply the
keep-or-retire rule to the Web Analytics beacon.

### Environment separation on one project

Added 2026-09-16, after the account existed. P5 assumed a separate PostHog
project for test builds. **PostHog's free tier allows one project per
organisation**, so that is not available, and this records what replaces it —
along with what the replacement gives up, because it is genuinely weaker.

**What still does the real work is the default, not the filter.** Analytics run
only when `PUBLIC_ANALYTICS_ENABLED` is `true` *and* a key is present. The
preview workflow passes neither, and a local build has neither unless someone
writes a `.env`. So local development and PR previews reach the project **not at
all** — the first half of P5 holds exactly as designed, and holds because the
data is never sent rather than because it is filtered afterwards.

That leaves one case: the deliberate end-to-end test, where the point is to send
real events from a machine that is not production.

**The mitigation.** `posthog-js` stamps every event with `$host`, taken from
`$current_url`, with no configuration. In PostHog, *Project settings → Filter
out internal and test users*, as a **single** condition:

```text
$host  matches regex  (localhost|127\.0\.0\.1|\.workers\.dev$)
```

Every insight then excludes local builds and `*.workers.dev` preview URLs by
default, with a per-insight toggle to see them when that is the question being
asked.

**Name the test hosts, never the production ones.** The tempting form is `$host
is not <production domain>`, and it is a trap. This site serves **four**
production hostnames (see below), so that form needs four exclusions to be
correct today — and the day a fifth domain is added, that domain's real traffic
is silently reclassified as test and disappears from every chart. Nothing
errors; the numbers just quietly get smaller. Enumerating the *test* hosts fails
the safe way round: a new production domain is simply counted, and the worst a
stale entry can do is hide traffic from a host nobody is using.

**One condition, not several.** Written as one regex, the alternation is
unambiguous. Several separate rows depend on how PostHog combines them, and if
they are ANDed then `$host contains localhost` **and** `$host contains
workers.dev` is never simultaneously true — the filter would silently match
nothing at all. Verify either way: with the filter on, a local test event should
vanish; with it off, it should reappear.

### Production hostnames

One Worker serves four custom domains, each with a direct `200` and no redirect
between them, so a visitor stays on whichever one they arrived at and the
traffic genuinely splits four ways:

```text
builtbywoodley.ca        www.builtbywoodley.ca
mattwoodley.ca           www.mattwoodley.ca
```

All four are declared as `custom_domain` routes in `wrangler.jsonc`, so Wrangler
provisions them on deploy and the repository is the record of what is served.

Four hostnames is four rows in every breakdown, and that is only sometimes the
question being asked. Three different ones are worth answering, so three levels
of granularity exist:

| Breakdown | Values | Question | Costs |
| --- | --- | --- | --- |
| *(none)*, or `$pathname` for pages | 1 | How is the site doing? | nothing |
| `site` | 2 | How is each domain doing? | one property |
| `$host` | 4 | Which hostname did they arrive on? | nothing |

`$host` and `$pathname` are PostHog's own, set from `$current_url` with no
configuration. Only the middle row needed anything: `site` is the hostname with
a leading `www.` stripped, stamped on every event by a `before_send` hook in
`src/scripts/analytics.ts`.

```text
visited                   $host                   site
mattwoodley.ca            mattwoodley.ca          mattwoodley.ca
www.mattwoodley.ca        www.mattwoodley.ca      mattwoodley.ca
builtbywoodley.ca         builtbywoodley.ca       builtbywoodley.ca
www.builtbywoodley.ca     www.builtbywoodley.ca   builtbywoodley.ca
localhost:4331            localhost:4331          localhost
```

Two notes on using it. **For page-level analysis prefer `$pathname` to
`$current_url`** — the latter carries the hostname, so it splits a single page
into four rows and quietly makes every page look less visited than it is. And
`site` is **derived, not looked up**: a domain added to `wrangler.jsonc`
tomorrow gets a correct value with no code change, which is the same property
that makes the test-host filter above safe to leave alone.

It adds no privacy surface. `site` is strictly less information than the
`$host` and `$current_url` PostHog already sends, computed from them.

#### What the per-domain split actually means

`mattwoodley.ca` is an **alias**, not a second site. The two domains serve
byte-identical HTML from the same Worker — verified by hashing both responses —
so nothing about the content differs between them. Recording this because the
distinction changes how the numbers should be read, and the data itself will not
say so.

**The merged number is the site's real traffic.** Level 1 in the table above is
the honest answer to "how is the site doing". Reading the four `$host` rows as
though they were four properties, or the two `site` rows as two products, would
be inventing a difference the bytes do not contain.

**The split is an acquisition signal.** It is worth having because the two URLs
are marketed in different places, so the domain a visitor arrived on is a hint
about where they heard of it. That hint is most valuable exactly where nothing
else is available: a domain printed on a card, said out loud, or typed from
memory arrives with **no referrer at all**, and the hostname is then the only
attribution there is. Where `$referrer` or a UTM parameter exists, it is the
stronger signal and `site` adds little.

**It is a hint, not attribution, and it decays.** A link shared onward carries
its domain with it, so a `mattwoodley.ca` URL forwarded by someone who found it
via `builtbywoodley.ca` attributes the recipient to the wrong channel. The split
is directionally useful for "is the thing I printed on that card working at
all"; it will not survive being treated as a conversion path.

**Do not compare engagement between the domains.** Identical bytes means any
difference in dwell, scroll depth or chapter progression is about *who was sent
there*, not what they found. That is still interesting — it says something about
the audiences — but it is a statement about the marketing, not about the site.

**The coupling nobody will remember later.** This measurement exists only
because the four hostnames each serve a direct `200` with no redirect between
them. Collapsing them — a redirect from one domain to the other, or to a
canonical host — would silently end the split, with `site` quietly reporting one
value from then on. That is a live possibility rather than a hypothetical: the
pages carry **no `rel="canonical"` and no `og:url`** today, so four hostnames
serve duplicate content, and the usual SEO answer to that is exactly the
redirect that would destroy this. If that trade comes up, it is a real trade —
decide it deliberately rather than discovering afterwards that a chart went
flat. A canonical tag alone costs nothing here; a redirect costs the signal.

Two consequences for the filter above. Four hostnames is already twice the
number an "is not production" filter has to enumerate, and the set is clearly
one that grows — which is the argument for naming the test hosts instead. And
because `mattwoodley.ca` was added to the routes after this design was written,
any dashboard, cohort or filter that names production domains explicitly has to
be revisited whenever that list changes. Nothing does, as written.

**This is not the hostname check the design rejected.** Decision *Enablement*
rules out suppressing collection by hostname **in code**, because that makes the
thing you are shipping impossible to verify — the first draft asked for a local
click test its own code could never allow. Filtering at analysis time is the
opposite: the events are sent, the code path is exercised end to end, and the
only decision made by hostname is whether to count them. The rejection stands;
this is a different mechanism at a different layer.

**What it gives up, stated plainly.** Labelling is not isolation. Test events
live in the same table as real ones and are excluded by a setting someone can
forget to apply, or that a direct query can bypass. On a personal portfolio,
where the test traffic is a handful of events from one deliberate run, that is
an acceptable trade. It would not be acceptable anywhere the numbers carried
weight, and if this site's ever do, the fix is a second project.

**The escape hatch, if isolation is ever needed.** PostHog's free tier is per
*organisation*, not per account: a second organisation under a different email
gets its own project and its own allowance. It costs another login and some
account sprawl, and it is the only route to genuine separation without paying.
Worth it if test traffic ever stops being occasional; not worth it today.

### What was verified locally, and how

Recorded so a later reader knows which claims rest on evidence and which rest
on the account work above.

Against `wrangler dev` with the real Worker:

- `/`, `/software` and `/privacy` serve a direct `200` with no trailing-slash
  redirect, and `/nope` still serves the built 404 page with a body. The full
  `_headers` security set is present on asset responses.
- `/sawdust/static/array.js` returns 200 and 95 KB of JavaScript from PostHog's
  asset host, through the proxy.
- No request steers the upstream: `Host`, `X-Forwarded-Host` and a query
  parameter naming another host all still land on PostHog, and
  `/sawdust//evil.com/x` and `/sawdust/../admin` reach PostHog's 404 rather than
  anywhere else.

Against a local echo standing in for PostHog, with only the two host constants
repointed:

- `cookie` is deleted — including a `ph_*` one — and never reaches upstream.
- `X-Forwarded-For` arrives as Cloudflare's `CF-Connecting-IP`, **not** the
  spoofed value the client sent. `true-client-ip`, `x-real-ip` and
  `cf-connecting-ip` are all dropped.
- A 3000-byte binary POST arrives intact with its query string preserved.

Against the built site in Chromium, with `/sawdust` stubbed:

- GPC and the stored opt-out each stop the SDK being **downloaded at all** —
  zero `/sawdust` requests, the chunk is never fetched, and nothing is written
  to storage.
- A normal visit writes exactly one PostHog key, `ph_<token>_posthog`, to both
  `localStorage` and a cookie on this origin. Nothing else appears beyond the
  site's own `theme` and `analytics-opt-out`. **Re-verified 2026-09-19** under
  the new P1; this bullet previously read "no cookies and no `localStorage`"
  and was true of the cookieless design it described.
- The identifier is **stable across a reload** — same `distinct_id` before and
  after — which is R8 working rather than being asserted.
- Opting out **deletes** it (P7): after one click, both the `localStorage`
  entry and the cookie are gone and only `analytics-opt-out` remains. Opting
  back in mints a **fresh** identifier rather than resurrecting the old one.
- One `$pageview` per direct load; Home → Software → Back gives three, with one
  `nav_type: 'hard'` and two `nav_type: 'soft'` `page_load_timing` events.
- All five chapters emit exactly once on a full Home traversal — on desktop,
  at phone width, and under `reducedMotion: 'reduce'` — and scrolling back up
  repeats none of them.
- `photo_viewer_opened` reports all three sources distinctly: `gallery-link`,
  `step` and `deep-link`. The `step`/`deep-link` split is the trap C9 warns
  about, and it holds.
- `photo_zoom_used` reports the two stages separately, returns
  `to_master_ms: 0, warm: true` on a repeat zoom of the same frame, and reports
  **nothing at all** for a zoom cancelled before the master lands.
- `disclosure_opened` counts opens only: open, close, reopen produces two.
- Opting out mid-visit stops collection immediately, with no reload.
- Across every captured payload: no email address, no `mailto:`, no visible
  copy, no class lists, no image paths.

Four defects were found this way and fixed:

1. `render_ms` was missing from every soft navigation. `astro:page-load` fires
   *before* the frame the swap paints, so reading the measurement there always
   found nothing and omitted the property. It is now sent from inside a
   `requestAnimationFrame`, which runs after the one the measurement is taken in.
2. `photo_viewer_opened` never fired for a deep link. The viewer dispatches
   about one frame after the page's modules evaluate, while `perf.ts` waits on a
   network fetch of the SDK — so the listener did not exist yet. Those two
   listeners moved to `analytics.ts`, which is attached during the same tick as
   the viewer.
3. **Opting out did not actually delete the identifier**, found on the first
   run of the P7 check and invisible to reading the code. Deleting the
   `localStorage` entry and the cookie worked, and then PostHog's persistence
   layer wrote itself straight back — the key reappeared within a second, so
   the page kept its promise for about as long as it took to look away. The fix
   is ordering: `set_config({ disable_persistence: true })` **before**
   `reset()` and the manual sweep, using the SDK's own consent-management hook
   rather than racing it. Opting back in re-enables persistence explicitly.
   This is the clearest argument in the document for why P7 has an acceptance
   criterion that inspects storage rather than network traffic: every
   network-level check passed the whole time.
4. `image_cost` reported `bytes_kb: 0` for light pages, because rounding to the
   nearest 100 KB sends anything under 50 KB to zero — which reads as "this page
   has no images". A non-zero total now floors at 100.

## References

- [PostHog JavaScript configuration](https://posthog.com/docs/libraries/js/config)
- [PostHog cookieless tracking](https://posthog.com/tutorials/cookieless-tracking) — the mode this design used until 2026-09-19, and the source for the IP-stripped-before-transformations behaviour behind R9
- [PostHog persistence and `person_profiles`](https://posthog.com/docs/data/persons) — anonymous versus identified events, and what a person profile adds
- [PostHog GeoIP enrichment](https://posthog.com/docs/cdp/transformations/geoip-enrichment) — an ingestion transformation, which is why cookieless mode defeats it
- [Office of the Privacy Commissioner of Canada: PIPEDA in brief](https://www.priv.gc.ca/en/privacy-topics/privacy-laws-in-canada/the-personal-information-protection-and-electronic-documents-act-pipeda/pipeda_brief/) — the "commercial activities" scope test cited under Jurisdiction
- [Commission d'accès à l'information du Québec: Law 25](https://www.cai.gouv.qc.ca/protection-renseignements-personnels/) — §8.1 on identification, location and profiling technologies, the reason `person_profiles: 'never'` is retained
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
