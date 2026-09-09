# AGENTS.md

Guidance for AI coding assistants working in this repository.

**Built by Woodley** — a personal portfolio and workshop journal: software case
studies, a build log, and a photography archive. Static Astro site, deployed to
Cloudflare as Worker static assets.

## Commands

| Command | Notes |
| :--- | :--- |
| `npm install` | Runs `prepare` → `scripts/setup-hooks.mjs` (git hooks + gitleaks) |
| `npm run dev` | Port 5572; `npm run dev -- 4321` to change it |
| `npm run build` | Static build to `dist/`, then the postbuild guards |
| `npm run test:smoke` | Playwright suite; builds and serves the site first |
| `npm run test:smoke:report` | HTML report from the last run |
| `npm run measure:images` | Image bytes per page, by screen size (`-- --self-test`) |
| `npm run audit:assets` | `-- --prune` shows, `-- --prune --confirm` deletes |
| `npm run photo:master` | `-- --max-long-edge=2560 --dry-run shot.jpg`; `-- --strip-only --in-place shot.jpg` |

`postbuild` runs after every build, local and CI alike: `check-asset-sizes.mjs` fails
at Cloudflare's hard 25 MiB per-asset limit (warns at 20 MiB); `audit-astro-assets.mjs`
reports full-size originals Astro emits but never references.

## Smoke tests (`tests/smoke/`)

Covers ClientRouter navigation between routes, the hash-driven photo viewer, the
three-mode theme toggle, the 404 page, and horizontal overflow at phone widths. Five
projects: Chrome, Firefox and WebKit at desktop width, plus Pixel 7 and iPhone 14.

- **`SMOKE_BASE_URL` names the target.** Unset, `playwright.config.ts` builds the site
  and serves it on `astro preview`.
  ```bash
  SMOKE_BASE_URL=https://builtbywoodley.ca npm run test:smoke   # a deployed origin
  SMOKE_BASE_URL=http://localhost:5572 npm run test:smoke -- --project=chromium
  ```
- **Keep every GSAP timeline inside a `(prefers-reduced-motion: no-preference)`
  guard.** The suite runs with `reducedMotion: 'reduce'`; an unguarded animation flakes.
- The security-header assertion skips itself unless `SMOKE_BASE_URL` is an `https://`
  origin.
- **WebKit only runs on Debian/Ubuntu** — it needs `libicu.so.74` and `libjpeg.so.8`,
  and `playwright install-deps` is apt-only. On Fedora run `--project=chromium
  --project=firefox --project=mobile-chrome`; CI (`ubuntu-latest`) covers the other two.

## Photography & image delivery

Width ladders live in `src/config/image-ladders.mjs` — plain `.mjs`, imported by both
the Astro components and the Node scripts. See `docs/photography-image-delivery.md`.

- Spread `ladderAttrs()` **last** in a prop list; the `src` fallback derives from the
  widths.
- `sizes` stays at each call site next to the CSS it mirrors. Change a breakpoint in
  `global.css`, change `sizes` with it, re-run `measure:images --self-test`.
- `?stats=true` on any URL reports real timings on a real device, in production too;
  it costs a normal visitor 1.8 KB.
- Masters are committed under archival export names and deployed under short ones: in
  `src/content/photos/manifest.mdx`, `master` names the file in `images/` and `src`
  names what it ships as; `src/integrations/stage-photo-masters.mjs` copies one to the
  other before the content collection is read.
- **Always strip EXIF on import** — phone exports carry GPS, and the full-size original
  is deployed.

## Security & CI

- **Secret scanning** — `gitleaks` in CI (`.github/workflows/security.yml`) and as a
  pre-commit hook. `npm install` fetches a checksum-verified, version-pinned binary into
  `node_modules/.bin` and installs the lefthook hooks (`lefthook.yml`). The hook fails
  closed: `node_modules/.bin`, then `PATH`, then block the commit with a fix-it message.
  `SKIP_GITLEAKS_INSTALL=1` opts out of the *download*, not the scan — with it set,
  commits are blocked until gitleaks is on `PATH`. `git commit --no-verify` bypasses.
- **Dependency scanning** — `npm audit --audit-level=high` on PRs, pushes, and weekly.
  Keep it clean of high/critical advisories.
