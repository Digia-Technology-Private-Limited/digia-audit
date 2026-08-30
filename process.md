# Pulse process log

This file records the user-visible work performed in this repository. It is
intended to make later review easier without storing credentials or pretending
to capture telemetry that is not available to the coding agent.

## Capture limits

- Recorded: user requests, implementation decisions, files changed, commands
  run, deployment identifiers, and verification results.
- Not available: hidden system or developer prompts, model internals, token
  accounting, browser history, account email, and platform-level telemetry.
- Secrets are intentionally omitted. Environment variable names may be
  recorded, but values and tokens are not.
- Future work should append a dated entry instead of rewriting prior entries.

## 2026-08-30

### Request 1 — Generate Fix feedback

The user reported that Generate Fix appeared unchanged for about fifteen
seconds and asked for an immediate disabled button labeled Generating.

Actions:

- Added local loading state to the audit opportunity list.
- Added local loading state to the opportunity detail view.
- Added disabled-button styling and ongoing generation status text.
- Preserved the existing Convex generation flow.

Files:

- components/AuditProgress.tsx
- components/OpportunityDetail.tsx
- app/globals.css

Verification: npm run build passed.

### Request 2 — Priority score clarity

The user reported that a bare priority score such as 3402 was not meaningful
or checkable.

Actions:

- Displayed the score out of its maximum of 10,000.
- Displayed the calculation inputs: impact × confidence × frequency × trend.
- Added the maximum to the ranked opportunity list.

Files:

- components/OpportunityDetail.tsx
- components/AuditProgress.tsx
- app/globals.css

Verification: npm run build passed.

### Request 3 — Small product fixes

The user asked to remove raw review IDs, add a Run another audit path, disclose
that audit links are currently public, and keep the audit principle visible on
phones.

Actions:

- Removed source review IDs from rendered review cards.
- Added Run another audit to completed audit pages.
- Added the no-sign-in/link-access disclosure on the home page.
- Changed the mobile principle card from hidden to a normal-flow card.

Files:

- components/AuditProgress.tsx
- components/OpportunityDetail.tsx
- app/page.tsx
- app/globals.css

Verification: npm run build passed.

### Request 4 — Push, local run, and Vercel deploy

The user asked to push the code, run it locally, and deploy it on Vercel.

Actions:

- Pushed commit 2341fe1 to the original GitHub repository.
- Started the local Next.js server at http://localhost:3000.
- The direct Vercel CLI deploy reported Not authorized.
- The connected GitHub integration deployed the pushed commit successfully.

Verification:

- Local HTTP response: 200.
- Vercel production deployment: Ready.

### Request 5 — Pulse rebrand

The user provided the source-of-truth brand decision: Pulse, by Digia, with
the tagline Know what to act on next.

Actions:

- Renamed visible product branding to Pulse.
- Added subtle by Digia attribution on the home page.
- Updated SEO and OpenGraph metadata to Pulse | Digia.
- Updated package metadata to digia-pulse.
- Added a branded README.
- Renamed the existing GitHub repository in place to digia-pulse.
- Renamed the existing Vercel project in place to digia-pulse.
- Updated the local Git origin and verified fetch.
- Attached pulse.digia.tech to the existing Vercel project.
- Preserved audit terminology, Convex deployment identity, schema, IDs, and
  historical data.

Infrastructure identifiers preserved:

- Convex deployment: strong-grouse-685
- Vercel project ID: prj_9G9jLlLTFOBPF7WRfOGMkKbDNRI5

Verification:

- Old product-brand scan: clean outside Git history.
- npm run build: passed.
- Existing audit read through Convex: passed.
- Existing audit route locally and on Vercel: HTTP 200.
- GitHub rename, fetch, and push: passed.
- Vercel project and production deployment: Ready.
- pulse.digia.tech: attached but not live; AWS DNS still needs the Vercel
  record CNAME pulse → 37d17837f7383430.vercel-dns-017.com.

Commit:

