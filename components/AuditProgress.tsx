"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

const stages = [
  ["validating", "Validating Play Store app"],
  ["collecting", "Collecting reviews"],
  ["normalizing", "Normalizing and deduplicating reviews"],
  ["filtering", "Filtering review quality"],
  ["researching", "Finding recurring problems"],
  ["consolidating", "Consolidating related problems"],
  ["diagnosing", "Diagnosing problem types"],
  ["ranking", "Ranking opportunities"],
  ["preparing", "Preparing the audit"],
] as const;

type ConfirmedNumber = number | undefined;

function useAnimatedNumber(target: ConfirmedNumber, duration = 500) {
  const safeTarget = target ?? 0;
  const [displayValue, setDisplayValue] = useState(safeTarget);
  const displayRef = useRef(safeTarget);
  const frameRef = useRef<number | null>(null);

  useEffect(() => {
    const from = displayRef.current;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    if (from === safeTarget) return;
    if (safeTarget < from || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      displayRef.current = safeTarget;
      setDisplayValue(safeTarget);
      return;
    }

    const startedAt = performance.now();
    const tick = (now: number) => {
      const progress = Math.min(1, (now - startedAt) / duration);
      const eased = 1 - Math.pow(1 - progress, 3);
      const nextValue = Math.min(safeTarget, Math.round(from + (safeTarget - from) * eased));
      displayRef.current = nextValue;
      setDisplayValue(nextValue);
      if (progress < 1) frameRef.current = requestAnimationFrame(tick);
    };
    frameRef.current = requestAnimationFrame(tick);
    return () => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    };
  }, [safeTarget, duration]);

  return displayValue;
}

function formatCount(value: ConfirmedNumber) {
  return (value ?? 0).toLocaleString();
}

