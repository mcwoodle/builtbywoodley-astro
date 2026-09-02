# TruVerifAI in practice: one session, measured

A field report for the TruVerifAI team, written immediately after the session it
describes so the details are first-hand rather than reconstructed.

**Session:** 2026-09-02, roughly 15:36–16:16 local (~40 minutes wall clock).
**Repository:** a private Astro 7 static photography portfolio deployed to
Cloudflare Workers static assets. Small — 33 pages, 228 files in `dist/`, one
developer.
**Task given to the agent:** implement a design document
(`docs/photography-image-delivery.md`), optimise image rendering, make the
responsive width ladders easy to configure, and make image loading measurable by
screen size.
**Result:** two commits (`701290c`, `540887a`), 13 files, 1,865 insertions.

Timings below are inferred from file mtimes, commit timestamps and the
`recorded_at` fields the MCP returned. They are accurate to roughly a minute, not
instrumented. Credits, token counts, agreement scores and finding text are exact,
copied from the tool responses.

---

## 1. Summary for the impatient

| | |
| --- | --- |
| Panel calls that ran | 2 (`deliberate_coding`, `audit_coding`) |
| Credits consumed | **8.2** (4.3 + 3.9) |
| Panel tokens | **157,678** (86,282 + 71,396) |
| MCP calls made | **14** (2 panel invocations + 1 rejected, 6 continuation polls, 3 gate skips, 2 outcome records) |
| Wall time attributable to the tool | **~10 minutes of ~40** (~25%) |
| Findings raised | 9 (1 critical, 5 major, 2 minor, 1 preference) |
| Findings that were live bugs | **1** |
| Findings that were correct and preventive | 3 |
| Findings partially correct | 2 |
| Findings factually wrong for this codebase | **2** |
| Findings declined | 1 |
| Decisions changed by the panel | **3** (2 from deliberate, 1 net-new from audit) |

**The honest verdict: clearly worth it, but not for the reason the scoring
suggests.** The single highest-value moment was not a finding at all — it was
`deliberate_coding` talking the agent out of an automatic destructive build step
before a line of it existed. The "critical" finding in the audit was, on
investigation, wrong about its own mechanism. The most valuable *finding* was
rated "major" and was a one-line truthiness bug.

---

## 2. What was invoked, in order

| # | Tool | Result | Credits | Notes |
| --- | --- | --- | ---: | --- |
| 1 | `deliberate_coding` | `in_progress` | — | Proactive, before any code existed |
| 2–4 | `deliberate_coding` (continuation) | verdict on 4th | 4.3 | 3 polls |
| 5 | `record_gate_skip` | **rejected** | free | `gate_skip_reason_not_valid_at_gate` |
| 6 | `record_outcome` | ok | free | `notes_truncated: true` |
| 7 | `audit_coding` | **rejected** | 0 | `empty_gate_diff` — caller error, no charge |
| 8 | `audit_coding` | `in_progress` | — | Retried with the parameter correctly set |
| 9–11 | `audit_coding` (continuation) | verdict on 4th | 3.9 | 3 polls |
| 12 | `record_gate_skip` (`gc_ba4d…`) | ok | free | `reason_text` clipped at 500 chars |
| 13 | commit attempt | **gate re-fired** | — | New context `gc_79494d…` on the new bytes |
| 14 | `record_gate_skip` (`gc_79494d…`) | ok | free | Commit then succeeded |
| 15 | `record_outcome` | ok | free | `notes_truncated: true` |

Both commit-gate firings were triggered by `git commit`. No write gate fired
during the session, despite ~20 file writes.

---

## 3. Call one — `deliberate_coding`, before any code existed

**Request id:** `mcp_090e7aad0f394b0ab6cbdecec618d42a`
**Invoked because:** the user's global `CLAUDE.md` mandates calling it before
settling a consequential design decision, explicitly including decisions the
agent makes for itself rather than only ones put to a human.

Four decisions were posed together, each with the options already enumerated:

1. Centralise the responsive width ladders — should the `sizes` attribute move
   into the config too, or stay at the call site next to the CSS it mirrors?
2. Should a postbuild step **delete** the 20.7 MB of full-size originals Astro
   emits and never references (29% of `dist/`), based on a reference scan?
