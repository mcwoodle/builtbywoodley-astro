# Built by Woodley

The source for **[builtbywoodley.ca](https://builtbywoodley.ca)** — a personal
portfolio and workshop journal. One editorial layout carries three things: software
case studies, a project log of woodworking and renovation builds, and a photography
archive.

It is a static site, built with [Astro](https://astro.build), Tailwind CSS v4, GSAP
and Lenis, and served from Cloudflare's edge. There is no server runtime and no
origin to keep online.

## Quick start

Requires Node.js 22 or newer.

```bash
npm install     # also installs the local git hooks
npm run dev     # http://localhost:5572
```

`npm install` runs `scripts/setup-hooks.mjs`, which installs the lefthook pre-commit
hooks and fetches a checksum-verified, version-pinned secret scanner. Set
`SKIP_GITLEAKS_INSTALL=1` to opt out of that download.

## Scripts

| Command | What it does |
| :--- | :--- |
| `npm run dev` | Dev server. Pass a port: `npm run dev -- 4321` |
| `npm run build` | Static build to `dist/`, followed by the postbuild guards |
| `npm run preview` | Serve the built `dist/` locally |
| `npm run measure:images` | Report image bytes per page, by screen size |
| `npm run audit:assets` | List full-size originals Astro emits but never references |
| `npm run photo:master` | Resize and strip EXIF from a photograph before import |

Two guards run after every build, locally and in CI: one fails the build if any file
approaches Cloudflare's per-asset size limit, the other reports unreferenced originals.

## Project structure

```text
src/
├── components/     UI components — nav, carousel, photo viewer, footer
├── config/         shared config, notably the responsive image ladders
├── content/        content collections: projects, software, photos, work
├── integrations/   build-time Astro integrations
├── layouts/        BaseLayout supplies the site chrome to every page
├── pages/          file-based routes
├── plugins/        remark / rehype plugins
├── scripts/        client-side scripts (navigation transitions)
└── styles/         global.css — design tokens and page styles
public/             static passthrough, including the response-headers file
scripts/            Node tooling: build guards, image measurement, hook setup
docs/               deep dives on image delivery and view transitions
```

Content is authored as MDX under `src/content/` and validated by Zod schemas in
`src/content.config.ts`. Photography and work history each live in a single manifest
rather than one file per entry.

## Deploying and hosting

`astro build` emits `dist/`, and Cloudflare serves it as Worker static assets.
Routing, asset handling and the custom domains are declared in `wrangler.jsonc`, so
Wrangler provisions DNS and TLS on deploy instead of anyone editing the dashboard.

**Production.** A push to `mainline` runs the deploy workflow: install, build,
`wrangler deploy`. That is the only path to production.

**Pull requests.** Every push to a PR uploads a *version* rather than deploying
(`wrangler versions upload`) and comments the resulting immutable preview URL on the
PR, so each revision keeps its own link. Production traffic is never touched. Preview
URLs must be enabled once for the Worker in the Cloudflare dashboard. PRs from forks
are skipped, because they cannot read repository secrets.

**Credentials.** Deploys authenticate with two repository secrets — a scoped
Cloudflare API token (`Workers Scripts: Edit` is enough) and the account ID. Nothing
else is needed, and no credentials live in the repo.

**Headers.** `public/_headers` ships a Content-Security-Policy alongside HSTS and the
usual hardening headers; Cloudflare applies them to every response it serves.

To deploy by hand, from a machine with Wrangler already authenticated:

```bash
npm run build
npx wrangler deploy
```

## Security

Found a vulnerability? Please report it privately — **Security** tab → **Report a
vulnerability**, not a public issue. [SECURITY.md](SECURITY.md) has the details and
the scope.

Running continuously:

- **Secret scanning** — gitleaks blocks commits locally via a pre-commit hook, and
  scans in CI on every pull request and push, plus weekly against the full history.
- **Static analysis** — CodeQL analyses the site source and the GitHub Actions
  workflows themselves, on every pull request and weekly.
- **Dependencies** — `npm audit --audit-level=high` gates every pull request and
  push, a dependency review runs on the pull request diff, and Dependabot keeps
  packages and pinned actions current.
- **Pipeline** — workflows start from zero token permissions and opt in per job,
  the checkout credential is never persisted into the build environment,
  third-party actions are pinned to commit SHAs, and fork pull requests never
  receive deploy credentials.
- **Transport and content** — a Content-Security-Policy plus HSTS and the usual
  hardening headers, in `public/_headers`.

## Contributing

This is a personal site, so the content is mine and pull requests that rewrite it
are unlikely to land. Everything else is fair game — bug reports, build and
tooling fixes, accessibility problems, and broken links are all genuinely welcome.
Open an issue first for anything substantial, so neither of us builds the wrong
thing.

[`AGENTS.md`](AGENTS.md) is the canonical guide to the architecture and conventions
here, for humans and coding agents alike — read it first. Commits follow
[Conventional Commits](https://www.conventionalcommits.org):
`type(scope): description`, imperative mood, subject under 72 characters.

Two things to expect when you open a pull request from a fork: the Cloudflare
preview job skips it (forks cannot read repository secrets, by design), and a
maintainer has to approve the first workflow run. The security checks still run.

## Further reading

- `docs/photography-image-delivery.md` — the responsive image pipeline, width
  ladders, and how delivery is measured.
- `docs/whole-page-navigation-animation-plan.md` — the cross-document navigation
  transitions.
- `docs/chrome-view-transition-white-rectangle.md` — a browser-specific view
  transition bug and its workaround.

## License

MIT © Matt Woodley. See [LICENSE](LICENSE).