- **PR dependency diff** — `actions/dependency-review-action` fails a PR that introduces
  a new high-severity advisory.
- **Static analysis** — CodeQL (`codeql.yml`) analyses `javascript-typescript` and
  `actions`.
- **HTTP security headers** — `public/_headers` ships CSP, HSTS,
  `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy` and
  `Permissions-Policy`; Cloudflare serves them with every static asset. The smoke suite
  asserts them against any deployed origin.
- **Updates** — Dependabot (`.github/dependabot.yml`) for npm deps and pinned actions.
- **Pipeline hardening** — every workflow starts at `permissions: {}` with per-job
  opt-in; `actions/checkout` runs with `persist-credentials: false`; third-party actions
  are pinned to commit SHAs; every job has `timeout-minutes`.

> **This is a public repository.** When editing CI:
>
> - `preview.yml` skips fork PRs. Its `Smoke tests` job runs anyway (`if: always()`),
>   building and serving the site itself — keep it able to report on fork PRs.
> - **Never introduce `pull_request_target`.**
> - `claude.yml` keeps two gates: `github.actor == github.repository_owner`, and the
>   thread-originator check on whose text becomes the prompt. Do not loosen either, and
>   do not add a trigger where the actor and the author of the text can differ. The
>   `issues: assigned` trigger is deliberately absent.

### Repository settings (not in version control)

Re-apply these if the repo is forked or recreated:

- Private vulnerability reporting **enabled**; Dependabot alerts and security updates
  **enabled**.
- Actions → Workflow permissions: **read-only** default `GITHUB_TOKEN`, "create and
  approve pull requests" **off**. Fork PR workflows: **require approval for all external
  contributors**.
- Two branch rulesets on `mainline`:
  - **Mainline protection** — no deletion, no force pushes, **no bypass for anyone, the
    owner included**.
  - **Mainline review requirements** — changes arrive via PR with `Secret scan
    (gitleaks)`, `Dependency scan`, `Dependency review (PR diff)`, `Analyze
    (javascript-typescript)`, `Analyze (actions)` and `Smoke tests` green. **Admin
    bypasses this one always.**
  - Required approving reviews: **0**.
  - Renaming a required check in a workflow means updating the context here too.
- CodeQL results appear under the **Security** tab once `codeql.yml` has run on
  `mainline` at least once.

## Authoring

### Commit messages

- Conventional commits: `type(scope): description`. Types: feat, fix, refactor, docs,
  test, chore, style, content.
- Imperative mood ("Add feature", not "Added feature"), subject under 72 characters,
  0–3 sentences of body.
- ALWAYS use `Co-Authored-By` (Claude: your default. Antigravity IDE only:
  `[model] <antigravity.git@gmail.com>`, with the real model name and version).

### Keeping the README current

`README.md` is the front door. **Update it in the same PR** when a change adds or
reshapes something at that level: a new top-level directory, a new npm script anyone
would run, a new CI check or required status, a change to how the site is built, served
or deployed, or a whole new class of tooling.

Leave it alone for routine work: a new component, a content entry, a bug fix, a
dependency bump, a refactor inside existing structure.

The test: *would someone cloning this repo tomorrow be surprised, or waste time,
because the README does not mention it?*

Keep it high-level and honest. The README says what exists and how to run it;
`AGENTS.md` and `docs/` carry the detail. Point at them rather than duplicating.

## Architecture

- **`src/pages/`, `src/layouts/`** — file-based routes. `BaseLayout.astro` supplies the
  site chrome (sticky `TopNav`, `SiteFooter`) to every page; full-bleed routes opt out
  with `hideNav` / `hideFooter`.
- **`src/components/`** — Astro UI components (Header, ContentCarousel, BlogEntry).
- **`src/content/`** — Markdown/MDX content collections (projects, software, photos,
  work), typed by Zod schemas in `src/content.config.ts`. Photos and work history each
  live in a single manifest rather than one file per entry.
- **`src/styles/global.css`** — global styles and CSS custom properties (tokens);
  Tailwind is also configured for utility classes (`tailwind.config.ts`).
- **`src/integrations/`, `src/plugins/`, `src/scripts/`** — build-time Astro
  integrations, remark/rehype plugins, client-side scripts.