3. How to measure per-screen image cost without adding a browser dependency —
   analytical projection, runtime probe, or both?
4. Should the tool that caps master resolution be *applied* to an
   already-committed 6000×4000 master?

**Response:** `action: proceed`, `recommendation: clear`, `findings: []`,
`agreement_score: 0`, flags `["positive_assessment_low_agreement",
"verdict_repaired"]`. Models: `gpt-5.6-luna`, `claude-sonnet-5`,
`gemini-3.7-flash`, `grok-4-1-fast-non-reasoning`.

### What it changed

| Decision | Agent's plan going in | Panel | Applied? |
| --- | --- | --- | --- |
| 1 · `sizes` placement | Centralise everything | Keep `sizes` at the call site (3 of 4 models; Gemini dissented) | **Changed** |
| 2 · Prune dead assets | Auto-delete in `postbuild`, with an opt-out | **Do not delete.** Report only; deletion is a manual opt-in | **Changed** |
| 3 · Measurement | Build both, caveat the projection | Confirmed; rename it away from "load time" | Confirmed |
| 4 · Downscale master | Write the tool *and* apply it | Write it, do **not** apply it | **Changed** |

**Decision 2 is the whole return on this call.** The agent was about to wire an
automatic, destructive step into every build — local, PR preview and deploy. The
panel's argument was asymmetry, and it is correct: the benefit is 20.7 MB of
inert bytes on a host where static asset requests are free, unmetered and
uncapped; the failure mode is a silent 404 on a deployed image, discovered by a
visitor rather than by CI. It also correctly noted that the proposed safety
mechanisms (verification pass, shape assertions, allowlist) change how *loud* the
failure is without making it *correct*.

**Decision 4 mattered too**, in a way a code reviewer would not have caught: it
noticed that downscaling an already-committed file reclaims nothing, because Git
history already holds every prior version, and that the plan contradicted the
user's stated intent to move to higher-resolution masters. That is a reading of
*context*, not of code.

### Observations for the team

- **`agreement_score: 0` alongside `action: proceed` and `recommendation:
  clear` reads as a contradiction.** The flag `positive_assessment_low_agreement`
  plus `verdict_repaired` suggests the pipeline knows this is odd and patched
  something. As a consumer, I could not tell whether score 0 meant "the models
  disagreed violently" or "agreement was not computed for this shape of call".
  The prose showed clear 3-1 and 2-0 splits per decision, so 0 appears to be a
  computation artefact rather than a signal. It undermines confidence in the
  numeric fields.
- **The response was truncated**: `*This response reached the length limit.*` It
  had begun emitting complete, ready-to-run files and was cut mid-token
  (`scripts/audit-astro-assets.mjs` stopped at `const`). All four decisions were
  fully answered first, so nothing load-bearing was lost — but a caller who
  needed that appendix would have to pay for a follow-up. Consider truncating the
  *appendix* explicitly rather than the stream, or signalling which sections
  survived.
- **A four-part question worked well.** Batching related decisions into one call
  cost 4.3 credits instead of four separate calls, and the panel handled the
  cross-dependencies (D4's cap depends on D1's top rung) coherently.

---

## 4. The gate-binding gap — the sharpest product friction found

When the first `git commit` fired the commit gate, the agent tried the sanctioned
shortcut: it had already run one panel review and applied its findings, so it
called `record_gate_skip(recommendations_applied)`.

**Rejected:**

```
[gate_skip_reason_not_valid_at_gate] 'recommendations_applied' needs a real
review to have run first — no recent audit_coding / deliberate_coding /
synthesize_coding receipt was found for this repo.
```

The cause is structural. `deliberate_coding` had been invoked **proactively,
before any code existed**, exactly as `CLAUDE.md` instructs. At that moment no
gate had fired, so there was no `gate_context_id` and no `gate_repo` to pass —
and without `gate_repo`, the review left no receipt bound to the repository. The
review that shaped the entire design earned no credit at the gate.

This is a direct conflict between two pieces of the product's own guidance:

> "Invoke them **proactively** — the most consequential choices … are made in
> discussion and documents *before any code exists*. That's the window."