function formatDate(value: string | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

export function AuditProgress({ auditId }: { auditId: string }) {
  const audit = useQuery(api.audits.get, { auditRunId: auditId as Id<"auditRuns"> });
  const reviews = useQuery(api.audits.listReviews, { auditRunId: auditId as Id<"auditRuns"> });
  const candidates = useQuery(api.audits.listCandidates, { auditRunId: auditId as Id<"auditRuns"> });
  const opportunities = useQuery(api.audits.listOpportunities, { auditRunId: auditId as Id<"auditRuns"> });
  const generateFix = useMutation(api.audits.generateFix);
  const retryAudit = useMutation(api.audits.retry);
  const [generatingOpportunityId, setGeneratingOpportunityId] = useState<Id<"opportunities"> | null>(null);
  const displayedFetched = useAnimatedNumber(audit?.reviewsFetched, 550);
  const displayedUnique = useAnimatedNumber(audit?.reviewsUnique);
  const displayedEligible = useAnimatedNumber(audit?.reviewsEligible ?? audit?.usableReviewCount);
  const displayedAnalyzed = useAnimatedNumber(audit?.reviewsAnalyzed);
  const displayedCandidates = useAnimatedNumber(audit?.problemCandidatesCount);

  const handleGenerateFix = async (opportunityId: Id<"opportunities">) => {
    setGeneratingOpportunityId(opportunityId);
    try {
      await generateFix({ opportunityId });
    } catch {
      setGeneratingOpportunityId(null);
    }
  };

  if (audit === undefined) {
    return <main className="audit-shell"><p className="audit-loading">Loading audit…</p></main>;
  }

  if (audit === null) {
    return <main className="audit-shell"><div className="audit-message"><p className="eyebrow">Audit unavailable</p><h1>This audit could not be found.</h1><p>Check the audit link and try again.</p></div></main>;
  }

  if (audit.scrapeStatus === "failed") {
    return <main className="audit-shell"><div className="audit-message"><p className="eyebrow">Could not collect reviews</p><h1>The Play Store reviews were not retrieved.</h1><p>{audit.scrapeError ?? "The source did not return usable review data."}</p><button className="retry-button" onClick={() => retryAudit({ auditRunId: audit._id })}>Retry audit</button></div></main>;
  }

  if (audit.analysisStatus === "failed") {
    return <main className="audit-shell"><div className="audit-message"><p className="eyebrow">Analysis failed</p><h1>The reviews were collected, but analysis did not finish.</h1><p>{audit.analysisError ?? "The analysis service returned an invalid result."}</p><button className="retry-button" onClick={() => retryAudit({ auditRunId: audit._id })}>Retry audit</button></div></main>;
  }

  const currentIndex = stages.findIndex(([key]) => key === audit.currentStage);
  const previewReviews = reviews?.slice(0, 20) ?? [];
  const topOpportunity = opportunities?.[0];
  const confirmedCandidates = candidates?.filter((candidate) => candidate.supportingSignalCount >= 10) ?? [];
  const unconfirmedCandidates = candidates?.filter((candidate) => candidate.supportingSignalCount < 10) ?? [];
  const reviewsAnalyzed = audit.reviewsAnalyzed ?? audit.usableReviewCount;
  const isPartialCoverage = audit.windowCoverageStatus === "partial";
  const collectionCount = displayedFetched.toLocaleString();
  const collectionDate = formatDate(audit.oldestReviewFetchedAt);
  const collectionSecondary = audit.status !== "complete" && audit.currentStage === "collecting"
    ? `${collectionCount} reviews fetched${collectionDate ? ` · reaching back to ${collectionDate}` : ""}`
    : audit.collectionStopReason === "window_reached" || audit.windowCoverageStatus === "complete"
      ? `${collectionCount} reviews fetched · 30-day window covered`
      : audit.collectionStopReason === "source_exhausted"
        ? `${collectionCount} reviews fetched · all available reviews collected`
        : audit.collectionStopReason === "max_reviews_reached"
          ? `${collectionCount} reviews fetched · collection limit reached`
          : `${collectionCount} reviews fetched · collection coverage is partial`;
  const stageSecondary: Record<(typeof stages)[number][0], string | null> = {
    validating: "Checking the Play Store source and audit window",
    collecting: audit.reviewsFetched || audit.status === "complete" ? collectionSecondary : "Waiting for the first stored review batch",
    normalizing: audit.reviewsUnique !== undefined ? `${formatCount(audit.reviewsFetched)} reviews → ${displayedUnique.toLocaleString()} unique` : null,
    filtering: audit.reviewsEligible !== undefined ? `${formatCount(audit.reviewsUnique)} unique → ${displayedEligible.toLocaleString()} eligible for analysis` : null,
    researching: audit.reviewsEligible !== undefined ? displayedAnalyzed > 0 && displayedAnalyzed < audit.reviewsEligible ? `Analyzing ${displayedAnalyzed.toLocaleString()} / ${formatCount(audit.reviewsEligible)} reviews` : `Analyzing ${formatCount(audit.reviewsEligible)} reviews` : null,
    consolidating: audit.problemCandidatesCount !== undefined ? `${displayedCandidates.toLocaleString()} problem candidates found` : null,
    diagnosing: audit.problemsCount !== undefined ? `${formatCount(audit.problemsCount)} problems being classified` : null,
    ranking: audit.opportunitiesCount !== undefined ? `${formatCount(audit.opportunitiesCount)} evidence-backed opportunities` : null,
    preparing: "Assembling findings, evidence and recommendations",
  };

  return (
    <main className="audit-shell">
      <section className="audit-panel" aria-labelledby="audit-title">
        <div className="eyebrow"><span className="eyebrow-mark" /> Pulse</div>
        <div className="audit-heading">
          <div>
            <p className="audit-kicker">{audit.status === "complete" ? "Audit ready" : "Audit in progress"}</p>
            <h1 id="audit-title">Turning reviews into a decision.</h1>
          </div>
          <span className="audit-status">{audit.status}</span>
        </div>
        <p className="audit-source">{audit.sourceUrl}</p>{audit.status === "complete" ? <Link className="new-audit-link" href="/">Run another audit</Link> : null}
        <ol className="stage-list" aria-label="Audit progress">
          {stages.map(([key, label], index) => {
            const state = audit.status === "complete" ? "done" : index < currentIndex ? "done" : index === currentIndex ? "active" : "waiting";
            return <li className={`stage stage-${state}`} key={key} aria-current={state === "active" ? "step" : undefined}><span className="stage-marker" aria-hidden="true" /><div className="stage-copy"><span>{label}</span>{stageSecondary[key] ? <small key={`${key}-${stageSecondary[key]}`} className="stage-secondary">{stageSecondary[key]}</small> : null}</div><span className="stage-state">{state === "active" ? "now" : state}</span></li>;
          })}
        </ol>
        {audit.scrapeStatus === "complete" || audit.scrapeStatus === "partial" ? <div className="review-summary"><strong>{audit.analysisWindowDays === 30 ? `Last 30 days · ${reviewsAnalyzed.toLocaleString()} reviews analyzed` : `${audit.reviewCount} reviews collected`}</strong><span>{audit.analysisWindowDays === 30 ? `${(audit.reviewsFetched ?? audit.reviewCount).toLocaleString()} fetched · ${(audit.reviewsInWindow ?? audit.reviewCount).toLocaleString()} in window · ${isPartialCoverage ? "Partial coverage" : "Complete coverage"}` : `${audit.usableReviewCount} usable`} · {audit.skippedReviewCount ?? 0} malformed · {audit.lowQualityReviewCount ?? 0} low quality</span>{isPartialCoverage ? <p>Collection stopped before the full 30-day window was covered.</p> : null}{audit.scrapeWarning ? <p>{audit.scrapeWarning}</p> : null}{audit.analysisWindowDays === 30 && audit.reviewsInWindow === 0 ? <p>No reviews found in the last 30 days. Try again later or analyze a different app.</p> : audit.reviewCount === 0 ? <p>No reviews were found for this app. No recurring problems can be identified.</p> : audit.usableReviewCount === 0 ? <p>No usable reviews were found. No recurring problems can be identified.</p> : null}</div> : <p className="audit-note">The scraper is contacting Google Play. No review data is shown until it is actually retrieved.</p>}
        {audit.status === "complete" && opportunities === undefined ? <p className="outcome-loading">Preparing the audit outcome…</p> : null}
        {topOpportunity ? <div className="top-outcome"><p className="audit-kicker">#1 problem to act on next</p><h2>{topOpportunity.problemStatement}</h2><p>{topOpportunity.issueType} · {topOpportunity.digiaAddressable ? "Digia addressable" : `Owner: ${topOpportunity.recommendedOwner}`} · {topOpportunity.evidenceCount} supporting reviews · {topOpportunity.coveragePercent}% of usable reviews</p><Link className="outcome-link" href={`/audits/${auditId}/opportunities/${topOpportunity._id}`}>Inspect evidence and recommendation →</Link></div> : audit.analysisStatus === "complete" ? <div className="top-outcome top-outcome-empty"><p className="audit-kicker">No actionable theme found</p><h2>No theme met the 10-review evidence bar.</h2><p>Smaller signals are shown below as unconfirmed and are not ranked as decisions.</p></div> : null}
        {confirmedCandidates.length > 0 ? <div className="candidate-list"><h2>Grounded problem candidates</h2>{confirmedCandidates.map((candidate) => <article className="candidate-card" key={candidate._id}><div><strong>{candidate.problemStatement}</strong><span>{Math.round(candidate.confidence * 100)}% confidence</span></div><p>{candidate.category} · {candidate.supportingSignalCount} supporting reviews</p></article>)}</div> : null}
        {unconfirmedCandidates.length > 0 ? <div className="candidate-list candidate-unconfirmed"><h2>Unconfirmed signals — not ranked</h2>{unconfirmedCandidates.map((candidate) => <article className="candidate-card" key={candidate._id}><div><strong>{candidate.problemStatement}</strong><span>{Math.round(candidate.confidence * 100)}% confidence</span></div><p>{candidate.category} · {candidate.supportingSignalCount} supporting review{candidate.supportingSignalCount === 1 ? "" : "s"} · needs 10 to become actionable</p></article>)}</div> : null}
        {opportunities && opportunities.length > 0 ? <div className="opportunity-list"><h2>Ranked opportunities</h2>{opportunities.map((opportunity, index) => <article className="opportunity-card" key={opportunity._id}><div className="opportunity-rank">#{index + 1}</div><div className="opportunity-main"><Link className="opportunity-link" href={`/audits/${auditId}/opportunities/${opportunity._id}`}><strong>{opportunity.problemStatement}</strong></Link><p>{opportunity.issueType} · {opportunity.digiaAddressable ? "Digia addressable" : `Owner: ${opportunity.recommendedOwner}`}</p><span>{opportunity.priorityScore} / 10,000 priority · {opportunity.evidenceCount} supporting reviews · {opportunity.coveragePercent}% of usable reviews</span>{opportunity.digiaAddressable && opportunity.evidenceCount >= 10 && !opportunity.intervention ? <button className="fix-button" disabled={generatingOpportunityId === opportunity._id} aria-live="polite" onClick={() => handleGenerateFix(opportunity._id)}>{generatingOpportunityId === opportunity._id ? "Generating" : "Generate Fix"}</button> : null}{opportunity.intervention?.generationStatus === "running" ? <span>Generating recommendation…</span> : null}{opportunity.intervention?.generationStatus === "failed" ? <span className="fix-error">Fix generation failed: {opportunity.intervention.errorMessage}</span> : null}{opportunity.intervention?.generationStatus === "complete" ? <div className="fix-result"><strong>Recommended {opportunity.intervention.experienceType}</strong><span>Audience: {opportunity.intervention.audience}</span><span>Trigger: {opportunity.intervention.trigger}</span><span>Copy: {opportunity.intervention.suggestedCopy}</span><span>Success metric: {opportunity.intervention.successMetric}</span></div> : null}</div></article>)}</div> : null}
        {previewReviews.length > 0 ? <div className="review-list"><h2>Source review preview</h2>{previewReviews.map((review) => <article className="review-card" key={review._id}><div><span>{review.rating}/5</span><time>{review.reviewDate ?? "Date unavailable"}</time></div><p>{review.originalText.replace(/[\w.+-]+@[\w-]+\.[\w.-]+/g, "[email redacted]").replace(/(?:\+?\d[\d\s().-]{7,}\d)/g, "[phone redacted]")}</p></article>)}{(audit.reviewsInWindow ?? audit.reviewCount) > previewReviews.length ? <p className="audit-note">Showing a preview of {previewReviews.length} source reviews. Open an opportunity to inspect its complete evidence.</p> : null}</div> : null}
      </section>
    </main>
  );
}
