# Front-end analytics plan review and recommended revision

Status: revise before implementation

Reviewed: 2026-08-31

Source plan: `~/.claude/plans/design-a-front-end-analytics-calm-bunny.md`

## Verdict

The proposed architecture fits this repository: PostHog can provide behavioural
events, a same-origin Worker path can preserve the current `connect-src 'self'`
policy, and Astro's `ClientRouter` can be supported without turning the site into
a server-rendered application.

The plan should not be implemented verbatim, however. Its client configuration is
not actually cookieless, its Worker omits important forwarding behaviour from
PostHog's current Cloudflare example, its local analytics verification is disabled
by the code it proposes, and its chapter observer will miss tall sections. It also
calls Cloudflare Web Analytics an "unblockable" baseline even though that product
uses a browser beacon.

Keep the overall direction, but revise the plan around data minimisation, explicit
environment controls, a hardened proxy, and measurable acceptance criteria.

## Required changes

| Priority | Issue in the plan | Recommended change |
| --- | --- | --- |
| Blocker | `persistence: 'localStorage'` stores a persistent visitor ID and is not PostHog's cookieless mode. | Enable **Cookieless server hash mode** in the PostHog project and configure `cookieless_mode: 'always'` plus `person_profiles: 'never'`. Remove the `persistence` setting. |
| Blocker | The no-banner statement is treated as a universal legal conclusion. | Treat it as a product/privacy decision, not legal advice. Publish a short analytics disclosure and a visible opt-out. Confirm the intended PostHog region and retention before launch. |
| Blocker | The Worker forwards every browser header, including cookies, and does not deliberately preserve the visitor IP used by server-hash mode. | Clone and minimise headers, delete `cookie`, set `X-Forwarded-For` from `CF-Connecting-IP` if server-hash mode is chosen, and document that transient IP use. Do not manually set `Host`; let `fetch()` derive it from the upstream URL. |
| Blocker | `new Request(url, request)` streams POST bodies directly, while PostHog's current Cloudflare troubleshooting guidance recommends buffering the binary body. | Forward non-GET/HEAD bodies with `await request.arrayBuffer()`. Add a real event-ingest test, not only an asset request. |
| Blocker | Local click tests cannot work: `suppressed()` always rejects `localhost`, yet verification says to set a local key and test there. | Use an explicit build-time environment switch and a safe debug override. Prefer a separate PostHog test project for local/preview validation. |
| High | The plan calls localStorage persistence "cookieless" and assumes `identified_only` prevents anonymous identity storage. | Use PostHog's dedicated cookieless mode. `person_profiles` controls profile processing; it does not turn localStorage persistence into anonymous, storage-free measurement. |
| High | Full autocapture collects more than the stated requirement and may include link text, element hierarchy, classes, and `href` values such as the email address. | Prefer a document-level delegated handler that emits a small, allowlisted custom event schema from `data-analytics-*` attributes. If PostHog autocapture is retained for its bounce metric, scope it to annotated `a` and `button` elements and clicks only. |
| High | A `0.5` intersection threshold can never fire for a section taller than twice the viewport. The About and Work chapters can be much taller than that. | Mark each section with `data-analytics-chapter` and count it when its leading edge enters a stable viewport band, for example threshold `0` with a negative bottom `rootMargin`. |
| High | The plan says all five chapter sections already have IDs. Hero and Contact do not. | Use explicit `data-analytics-chapter="hero|about|work|archive|contact"` attributes instead of deriving event names from IDs or CSS classes. |
| High | The observer lifecycle is underspecified. Guarding `startAnalytics()` after the first call can also prevent observer setup on later visits to Home. | Keep SDK initialisation single-shot, but disconnect and recreate page-scoped observers on every `astro:page-load`, following the lifecycle already used by `home-scroll.ts` and `storyscroll.ts`. |
| High | Cloudflare Web Analytics is described as an unblockable request baseline. Its JavaScript beacon can still be blocked. | Use Cloudflare zone/edge Analytics for the non-JavaScript request baseline. Enable Web Analytics only if its page and performance metrics are also wanted, and describe it as a second browser-beacon dataset. |
| High | The fallback CSP change only considers the global `/*` policy. `/viz/*` unsets that policy and defines a separate `script-src`, so an automatically injected Cloudflare beacon will be blocked there. | Add the exact beacon script path to both CSP policies, exclude `/viz/*` from Web Analytics, or explicitly accept that the map is not measured. |
| Medium | Idle-loading for up to two seconds undercounts short visits, initial dwell time, early clicks, and quickly passed chapters. | Initialise after the first `astro:page-load` without an arbitrary idle delay, then measure the cost. If an idle delay is retained, synchronously queue annotated clicks and document the known timing bias. |
| Medium | The instrumentation inventory has semantic errors: the GTA controls select Desktop/Mobile, not map layers, and Previous/Next share one action without a direction. | Define an event dictionary with stable event names and properties before editing components. Record map `mode` and photo `direction`. |
| Medium | `curl .../static/array/$KEY.js` is not the asset path the bundled SDK depends on and does not prove event ingest. | Use `/sawdust/static/array.js` only as a proxy smoke test, then verify an actual `/sawdust/e/` POST generated by a browser and its corresponding event in PostHog. |
| Medium | `@cloudflare/workers-types` is proposed without defining or generating `Env`, and `astro build` does not provide a strong Worker type/config check. | Generate binding types with `wrangler types` and run a Wrangler dry run in verification/CI. Keep `Env` tied to `wrangler.jsonc` rather than maintaining a second manual binding definition. |

