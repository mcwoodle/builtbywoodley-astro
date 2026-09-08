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

**Run the smoke tests:**
```bash
npm run test:smoke                                    # all 5 projects, builds first
npm run test:smoke -- --project=chromium --headed
npm run test:smoke:report                             # HTML report from the last run
```

A Playwright suite in `tests/smoke/` covering the flows a build cannot check:
ClientRouter navigation between routes, the hash-driven photo viewer, the
three-mode theme toggle, the 404 page, and horizontal overflow at phone widths.
Five projects — Chrome, Firefox and WebKit at desktop width, plus Pixel 7 and
iPhone 14 — run in one job. WebKit is Safari's *engine*, not Safari itself.

The suite never knows where the site is: **`SMOKE_BASE_URL` names the target**,
and with it unset `playwright.config.ts` builds the site and serves it on
`astro preview` instead. That one switch covers a local run, the CI run against
the Cloudflare preview URL, and the fork-PR fallback with no branching in the
tests.

```bash
SMOKE_BASE_URL=https://builtbywoodley.ca npm run test:smoke      # a deployed origin
npm run dev                                                      # ... or, for a fast loop,
SMOKE_BASE_URL=http://localhost:5572 npm run test:smoke -- --project=chromium
```

Two things hold the suite steady, and both are worth knowing before adding to
it. `reducedMotion: 'reduce'` is **load-bearing**, not a courtesy: every GSAP
timeline sits inside a `(prefers-reduced-motion: no-preference)` guard, so
asking for stillness is what makes below-the-fold content assertable at all —
a new animation that forgets that guard will show up here as a flaky test. And
the security-header assertion skips itself unless `SMOKE_BASE_URL` is an
`https://` origin, because `public/_headers` is a Cloudflare directive that
`astro preview` copies into `dist/` without ever applying.

One local caveat: **Playwright's WebKit only runs on Debian/Ubuntu.** The build
links against `libicu.so.74` and `libjpeg.so.8`, which Fedora does not ship, so
`webkit` and `mobile-safari` fail to launch on a Fedora workstation no matter
what `playwright install-deps` is given — that command is apt-only. Run
`--project=chromium --project=firefox --project=mobile-chrome` locally there and
let CI, which is `ubuntu-latest`, cover the other two.

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
  step is needed. The hook **fails closed**: it looks in `node_modules/.bin` and
  then on `PATH`, and blocks the commit with a fix-it message if it finds
  neither. It used to print a notice and exit 0, which made a skipped or broken
  install indistinguishable from a clean scan. `SKIP_GITLEAKS_INSTALL=1` opts
  out of the *download*, not the scan — set it and commits are blocked until
  gitleaks is on `PATH`. Use `git commit --no-verify` for a real emergency.
- **Dependency scanning** — `npm audit --audit-level=high` runs on PRs, pushes,
  and the weekly schedule. Keep `npm audit` clean of high/critical advisories or
  CI will fail.
- **HTTP security headers** — `public/_headers` ships a Content-Security-Policy
  plus HSTS, `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, and
  `Permissions-Policy`, which Cloudflare serves with every static asset. The
  smoke suite asserts they are actually present whenever it runs against a
  deployed origin, so a `_headers` edit that Cloudflare silently rejects fails
  the PR instead of shipping.
- **Updates** — Dependabot (`.github/dependabot.yml`) keeps npm deps and pinned
  GitHub Actions current.
- **Static analysis (SAST)** — CodeQL (`.github/workflows/codeql.yml`) analyses
  two languages: `javascript-typescript` for the site source and `actions` for the
  workflow files themselves. Free on public repositories.
- **PR dependency diff** — `actions/dependency-review-action` fails a pull request
  that introduces a new high-severity advisory, which catches a bad dependency in
  review rather than after it lands.
- **Pipeline hardening** — every workflow starts at `permissions: {}` and each job
  opts into the scopes it needs; `actions/checkout` runs with
  `persist-credentials: false` so the job token is not left in `.git/config` where a
  dependency lifecycle script could read it; third-party actions are pinned to
  commit SHAs; and every job has a `timeout-minutes`.

> **This is a public repository.** Two consequences worth holding on to when
> editing CI:
>
> 1. **Anyone can open a pull request.** Fork PRs cannot read repository secrets,
>    so `preview.yml` skips them outright rather than failing on a missing token.
>    Its `Smoke tests` job runs anyway (`if: always()`), building and serving the
>    site itself when there is no preview URL to point at — which is what makes
>    that job safe to require, since a required check that never reports on fork
>    PRs would block them forever.
>    Never introduce `pull_request_target` to work around that — it runs untrusted
>    PR code with a privileged token, and it is the single most common way a public
>    repo leaks its secrets.
> 2. **Anyone can write text the AI workflow might read.** `claude.yml` carries two
>    gates, and both matter. `github.actor == github.repository_owner` decides who
>    may invoke Claude; the thread-originator check decides *whose text* can become
>    the prompt. The `issues: assigned` trigger is deliberately absent for the same
>    reason — on that event the actor is the assigner while the issue body is
>    stranger-authored. Loosening either gate, or adding a trigger where the actor
>    and the author of the text can differ, reopens an indirect prompt-injection
>    path into a run holding the owner's Claude token.

### Repository settings (not in version control)

These cannot live in the repo, so they are recorded here. If the repo is ever
forked or recreated, re-apply them:

- Private vulnerability reporting: **enabled** (this is what `SECURITY.md` points at).
- Dependabot alerts and security updates: **enabled**.
- Actions → Workflow permissions: **read-only** default `GITHUB_TOKEN`, and
  "Allow GitHub Actions to create and approve pull requests" **off**.
- Actions → Fork pull request workflows: **require approval for all external
  contributors**, so a stranger's first workflow run does not start unreviewed.
- Branch rulesets on `mainline` — **two**, deliberately, because they have
  different bypass lists. `mainline` deploys straight to production, so it is the
  branch that most needs the guard rails.
  - **Mainline protection** — blocks deletion and force pushes. **No bypass for
    anyone, the owner included.** History on the production branch is not
    rewritable by accident or otherwise.
  - **Mainline review requirements** — changes must arrive via a pull request,
    with `Secret scan (gitleaks)`, `Dependency scan`, `Dependency review (PR
    diff)`, `Analyze (javascript-typescript)`, `Analyze (actions)` and
    `Smoke tests` green.
    **The repository admin role bypasses this one always**, so the owner can push
    content straight to `mainline` and deploy without opening a PR. Everyone
    else — any future collaborator, any fork PR — goes through a PR with the
    checks passing.
  - Required approving reviews is deliberately **0**. The owner is the only
    account that can press merge, so requiring an approval would only mean
    approving your own PR before merging it — no guard, and it puts a
    bypass-the-rules banner on every merge. The PR requirement and the checks are
    what carry the weight.
  - If a required check is ever renamed in a workflow, update the context here
    too: a required check that no longer exists blocks every non-bypassing PR.
- Code scanning: CodeQL results appear under the **Security** tab once
  `codeql.yml` has run at least once on `mainline`.

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