> "'recommendations_applied' needs a real review to have run first — no recent
> … receipt was found for this repo."

The pre-code window the product asks you to use is the one window that produces
no receipt.

**Suggested fix, cheapest first:**
1. Accept `gate_repo` as an optional argument on proactive `deliberate_coding` /
   `synthesize_coding` calls, and mint a repo-bound receipt when it is supplied.
2. Failing that, have the tool description for `deliberate_coding` tell callers
   to pass `gate_repo` proactively so a later gate can find the receipt. Today
   nothing suggests it, because `gate_repo` reads as gate-response plumbing.
3. Have the rejection message say *why* no receipt was found ("a review ran but
   was not bound to a repo — pass `gate_repo` next time"), rather than implying
   no review happened. The agent had to reason its way to the cause.

Net cost of this gap in this session: one wasted call, and a full
`audit_coding` (3.9 credits, ~5 minutes) that the product's own single-review
model says should not have been necessary.

---

## 5. Call two — `audit_coding` on the finished diff

**Request id:** `mcp_f76a0176e5794bc49233dd33ed707ff1`
**Verdict:** `request_changes`; `action: escalate_to_human`, derived, because
`"assessment was 'request_changes', but a critical finding forces
escalate_to_human"`. `agreement_score: 0.82`. Gate **not** released.

### A methodology note that probably explains two wrong findings

The real diff was 66 KB / 1,652 lines. `CLAUDE.md` says to pass the real text and
"if it's long, chunk by section", but the gate wants one `gate_diff` representing
the change. There is no documented way to reconcile those, so the agent passed a
**faithfully abridged** diff: complete for the flagged files, elided (with `/* … */`
markers) inside the long scripts.

Two of the nine findings appear to be artefacts of exactly what got elided. This
is worth the team's attention: **diff fidelity is currently the caller's
judgement call, and it silently changes finding quality.** A documented chunking
protocol — or an accepted `gate_diff_ref` pointing at a file — would remove the
guesswork.

### Finding-by-finding, with verified outcomes

| ID | Sev | Claim | Verified verdict | Action |
| --- | --- | --- | --- | --- |
| F-001 | critical | `--prune` deletes assets referenced only from the viewer's JSON island | **Mechanism wrong.** The island is inline in the `.html` the scan already reads; `.json` and `.css` were already in the scan set. Disproved empirically. Underlying concern (untested unlink path) fair | Hardened + tested |
| F-002 | major | Ladder config is grepped out of `.ts` source; brittle | **Correct, and already proven** — it broke mid-session when `quality: 82` became `quality: QUALITY` | Replaced with a shared `.mjs` both sides import |
| F-003 | major | HTML scanner silently omits images | **Partially correct.** Named failures aren't live (Astro emits single-line quoted tags), but silent omission is a real class | Added count + truncation guard |
| F-004 | major | `ladderAttrs` spread-first can be silently overridden | **Correct in principle, not live.** No call site overrode anything | Spread moved last |
| F-005 | major | `PUBLIC_IMAGE_PERF` is a string; `"0"`/`"false"` are truthy | **Correct, and a live bug that would have shipped** | Explicit on-value set |
| F-006 | major | Astro hoists component `<script>` even when unrendered | **Wrong for this setup.** Production build was already verified to contain zero probe markers; the script was tree-shaken | None needed |
| F-007 | minor | `sizes` evaluator silently approximates unsupported syntax | **Correct on one narrow case** — `vh` returned its raw number; everything else already threw | `vh` now throws |
| F-008 | minor | Probe absence verified only by manual grep | **Correct and valuable** | Automated postbuild assertion, both states |
| F-009 | pref | Warn threshold should be env-configurable | Declined — no need on a one-developer repo | None |

### The one that earned its keep

**F-005.** The code was:

```js
const showImageProbe = import.meta.env.DEV || Boolean(import.meta.env.PUBLIC_IMAGE_PERF);
```

Vite env vars arrive as strings. `Boolean("0")` and `Boolean("false")` are both
`true`, so anyone setting the flag to an off-looking value would have shipped a
debug HUD and console instrumentation into production. Verified after the fix:
`PUBLIC_IMAGE_PERF=0` and `=false` now both produce clean builds, `=1` ships the
probe and says so. A postbuild assertion (F-008) now fails the build if it ever
leaks again.

This is a genuine save. It is also, in fairness, a one-line bug that a type-aware
lint rule would catch for a fraction of 3.9 credits.

### The one that cost time

**F-001, rated critical**, is what pushed `action` to `escalate_to_human` and
kept the gate shut. Its stated mechanism was wrong, and disproving it took a
direct experiment:

```
viewer-only rung: toronto-skyline.CTLf_cIa_Z1PWUwk.webp
appears in raw HTML text? true
```

The scan reads all `.html`, `.js`, `.css`, `.json`, `.svg`, `.txt`, `.xml` and
`.webmanifest` in `dist/`; the JSON island is inline in an `.html` file. An
earlier independent shell scan had already classified 153 files as referenced,
including viewer-only rungs, and 31 as orphans.

**But the finding still produced the right outcome.** The agent had written an
`unlink` path and never executed it. Prompted by the finding, it was gated behind
a second `--confirm` flag, restricted to regular files inside `dist/_astro/` with
a content hash in the name, and then actually tested against a throwaway copy
seeded with a symlink, an unhashed file and an island-only asset. All three
survived; the 31 real orphans went.

So: **wrong diagnosis, right instinct, good outcome, ~5 minutes of verification
tax.** A reviewer who cannot execute the code is entitled to be suspicious of an
untested `unlink`. But rating it *critical* on a mechanism that the supplied diff
did not support is expensive — it is the rating that blocks the gate.

### Disagreement reporting worked well

`dimensions_of_disagreement` was genuinely useful and is an underrated feature:

- Gemini argued `ladderAttrs` should optionally supply a canonical `sizes`;
  consensus said `sizes` belongs at the call site. Flagged `medium`.
- Grok thought a well-tested regex sufficed for the HTML scanner; consensus
  wanted a state machine. Flagged `low`.

Both were real, both were surfaced with the dissenting model named, and the
severity ratings were fair. This is more decision-useful than the aggregate
score.

---

## 6. Gate mechanics observed

**Firing 1 — `gc_ba4d19f4b85b4005ab963e21ae793ae4`** (2 hunks):
- `dependency` — matched `package.json`. **False positive.** Only `scripts` keys
  were added; no dependency was added, changed or removed. The classifier appears
  to match the filename rather than the changed region.
- `significance` — matched `export function ladderAttrs`. Fair.

**Firing 2 — `gc_79494d4a26be44419722d1488c733c81`** (6 hunks, 1 already covered):
- `sql_risk` — matched the word **`truncate`** in a prose comment reading
  *"a bare `process.exit()` after `console.log` truncates the payload when stdout
  is a pipe"*. **False positive.** This repository has no database, no SQL, no
  ORM and no network calls; it is a static site generator.
- `env_access` — matched `process.env.` in the new probe-leak assertion. Fair
  signal, low value: reading `process.env.PUBLIC_IMAGE_PERF` in a build script.
- `significance` ×2, `dependency` ×1 — as before.

**The re-fire cycle is correctly documented and behaved as promised.** Applying
findings changed the bytes, so the retry fired a new context and needed a second
free `record_gate_skip`. The release message predicts this explicitly, which
saved confusion. Worth noting only as a cost: **an audit-then-fix cycle needs a
minimum of two skip calls**, and the flagged hunks on the second pass are, by
construction, *the fixes themselves*.

**`reason_text` is clipped at 500 characters.** Both skips were clipped. The tool
correctly says this does not affect the release — but if `reason_text` is the
audit trail a human later reads, clipping it at 500 chars removes exactly the
substance that justifies the skip. Either raise the cap or say plainly that it is
a label, not a record.

---

## 7. Cost, time, and what it bought

### Cost

- **8.2 credits.** Roughly half on a pre-code design deliberation, half on a
  post-hoc code audit.
- **157,678 panel tokens** billed. On top of that, the caller spent an estimated
  40,000-50,000 tokens of its own context reading the 66 KB diff and reproducing
  it as `gate_diff` — a real cost that appears in no usage field. (Estimated from
  the read sizes, not instrumented.)
- **~10 of ~40 minutes**, about a quarter of the session: ~4 min for the
  deliberation, ~6 min for the audit, plus time verifying two findings that
  turned out to be wrong — partly overlapping the poll waits, so not additive.

### Value

| What it bought | Would it have shipped otherwise? |
| --- | --- |
| Stopped an automatic destructive postbuild step | **Yes** — it was designed and about to be written |
| Caught the string-truthiness probe leak (F-005) | **Yes** — verified live |
| Stopped a lossy re-encode of a committed master | **Yes** — the design doc explicitly called for it |
| Forced removal of a source-text parser (F-002) | Probably not — it had already broken once and was on borrowed time |
| Spread-order hardening, `vh` strictness, automated leak assertion | No — preventive |

Three of those are things that would have reached `mainline`. For a 40-minute
session on a personal site, 8.2 credits to prevent an automatic delete step and a
production debug leak is a good trade, and the agent said so in both
`record_outcome` calls (`changed_decision: true` on each).

### Where the value actually concentrated

**The pre-code `deliberate_coding` call was worth more than the post-hoc
`audit_coding` call**, despite costing slightly more. It changed the shape of the
work. The audit found one live bug and several worthwhile hardenings, but also
produced the two wrong findings and the blocked gate. If a budget forced a
choice, the deliberation is the one to keep — which is consistent with the
product's own positioning, and makes the gate-binding gap in §4 more costly than
it first appears, since it is precisely the high-value call that earns no
receipt.

---

## 8. What worked well, credited plainly

- **The empty-`gate_diff` rejection charged nothing** and said exactly what was
  wrong. A caller mistake (a malformed parameter tag) cost zero credits.
- **The continuation-token protocol was reliable** — six polls, no lost work, no
  ambiguity about whether to re-invoke.
- **Findings were well-structured**: stable ids, severity, category, and a
  one-line summary that could be triaged without reading the prose.
- **The prose critique was specific and actionable**, with concrete code, not
  generic advice. The F-001 hardening checklist was directly implementable even
  though its premise was wrong.
- **Gate messages are unusually good.** They enumerate every release path, name
  which bucket each one clears, warn that clearing the wrong bucket will not move
  the count, and predict the re-fire. That is careful product writing.
- **`record_outcome` is free and frictionless**, which is the right call if you
  want honest telemetry.

## 9. Suggestions, ranked by expected value

1. **Bind proactive reviews to a repo** (§4). Accept `gate_repo` on
   pre-code `deliberate_coding`, or document that callers should pass it. This is
   the highest-value fix: it makes the product's own recommended workflow count.
2. **Document a large-diff protocol** (§5). Callers are currently guessing, and
   the guess measurably degrades findings. A `gate_diff` file reference, or an
   explicit chunking contract with a stable context id across chunks.
3. **Add language/context awareness to keyword risk classes.** `sql_risk` on the
   word "truncate" in a comment, and `dependency` on any `package.json` touch,
   train callers to skim gate output. Both were false in the same session.
4. **Reconcile `agreement_score` with the verdict fields** (§3), or document what
   `0` means when the action is `proceed` and the flag is `verdict_repaired`.
5. **Reconsider what "critical" means when the reviewer cannot execute the
   code.** F-001's *severity* was right about a risk class (untested destructive
   path) and wrong about a mechanism. A severity that blocks a gate should
   probably require the mechanism to be supported by the supplied diff — or the
   finding should be phrased as "unverified destructive path" rather than a
   specific data-loss claim that turns out to be false.
6. **Raise or reclassify the 500-char `reason_text` cap** (§6).

---

## 10. One-paragraph version

Two panel calls, 8.2 credits, ~9 minutes of a 40-minute session. The pre-code
deliberation changed three design decisions, the most important being talking the
agent out of an automatic destructive build step it was about to write; the
post-hoc audit caught one live bug that would have shipped a debug overlay to
production, forced three worthwhile hardenings, and produced two findings that
were factually wrong for this codebase — one of them rated critical, which is
what blocked the gate and cost about five minutes to disprove. The product's
sharpest friction is that its own headline advice — review before the code exists
— produces a review that the gate will not accept as a review, because a pre-code
call has no repo to bind to. Worth the credits; worth fixing that.