## Recommended measurement contract

Define what each requirement means before choosing dashboard cards:

| Requirement | Source of truth | Definition |
| --- | --- | --- |
| Clicks | PostHog custom events | An annotated navigation, CTA, project link, disclosure, theme control, photo control, or map mode control was activated. Event properties come from a fixed allowlist, not arbitrary DOM content. |
| Time on site | PostHog Web Analytics | Average session duration for the aggregate metric; `$prev_pageview_duration` in seconds for page-level diagnostics. It is elapsed time, not a guarantee of active reading time, and page-leave delivery is best effort. |
| Scroll depth | PostHog pageview/pageleave properties | `$prev_pageview_max_scroll_percentage` and `$prev_pageview_max_content_percentage`, both on a `0..1` scale. These remain technical document-depth measures. |
| Narrative depth | PostHog `chapter_viewed` | The named Home chapter's leading edge reached the agreed viewport band once during that Home pageview. This is the primary reading-depth metric. |
| Traffic baseline | Cloudflare zone/edge Analytics | Requests reaching Cloudflare, independent of the optional Web Analytics browser beacon. Do not expect it to reconcile one-for-one with PostHog sessions or pageviews. |
| Optional performance view | Cloudflare Web Analytics | Browser RUM and SPA navigation metrics if explicitly enabled. It is a useful cross-check, not an unblockable dataset. |

### Event taxonomy

Use a few stable event names with low-cardinality properties instead of treating
every button label as a separate event name.

| Event | Required properties | Examples |
| --- | --- | --- |
| `navigation_clicked` | `destination`, `placement` | `software` / `top-nav`, `photography` / `home-archive`, `about` / `top-nav` |
| `contact_clicked` | `method`, `placement` | `email` / `home-contact`, `linkedin` / `home-contact` |
| `project_link_clicked` | `project`, `kind` | `builtbywoodley-site` / `repo`, `fake-blog` / `live` |
| `control_used` | `control`, optional `value` | `theme`, `photo-step` / `next`, `photo-close`, `map-mode` / `mobile` |
| `disclosure_opened` | `kind` | `ai-generated`, `human-written` |
| `chapter_viewed` | `chapter` | `hero`, `about`, `work`, `archive`, `contact` |

