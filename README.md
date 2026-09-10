# Built by Woodley

The source for **[builtbywoodley.ca](https://builtbywoodley.ca)** — a personal
portfolio and workshop journal. One editorial layout carries three things: software
case studies, a project log of woodworking and renovation builds, and a photography
archive.

Static, built with [Astro](https://astro.build), Tailwind CSS v4, GSAP and Lenis, and
served from Cloudflare's edge. No origin to keep online: every page is a static asset.
A small Worker sits alongside them and handles exactly one path — the analytics proxy
described below — and nothing else.

## Quick start

Requires Node.js 22 or newer.

```bash
npm install     # also installs the git hooks and a pinned secret scanner
npm run dev     # http://localhost:5572
```

The pre-commit secret scan **fails closed**: if the scanner is missing, the commit is
blocked rather than passed through unscanned, and the error says how to fix it.
`SKIP_GITLEAKS_INSTALL=1` skips the download but not the scan — on a platform with no
pinned release, install `gitleaks` yourself and the hook will find it on `PATH`.

## Scripts

| Command | What it does |
| :--- | :--- |
| `npm run dev` | Dev server. Pass a port: `npm run dev -- 4321` |
| `npm run build` | Static build to `dist/`, followed by the postbuild guards |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run test:smoke` | Playwright smoke suite — builds and serves the site first |
| `npm run test:smoke:ui` | The same suite in Playwright's interactive runner |
| `npm run test:smoke:report` | Open the HTML report from the last run |
| `npm run measure:images` | Report image bytes per page, by screen size |
| `npm run audit:assets` | List full-size originals Astro emits but never references |
| `npm run photo:master` | Resize and strip EXIF from a photograph before import |
| `npm run preview:worker` | Build, then serve through the real Worker — the only way to exercise `/sawdust/*` |
| `npm run typegen:worker` | Regenerate the Worker's binding types after a `wrangler.jsonc` change |
| `npm run check:worker` | Bundle the Worker without deploying (`wrangler deploy --dry-run`) |

Two guards run after every build, locally and in CI: one fails the build if a file
approaches Cloudflare's per-asset size limit, the other reports unreferenced originals.

## Testing

A Playwright smoke suite in `tests/smoke/` covers what a build cannot: that pages
render, that client-side navigation survives a second page, and that nothing throws on
the way.

```bash
npx playwright install    # once, to fetch the browsers
npm run test:smoke        # builds, serves dist/, runs, then tears down
```

To test a site that is already up, name it instead:

```bash
SMOKE_BASE_URL=https://builtbywoodley.ca npm run test:smoke
```

Five projects run on every pull request — Chrome, Firefox and WebKit at desktop width,
plus Pixel 7 and iPhone 14 — covering route navigation, the photo viewer, the theme
toggle, the 404 page and phone-width overflow. CI points them at that PR's own
Cloudflare preview URL, so a routing or header change that only breaks at the edge
fails the PR instead of reaching production.

`webkit` and `mobile-safari` need Debian or Ubuntu. On another distribution, run the
rest locally and let CI cover those two:

```bash
npm run test:smoke -- --project=chromium --project=firefox --project=mobile-chrome
```

## Project structure

```text
src/
├── assets/         logos and other bundled assets
├── components/     UI components — nav, carousel, photo viewer, footer
├── config/         shared config, notably the responsive image ladders
├── content/        content collections: projects, software, photos, work
├── integrations/   build-time Astro integrations
├── layouts/        BaseLayout supplies the site chrome to every page
├── lib/, utils/    shared helpers
├── pages/          file-based routes
├── plugins/        remark / rehype plugins
├── scripts/        client-side scripts (navigation transitions, analytics)
├── styles/         global.css — design tokens and page styles
└── worker/         the Cloudflare Worker — analytics proxy only
public/             static passthrough, including the response-headers file
scripts/            Node tooling: build guards, image measurement, hook setup
tests/              Playwright smoke suite (smoke/) and its helpers (support/)
docs/               deep dives on image delivery, view transitions and analytics
```

Content is authored as MDX under `src/content/` and validated by Zod schemas in
`src/content.config.ts`. Photography and work history each live in a single manifest
rather than one file per entry.

## Deploying and hosting

`astro build` emits `dist/`, and Cloudflare serves it as Worker static assets. Routing,
asset handling and the custom domains are declared in `wrangler.jsonc`, so Wrangler
provisions DNS and TLS on deploy instead of anyone editing the dashboard.

A Worker script (`src/worker/index.ts`) is deployed with those assets, but selective
routing (`run_worker_first`) means only `/sawdust/*` ever reaches it. Every page and
asset request is served by the asset router exactly as before, without waking the
script — so static-asset requests stay free and unmetered, and a bug in the Worker
cannot take the site down with it.

- **Production** — a push to `mainline` runs install, build, `wrangler deploy`. That is
  the only path to production.
- **Pull requests** — each push uploads a *version* (`wrangler versions upload`) and
  comments the immutable preview URL on the PR, so every revision keeps its own link;
  production traffic is never touched. The smoke suite then runs against that URL before
  the PR can merge. Preview URLs must be enabled once for the Worker in the Cloudflare
  dashboard. Fork PRs skip the upload — they cannot read repository secrets — and the
  smoke suite builds and serves the site itself there.
- **Credentials** — two repository secrets: a scoped Cloudflare API token (`Workers
  Scripts: Edit` is enough) and the account ID. Nothing lives in the repo.
- **Headers** — `public/_headers` ships a Content-Security-Policy alongside HSTS and the
  usual hardening headers, applied to every response Cloudflare serves.

To deploy by hand, from a machine with Wrangler already authenticated:

```bash
npm run build
npx wrangler deploy
```

## Analytics

The site measures how it is read, and deliberately not who reads it: no cookies, no
visitor ID, nothing durable in the browser but the reader's own opt-out preference.
PostHog is the processor, in cookieless server-hash mode with autocapture off, reached
through a same-origin Worker path so no request leaves the site's own domain and the
`connect-src 'self'` policy is untouched. Global Privacy Control and Do Not Track are
honoured before the SDK is even downloaded, and `/privacy` explains the rest and holds
the switch.

It is off unless a build says otherwise: `PUBLIC_ANALYTICS_ENABLED` and
`PUBLIC_POSTHOG_KEY`, both documented in `.env.example`. Local runs and PR previews stay
off, and a test build points at a separate PostHog project rather than the real one.

`docs/front-end-analytics-design.md` is the design of record — what is collected, what
was rejected and why, and what still has to be switched on by hand.

## Security

Found a vulnerability? Report it privately — **Security** tab → **Report a
vulnerability**, not a public issue. [SECURITY.md](SECURITY.md) has the scope.

Running continuously:

- **Secrets** — gitleaks blocks commits locally and scans in CI on every PR and push,
  plus weekly against the full history.
- **Static analysis** — CodeQL analyses the site source and the workflows themselves,
  on every PR and weekly.
- **Dependencies** — `npm audit --audit-level=high` gates every PR and push, a
  dependency review runs on the PR diff, and Dependabot keeps packages and pinned
  actions current.
- **Pipeline** — workflows start from zero token permissions and opt in per job, the
  checkout credential is never persisted, third-party actions are pinned to commit SHAs,
  and fork PRs never receive deploy credentials.
- **Transport and content** — CSP, HSTS and the usual hardening headers, asserted by the
  smoke suite against every deployed origin it tests, so a header change Cloudflare
  quietly rejects fails the PR rather than shipping.

## Contributing

This is a personal site, so the content is mine and PRs that rewrite it are unlikely to
land. Everything else is fair game — bug reports, build and tooling fixes,
accessibility problems and broken links are all genuinely welcome. Open an issue first
for anything substantial.

[`AGENTS.md`](AGENTS.md) is the canonical guide to the architecture and conventions
here, for humans and coding agents alike — read it first. Commits follow
[Conventional Commits](https://www.conventionalcommits.org): `type(scope): description`,
imperative mood, subject under 72 characters.

Two things to expect from a fork PR: the Cloudflare preview job skips it (forks cannot
read repository secrets, by design), and a maintainer has to approve the first workflow
run. The security checks still run.

## Further reading

- `docs/front-end-analytics-design.md` — what the site measures, the alternatives that
  were rejected, and the account work still outstanding.
- `docs/photography-image-delivery.md` — the responsive image pipeline, width ladders,
  and how delivery is measured.
- `docs/whole-page-navigation-animation-plan.md` — cross-document navigation transitions.
- `docs/chrome-view-transition-white-rectangle.md` — a browser-specific view transition
  bug and its workaround.

## License

MIT © Matt Woodley. See [LICENSE](LICENSE).
