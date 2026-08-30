# Animated, Incremental Audit Progress Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing Pulse audit screen visibly progress through the nine real pipeline stages using persisted Convex state and bounded presentation-only animation.

**Architecture:** Persist collection counters after each stored review batch and persist analysis counters at review-batch boundaries and stage transitions. Extend the existing audit run record with optional pipeline counters, then derive every row’s secondary copy from that record. The client interpolates only between the last rendered value and the newest confirmed value, with reduced-motion and failure handling.

**Tech Stack:** Next.js, React, Convex, TypeScript, CSS animations.

**Spec:** User-provided “Pulse — Animated, Incremental Audit Progress” requirements.

## Global Constraints

- `MAX_REVIEWS_PER_AUDIT = 10000` remains unchanged.
- Backend state is authoritative; no timers, random values, fake percentages, or fabricated pipeline counts.
- Preserve the existing Pulse typography, spacing, green accent, rows, and `DONE / NOW / WAITING` model.
- Keep `reviewsFetched`, `reviewsUnique`, `reviewsInWindow`, `reviewsEligible`, and `reviewsAnalyzed` distinct.
- Do not change opportunity ranking, evidence relationships, auth, connectors, analysis window, or completed-audit redesign.

### Task 1: Persist collection and analysis progress

**Files:**
- Modify: `convex/schema.ts`
- Modify: `convex/audits.ts`
- Modify: `convex/scraper.ts`
- Modify: `convex/researcher.ts`
- Modify: `convex/analyst.ts`

**Interfaces:**
- Add optional audit counters: `reviewsUnique`, `reviewsEligible`, `problemCandidatesCount`, `problemsCount`, `opportunitiesCount`.
- Add internal mutations `updateScrapeProgress` and `updateResearchProgress` with confirmed values only.
- Keep `saveScrapeResult` as the final collection/filtering transition and set `reviewsAnalyzed` to zero until researcher batches complete.

- [ ] Add the optional counters to the existing `auditRuns` table and initialize them to zero for new and retried audits.
- [ ] After each 500-review storage batch, patch the audit with current fetched, unique, in-window, page, raw, duplicate, and date values while keeping `currentStage: "collecting"`.
- [ ] Persist a real `normalizing` transition after collection and before stored normalized records are finalized; then persist filtering totals and schedule research.
- [ ] Update `reviewsAnalyzed` after each completed researcher batch, and persist the actual candidate count when research finishes.
- [ ] Make analyst transitions explicit: consolidating while candidate input is assembled, diagnosing during model diagnosis, ranking before final opportunity persistence, and preparing after the final result is stored.
- [ ] Run `npx tsc --noEmit` and Convex code generation/type validation.

### Task 2: Animate the existing progress rows

**Files:**
- Modify: `components/AuditProgress.tsx`
- Modify: `app/globals.css`

**Interfaces:**
- `AuditProgress` consumes the reactive `auditRuns` counters and derives stage copy without local fake progress.
- Add a local `useAnimatedNumber(target)` hook and use it only for confirmed numeric targets.

- [ ] Render all nine rows with uppercase `DONE`, `NOW`, and `WAITING` states, including a stable active marker and completion transition.
- [ ] Derive real secondary text for collecting, normalizing, filtering, research, consolidation, diagnosis, ranking, and preparing.
- [ ] Show collection stop/coverage context only from persisted coverage and stop-reason fields.
- [ ] Add subtle active pulse, completion transition, secondary-copy fade, mobile active-row visibility, and reduced-motion CSS.
- [ ] Ensure failed audits show a failed message and never continue counter animation.
- [ ] Run the app build and typecheck.

### Task 3: Verify and deliver

**Files:**
- No source changes expected unless verification finds a defect.

- [ ] Inspect status and complete diff for secrets/debug output.
- [ ] Run available tests, typecheck, production build, and `git diff --check`.
- [ ] Run one real high-volume audit and record persisted batch timeline and final transformation counts.
- [ ] Attempt desktop/mobile/browser validation; record any unavailable browser capability honestly.
- [ ] Commit `feat: animate live audit pipeline progress` and push to `origin/main` without force-pushing.