PostHog supplies event timestamps. Do not send visible text, arbitrary classes,
full element ancestry, or destination URLs merely to answer which control was
used. In particular, the `mailto:` address does not need to be an event property.

## Revised architecture

```text
browser
  ├─ static site and bundled analytics chunk ──> Cloudflare static assets
  ├─ /sawdust/* ──> selective Worker route ──> chosen PostHog region
  ├─ page requests ──> Cloudflare edge Analytics
  └─ optional injected RUM script ──> /cdn-cgi/rum
```

Important boundaries:

- The proxy is same-origin, but PostHog is still a named third-party processor.
- A neutral path reduces common list-based blocking; it does not make collection
  invisible or impossible to block.
- The Worker must only target the two fixed PostHog hosts for the chosen region.
  It must never accept an upstream host from a query parameter or request header.
- US versus EU PostHog hosting is a deployment decision. Put the selected hosts in
  one Worker constant/config block and record the choice in the privacy note.
- `run_worker_first: ['/sawdust/*']` is the right routing shape. Other static assets
  should keep their direct asset path and present caching/header behaviour.

## Revised implementation phases

### Phase 0 — Privacy and dashboard decisions

Before writing client code:

1. Select the PostHog US or EU region.
2. Create separate production and test projects, or define another reliable way to
   keep local/preview events out of production data.
3. Enable **Cookieless server hash mode** in each PostHog project. PostHog ignores
   cookieless events if the project-side setting is absent.
4. Set and document retention, disable session replay/surveys, and decide whether
   GeoIP is wanted. Cookieless server hashing uses IP and user agent transiently to
   produce a daily rotating identifier; that tradeoff should be stated plainly.
5. Add a concise privacy/analytics disclosure and a discoverable opt-out control.
   Continue to honour Global Privacy Control and best-effort Do Not Track.
6. Decide whether Cloudflare Web Analytics adds enough beyond existing edge
   Analytics to justify another browser script and CSP allowance.

### Phase 1 — Worker proxy

Keep `main`, the `ASSETS` binding, and selective `run_worker_first`, but base the
forwarding behaviour on PostHog's current Cloudflare Worker guidance:

- remove the `/sawdust` prefix while preserving the query string;
- send `/static/*` and `/array/*` to the region's asset host;
- send ingest/config endpoints to the region's API host;
- delete incoming cookies before forwarding;
- if using server-hash mode, set `X-Forwarded-For` from Cloudflare's verified
  `CF-Connecting-IP` value rather than trusting a browser-supplied forwarding header;
- buffer non-GET/HEAD request bodies as `ArrayBuffer`;
- let the upstream URL determine `Host`;
- cache only the asset/config paths for which PostHog documents caching, using the
  execution context's `waitUntil()`;
- return a controlled `502` for unexpected upstream failures without logging event
  bodies or visitor identifiers;
- retain `env.ASSETS.fetch(request)` as the defensive non-proxy fallback even though
  selective worker-first routing should normally bypass the Worker.

Add local Wrangler and generated binding types. A useful script set is:

```json
{
  "preview:worker": "astro build && wrangler dev",
  "typegen:worker": "wrangler types",
  "check:worker": "wrangler deploy --dry-run"
}
```

Do not rely on `astro build` alone to validate the Worker entry point.

### Phase 2 — Minimal PostHog client

The privacy-critical part of the configuration should look conceptually like this:

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

This intentionally gives up PostHog's autocapture-dependent bounce definition in
exchange for a much smaller collection surface. If that bounce card is important,
make the alternative explicit: enable autocapture only for clicks on annotated
anchors/buttons and confirm in captured payloads that text, hierarchy, and `href`
data are acceptable.

Use a module-level promise or state machine so concurrent calls initialise once.
SDK initialisation and page-scoped instrumentation are separate responsibilities:

- the SDK starts once per browser visit;
- a delegated click listener is installed once and survives ClientRouter swaps;
- the chapter observer is disconnected/recreated per `astro:page-load`;
- an opt-out request works both before and after SDK initialisation;
- GPC/DNT and the stored site preference are checked before importing PostHog;
- production, preview, and local enablement comes from explicit build configuration,
  not hostname guesses alone.