- 990ed19 chore: rebrand Digia Audit to Pulse

### Request 6 — Codex CLI account

The user asked which email to use for Codex CLI.

Response:

- Codex CLI login should use the email associated with the user’s
  ChatGPT/OpenAI account through codex login.
- The repository Git email is anupam.singh@digia.tech and is separate from
  Codex authentication.

### Request 7 — This process log

The user asked for process.md to log prompts and other telemetry for later
auditing.

Action:

- Created this file.
- Logged user-visible requests, decisions, tools at a high level, identifiers,
  files, and verification results.
- Did not record hidden prompts, secrets, or unavailable platform telemetry.

### Request 8 — Last-30-days Google Play review scraping

The user requested that new audits collect newest-first Google Play reviews from
the previous 30 days, stop at the first confirmed cutoff/source exhaustion or
10,000 unique reviews, persist window and coverage metadata, and pass only
in-window reviews to analysis.

Inspection findings from before the current pagination implementation:

- The old scraper request used `num: 500` and `paginate: false`; those settings
  are no longer in the active collection path.
- Review records are normalized and deduplicated by sourceReviewId, with a
  derived fallback ID.
- Review publication dates come from the scraper's raw date field and are
  stored as reviewDate strings.
- No repository test suite was found.

Decision:

- Implementation paused before source changes because a 10,000-review
  collection ceiling can exceed the current single-model-request context.
- The task specification explicitly requires stopping and reporting this
  constraint before redesigning the AI pipeline.
- No scraper, schema, analysis, UI, or database changes were made in this
  request.

Implementation after approval:

- Added a fixed 30-day window based on the audit start time, with inclusive
  start and end boundaries.
- Added newest-first continuation-token pagination through google-play-scraper.
- Added MAX_REVIEWS_PER_AUDIT = 10000, enforced after source-ID
  deduplication.
- Persisted window dates, window type/days, fetched/in-window/analyzed
  counters, oldest/newest fetched dates, coverage status, and stop reason.
- Stored only in-window reviews in the audit observations used by analysis.
- Added a conservative partial-collection path for pagination failures and
  timeouts.
- Added bounded Researcher batching at 60,000 serialized characters with at
  most four concurrent requests, preserving the existing Researcher and
  Analyst stages.
- Added completed-audit UI text for the 30-day period, analyzed count, zero
  recent reviews, and partial coverage.
- Preserved historical audit records without a migration.

Verification:

- Convex code generation completed successfully.
- npm run build passed.
- Existing audit route returned HTTP 200 locally.
- Two live Google Play checks returned newest-first 150-review pages with
  continuation tokens: Google Translate and Spotify.
- No dedicated repository test suite exists.

### Review pagination verification — Spotify (2026-08-30)

- Pages requested: 67
- Raw reviews returned: 10,050
- Unique reviews fetched: 10,000
- Duplicates removed: 0
- Reviews inside the 30-day window: 10,000
- Reviews analyzed by the application: not run in this scraper-only smoke test
- Newest review date: 2026-08-29T14:22:48.805Z
- Oldest review reached: 2026-08-15T08:22:43.463Z
- 30-day cutoff reached: no (the 10,000 cap was reached first)
- 10,000 cap reached: yes
- Stop reason: `max_reviews_reached`
- Result: pagination continued beyond 500; no active 500-review collection limit
  was observed.

### Full audit verification — WhatsApp (2026-08-30)

- Pages fetched: 67
- Unique reviews fetched: 10,000
- Reviews in the 30-day window: 10,000
- Reviews analyzed: 7,824 usable reviews
- Newest review date: 2026-08-29T14:15:17.898Z
- Oldest review reached: 2026-08-25T22:53:42.219Z
- Stop reason: `max_reviews_reached`
- Coverage: partial, because this high-volume app reached the 10,000 safety
  ceiling before reaching the 30-day cutoff.
- Ranked opportunity evidence validation: 11 relationships, 11 reviews
  resolved, 0 missing/orphan references.
