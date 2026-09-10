// The analytics proxy — and nothing else.
//
// This is the site's first Worker script. Everything that is not the analytics
// path falls straight through to `env.ASSETS.fetch(request)`, which is the same
// asset router that served the whole site before this file existed: `_headers`
// still governs asset responses, `html_handling` still drops trailing slashes,
// and `not_found_handling` still serves dist/404.html. `run_worker_first` in
// wrangler.jsonc narrows what reaches this script to `/sawdust/*`, so a normal
// page request never enters the Worker at all.
//
// Why proxy at all: this site's audience is developer-heavy and
// `i.posthog.com` is on the common blocklists, so ingesting directly would bias
// the data in exactly the population the site is written for — and it would
// need a `connect-src` exception in a CSP that is otherwise `'self'`. A
// same-origin path costs neither.
//
// The path name is deliberately not /analytics, /track or /posthog. PostHog's
// own proxy guide names those as the strings blocklists match.
//
// See docs/front-end-analytics-design.md — "Worker proxy" — for the contract
// this implements and the reasoning behind each rule.

/**
 * The two upstream hosts, for the region chosen in Phase 0 (US).
 *
 * These are CONSTANTS, and that is a security property rather than a
 * convenience: the upstream host must never be derived from a query parameter,
 * a request header or a path segment, or this becomes an open proxy that will
 * fetch anything on the internet from a builtbywoodley.ca origin. Changing
 * region is a deliberate edit here plus a line in the privacy disclosure — the
 * project cannot be migrated between PostHog's US and EU clouds, so in practice
 * this does not change once data exists.
 */
const UPSTREAM = {
  /** Ingest, config and flags. */
  api: 'us.i.posthog.com',
  /** Static SDK assets. Only reached if something asks for them; posthog-js is bundled. */
  assets: 'us-assets.i.posthog.com',
} as const;

/** The prefix that marks a request as ours. Stripped before forwarding. */
const PREFIX = '/sawdust';

/**
 * Paths PostHog serves from its assets host rather than its API host, and the
 * only ones worth caching at the edge. The SDK is bundled from npm, so these
 * are close to unused here — they exist because a PostHog feature that does
 * fetch its own asset should not 404 through the proxy.
 */
const ASSET_PREFIXES = ['/static/', '/array/'] as const;

/**
 * Headers that must not survive the hop.
 *
 * `cookie` and `set-cookie`: the whole design is cookieless, and forwarding a
 * site cookie to a processor would undo that on its own.
 *
 * The forwarding headers: a browser can send `X-Forwarded-For` claiming to be
 * any address it likes. Cloudflare's `CF-Connecting-IP` is the one the edge
 * sets and the client cannot forge, so every client-supplied variant is dropped
 * and the trusted value is set explicitly below.
 *
 * `host` is dropped so `fetch()` derives it from the upstream URL — setting it
 * by hand is how a proxy ends up sending the wrong SNI.
 */
const STRIP_REQUEST_HEADERS = [
  'cookie',
  'host',
  'forwarded',
  'x-forwarded-for',
  'x-forwarded-host',
  'x-forwarded-proto',
  'x-real-ip',
  'true-client-ip',
] as const;

/** Cloudflare's own request annotations. PostHog does its own GeoIP from the IP. */
const STRIP_CF_HEADERS = [
  'cf-connecting-ip',
  'cf-connecting-ipv6',
  'cf-ipcountry',
  'cf-ray',
  'cf-visitor',
  'cf-worker',
  'cf-ew-via',
  'cdn-loop',
] as const;

function upstreamFor(path: string): string {
  return ASSET_PREFIXES.some((prefix) => path.startsWith(prefix))
    ? UPSTREAM.assets
    : UPSTREAM.api;
}

/**
 * Rebuild the request for the upstream: same path minus our prefix, same query,
 * a minimised header set, and a buffered body.
 */
async function buildUpstreamRequest(request: Request, url: URL): Promise<Request> {
  const path = url.pathname.slice(PREFIX.length) || '/';
  const target = new URL(`https://${upstreamFor(path)}${path}${url.search}`);

  const headers = new Headers(request.headers);
  for (const name of STRIP_REQUEST_HEADERS) headers.delete(name);
  for (const name of STRIP_CF_HEADERS) headers.delete(name);

  // Server-hash mode needs the visitor's IP to compute the daily hash that
  // stands in for an identifier. This is the transient use documented in the
  // privacy disclosure: PostHog hashes it and does not store it, and nothing
  // durable is written to the browser. The value comes from Cloudflare, never
  // from the request the browser wrote.
  const clientIp = request.headers.get('CF-Connecting-IP');
  if (clientIp) headers.set('X-Forwarded-For', clientIp);

  // Buffer rather than stream. `new Request(url, request)` keeps the body as a
  // stream, which needs `duplex: 'half'` and fails on some runtime/upstream
  // combinations part-way through a POST — silently losing events rather than
  // erroring. Ingest bodies are a few kilobytes of compressed batch at most, so
  // reading them into memory costs nothing worth having.
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD';
  const body = hasBody ? await request.arrayBuffer() : undefined;

  return new Request(target, {
    method: request.method,
    headers,
    body,
    redirect: 'follow',
  });
}

/**
 * Fetch an asset through the edge cache. Only GETs, and only the asset paths —
 * ingest must never be served from cache.
 */
async function fetchCachedAsset(
  upstream: Request,
  ctx: ExecutionContext,
): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(upstream.url, { method: 'GET' });

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const response = await fetch(upstream);
  // Only store what the upstream said is storable, and never an error.
  if (response.ok) {
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    // Everything that is not the analytics path is the site, served exactly as
    // it was before this Worker existed.
    if (url.pathname !== PREFIX && !url.pathname.startsWith(`${PREFIX}/`)) {
      return env.ASSETS.fetch(request);
    }

    try {
      const path = url.pathname.slice(PREFIX.length) || '/';
      const upstream = await buildUpstreamRequest(request, url);

      const cacheable =
        request.method === 'GET' &&
        ASSET_PREFIXES.some((prefix) => path.startsWith(prefix));

      const response = cacheable
        ? await fetchCachedAsset(upstream, ctx)
        : await fetch(upstream);

      // Strip any upstream attempt to write to this origin. Nothing in the
      // cookieless flow sets a cookie; if that ever changes it is a decision to
      // be made here rather than one inherited silently from a vendor.
      const headers = new Headers(response.headers);
      headers.delete('set-cookie');

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    } catch (error) {
      // Deliberately narrow: the error's own name, and nothing from the
      // request. Event bodies carry what a visitor did, and the forwarded IP is
      // the input to their identity hash — neither belongs in a log line.
      console.error(
        `sawdust: upstream request failed (${error instanceof Error ? error.name : 'unknown'})`,
      );
      return new Response('Bad gateway', {
        status: 502,
        headers: { 'content-type': 'text/plain; charset=utf-8' },
      });
    }
  },
} satisfies ExportedHandler<Env>;