Start the dynamic import promptly after the first `astro:page-load`. Measure its
effect before adding an idle delay. If performance requires deferral, queue the
small annotated event payloads synchronously so early interactions are not lost and
record that dwell time before SDK initialisation is still unavailable.

### Phase 3 — Explicit instrumentation

Add `data-analytics-event` and allowlisted property attributes to the actual
controls. A single document-level click handler should use `closest()` to find the
annotation and copy only known fields into `posthog.capture()`.

Correct the current plan's inventory while doing this:

- label the GTA controls `map-mode` with `desktop` and `mobile`, not `map-layer`;
- distinguish photo `previous` and `next` rather than using an undifferentiated
  `photo-step` event;
- label the Home primary contact link as LinkedIn and the second as email;
- decide whether project cards and the Home `All projects` / `View the archive`
  links are in scope, rather than measuring only TopNav equivalents;
- derive project slugs at render time instead of sending titles or full URLs;
- capture the resulting theme mode on `themechange` if the result matters; a raw
  theme-button click alone does not reveal which mode was selected.

For chapters, annotate all five sections explicitly. Observe the section's leading
edge with a viewport band, not 50% of the section's area. Recreate the observer each
time Home becomes the active document, keep a fresh `seen` set for that Home
pageview, and disconnect it on `astro:before-swap`. The observer should run for
reduced-motion visitors because it does not create motion.

### Phase 4 — Cloudflare baseline and optional RUM

Use the Cloudflare dashboard's edge/zone Analytics as the request baseline without
making a code change.

If Cloudflare Web Analytics is also enabled, prefer automatic injection on the
proxied production hostname. Current Cloudflare documentation says its SPA tracking
uses soft-navigation, Navigation API, or History API signals, so verify that it
counts Astro ClientRouter navigations once.

For automatic injection:

- keep `connect-src 'self'`;
- allow the exact script source
  `https://static.cloudflareinsights.com/beacon.min.js`;
- update both the global CSP and the separately defined `/viz/*` CSP if the map is
  intended to participate;
- verify the injected script has SRI and that `/cdn-cgi/rum` receives POSTs;
- do not expect automatic injection on a Worker preview URL to prove production
  hostname behaviour.

For a manual snippet fallback, Cloudflare documents a cross-origin ingest endpoint,
so `connect-src` also needs `https://cloudflareinsights.com`. That is a different CSP
change from automatic injection and should not be committed speculatively.

### Phase 5 — Configuration, documentation, and rollout

- Keep `PUBLIC_POSTHOG_KEY` as a GitHub repository variable; it is a publishable
  project token, not a server secret.
- Add an explicit `PUBLIC_ANALYTICS_ENABLED` or equivalent production switch.
- Keep normal previews disabled. Provide a documented test build using the test
  project so end-to-end verification is possible before production.
- Add `.env.example` entries without real project values.
- Document `/sawdust`, the selected region, event schema, cookieless project setting,
  opt-out key, and dashboard-only requirements in `AGENTS.md` or a durable analytics
  operations document.
- Record vendor free-tier limits at implementation time and set a usage alert where
  available; pricing and limits are external state, not repository guarantees.

## Verification and acceptance criteria

### Build and Worker

1. `npm run build` succeeds.
2. Generated Worker types are current and the Wrangler dry run succeeds.
3. `npm run preview:worker` serves `/` and `/software` with the existing routing and
   security headers.
4. `/sawdust/static/array.js` reaches the selected PostHog asset host.
5. A browser-generated `/sawdust/e/` POST reaches PostHog with its binary body and
   query intact. Inspect Worker-side test requests to confirm cookies are removed and
   the forwarding header policy is as documented.
6. A non-analytics request cannot choose or redirect the proxy to an arbitrary host.

### Analytics behaviour

