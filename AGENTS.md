# AGENTS.md

This file provides guidance to AI coding assistants when working with code in this repository.

## Project Overview

Built by Woodley: A personal portfolio and workshop journal built with Astro, showcasing projects, setups, and experiments.

## Commands

**Install dependencies:**
```bash
npm install
```

**Run development server:**
```bash
npm run dev
```

**Build for production:**
```bash
npm run build
```

`postbuild` runs two guards after every build, local and CI alike:
`check-asset-sizes.mjs` fails the build if any file reaches Cloudflare's hard
25 MiB per-asset limit (warning at 20 MiB), and `audit-astro-assets.mjs` reports
the full-size originals Astro emits but never references.

**Photography image delivery:**
```bash
npm run measure:images              # bytes per page, by screen size
npm run measure:images -- --self-test
npm run audit:assets                # -- --prune shows, -- --prune --confirm deletes
npm run photo:master -- --max-long-edge=2560 --dry-run shot.jpg
npm run photo:master -- --strip-only --in-place shot.jpg   # EXIF/GPS, losslessly
```

Every responsive width ladder lives in `src/config/image-ladders.mjs` — plain
`.mjs` because the Astro components and the Node scripts both import it. Spread
`ladderAttrs()` **last** in a prop list so nothing can override it; the `src`
fallback is derived from the widths, so it can never be forgotten. The `sizes`
attribute stays at each call site next to the CSS it mirrors — if you change a
breakpoint in `global.css`, change `sizes` with it and re-run
`measure:images --self-test`. For real timings on a real device, add
`?stats=true` to any URL — it works in production and costs a normal visitor
1.8 KB, because the probe itself is a lazily imported chunk. See
`docs/photography-image-delivery.md`.

Photography masters are committed under their archival export names and deployed
under short ones: `master` in `src/content/photos/manifest.mdx` names the file in
`images/`, `src` names what it ships as, and `src/integrations/stage-photo-masters.mjs`
copies one to the other before the content collection is read. Always strip EXIF
on import — phone exports carry GPS, and the full-size original is deployed.

## Security & CI

Automated guardrails keep secrets and vulnerable dependencies out of the repo:

- **Secret scanning** — `gitleaks` runs in CI (`.github/workflows/security.yml`)
  and locally as a pre-commit hook. A staged secret blocks the commit.
- **Local hooks** — `npm install` runs the `prepare` script (`scripts/setup-hooks.mjs`),
  which fetches a **checksum-verified, version-pinned** gitleaks binary into
  `node_modules/.bin` and installs the lefthook hooks (`lefthook.yml`). No manual
  step is needed; set `SKIP_GITLEAKS_INSTALL=1` to opt out of the download.
- **Dependency scanning** — `npm audit --audit-level=high` runs on PRs, pushes,
  and the weekly schedule. Keep `npm audit` clean of high/critical advisories or
  CI will fail.
- **HTTP security headers** — `public/_headers` ships a Content-Security-Policy
  plus HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and
  `Permissions-Policy`, which Cloudflare serves with every static asset.
- **Updates** — Dependabot (`.github/dependabot.yml`) keeps npm deps and pinned
  GitHub Actions current.

> **Private repo:** SAST via CodeQL code scanning needs GitHub Advanced Security
> (free only on public repos), so it is not enabled here — the public-only CodeQL
> workflow and `dependency-review-action` have been removed. If this repo ever goes
> public, re-add a `github/codeql-action` workflow and `actions/dependency-review-action`
> to restore SAST and PR dependency-diff reporting.

## Authoring

### Commit Messages
- Use conventional commits format: `type(scope): description`
- Types: feat, fix, refactor, docs, test, chore, style, content
- Keep the subject line under 72 characters
- Add 0-3 sentences to the commit message body to describe the changes.
- Use imperative mood ("Add feature" not "Added feature")
- ALWAYS use "Co-Authored-By" in commit messages (For Claude, use your default, for Antigravity IDE only use "[model] <antigravity.git@gmail.com>" - replacing [model] with the actual model name and version)

## Architecture

The site is built as a static site using Astro.

### Pages & Layouts (`src/pages/`, `src/layouts/`)
The main entry points are in `src/pages/`. Layout components are in `src/layouts/BaseLayout.astro`.
`BaseLayout` supplies the site chrome — the sticky `TopNav` and the `SiteFooter` — so every page
gets both for free. Full-bleed routes that own the whole window opt out with `hideNav` / `hideFooter`.

### Components (`src/components/`)
Astro components used to build the UI (e.g., Header, ContentCarousel, BlogEntry).

### Content Collections (`src/content/projects/`)
Project entries are stored as Markdown/MDX files within Astro content collections. They use frontmatter for metadata (title, description, publishDate, projectType, etc.).

### Styling (`src/styles/`)
Global styles and CSS custom properties (tokens) are defined in `src/styles/global.css`. Tailwind CSS is also configured for utility classes (`tailwind.config.ts`).
