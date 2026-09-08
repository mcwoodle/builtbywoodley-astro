# Security Policy

This repository holds the source for a static personal portfolio site
([builtbywoodley.ca](https://builtbywoodley.ca)). It has no server runtime, no
database, no user accounts, and collects no personal data. The realistic security
surface is therefore the build and deploy pipeline, the response headers the site
ships, and the dependency tree — not application logic.

Reports are welcome anyway, and are read.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

Use GitHub's private vulnerability reporting instead:

> **Security** tab → **Report a vulnerability**

That opens a private advisory visible only to the maintainer. It is the preferred
channel because it lets a fix land before any detail is public.

Useful things to include, as far as you have them:

- What the issue is, and which file, workflow, or URL it affects.
- The steps to reproduce it, or a proof of concept.
- What an attacker gets out of it.

## What to expect

This is a personal project maintained by one person in their spare time, so no
response-time guarantee is offered. In practice: an acknowledgement within about a
week, and an assessment once the report has been reproduced. You will be credited in
the advisory unless you would rather not be.

There is no bug bounty.

## Scope

**In scope**

- This repository: source, build scripts, and the GitHub Actions workflows.
- The deployed site at `builtbywoodley.ca` and `www.builtbywoodley.ca` —
  for example a Content-Security-Policy bypass, a header misconfiguration, or
  content injection.
- A dependency issue that is genuinely exploitable *as this site uses it*.

**Out of scope**

- Findings from an automated scanner with no demonstrated impact, including
  "missing header" reports for headers that do not apply to a static site.
- Denial of service, traffic flooding, or anything requiring physical access,
  social engineering, or a compromised maintainer device.
- Vulnerabilities in Cloudflare, GitHub, or another upstream provider — report
  those to the provider.
- Missing hardening that carries no exploit path (tell me anyway, just as a normal
  issue rather than a private report).

Please do not run automated scans against the live site.

## How this repository defends itself

These run continuously rather than on request:

- **Secret scanning** — gitleaks blocks commits locally via a pre-commit hook, and
  scans in CI on every pull request and push, plus weekly against the full history.
- **Static analysis** — CodeQL analyses both the site source and the GitHub Actions
  workflows themselves, on every pull request and weekly.
- **Dependencies** — `npm audit` gates every pull request and push; a dependency
  review runs on the pull request diff; Dependabot keeps packages and pinned
  actions current.
- **Pipeline** — workflows start from zero token permissions and opt in per job,
  the checkout credential is not persisted into the build environment, third-party
  actions are pinned to commit SHAs, and pull requests from forks never receive
  deploy credentials.
- **Transport and content** — a Content-Security-Policy plus HSTS and the usual
  hardening headers ship with every response (`public/_headers`).