1. A direct page load produces one PostHog `$pageview`.
2. Home -> Software, Back, and Forward each produce exactly one pageview for the
   resulting pathname. `/#about` produces a navigation click/chapter event but not a
   duplicate pathname pageview.
3. Leaving a page produces matching previous-page duration and scroll properties.
   Scroll percentages are within `0..1`; reaching the bottom is near `1`, not `100`.
4. Hero, About, Work, Archive, and Contact each emit once on a full Home traversal,
   including desktop pinned archive, mobile, reduced motion, and a direct `/#about`
   arrival. Scrolling backward does not repeat them.
5. Every annotated control emits the documented event and property set. Payloads do
   not contain the email address, full DOM hierarchy, visible copy, or unexpected
   high-cardinality values.
6. The email event is delivered before control passes to the mail client.

### Privacy and environment isolation

1. A normal cookieless visit leaves no PostHog identity in cookies, localStorage, or
   sessionStorage. A site-owned opt-out preference may remain and should be named in
   the privacy note.
2. GPC, DNT, and the site opt-out each prevent `/sawdust` event requests.
3. Choosing opt-out after analytics has already started stops subsequent collection
   in the same ClientRouter visit, not only after a hard reload.
4. Normal local development and PR previews do not enter production data.
5. The documented test mode works on local or preview infrastructure and is visibly
   tagged/separated from production.

### CSP, Cloudflare, and performance

1. No CSP errors occur on `/`, `/software`, `/photography`, or the standalone map.
2. If Web Analytics is enabled, automatic injection loads through the exact allowed
   script path and posts same-origin to `/cdn-cgi/rum` on production.
3. Astro soft navigations are not double-counted by either browser analytics tool.
4. Compare a production build before/after analytics for transferred JavaScript,
   long tasks during the Home reveal, and LCP. Record the result rather than relying
   on the plan's unverified SDK-size estimate.
5. Run `npm audit --audit-level=high` after adding `posthog-js` and Wrangler.

Roll out through a Cloudflare Worker version that can be rolled back. After the first
production day, inspect event volume, property cardinality, duplicate pageviews,
chapter progression, pageleave coverage, Worker requests, and vendor quotas before
calling the work complete.

## Claims to reword in the original plan

- Replace "ad blockers see nothing" with "the neutral same-origin path avoids common
  vendor-domain lists but remains observable and blockable."
- Replace "Cloudflare Web Analytics as an unblockable traffic baseline" with
  "Cloudflare edge Analytics as the request baseline; Web Analytics is an optional
  second browser-beacon dataset."
- Replace "cookieless: localStorage only" with PostHog's actual cookieless server-hash
  configuration and its limitations.
- Replace "no consent banner is needed" with a scoped statement that the design avoids
  analytics storage and identification, plus a requirement to confirm the site's
  applicable privacy obligations.
- Replace "attribute edits, no JS" with "declarative annotations consumed by one
  delegated analytics handler."
- Replace "50% intersection" with a stable reached-chapter definition based on a
  leading-edge viewport threshold.

## Primary references

- [PostHog JavaScript configuration](https://posthog.com/docs/libraries/js/config)
- [PostHog cookieless tracking](https://posthog.com/tutorials/cookieless-tracking)
- [PostHog Cloudflare reverse proxy](https://posthog.com/docs/advanced/proxy/cloudflare)
- [PostHog Web Analytics dashboard](https://posthog.com/docs/web-analytics/dashboard)
- [Cloudflare static asset bindings and selective worker-first routing](https://developers.cloudflare.com/workers/static-assets/binding/)
- [Cloudflare Web Analytics setup](https://developers.cloudflare.com/web-analytics/get-started/)
- [Cloudflare Web Analytics CSP and automatic-injection FAQ](https://developers.cloudflare.com/web-analytics/faq/)
- [Cloudflare Web Analytics SPA tracking](https://developers.cloudflare.com/web-analytics/get-started/web-analytics-spa/)
