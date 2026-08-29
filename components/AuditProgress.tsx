"use client";

import { useMutation, useQuery } from "convex/react";
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

export function AuditProgress({ auditId }: { auditId: string }) {
  const audit = useQuery(api.audits.get, { auditRunId: auditId as Id<"auditRuns"> });
  const reviews = useQuery(api.audits.listReviews, { auditRunId: auditId as Id<"auditRuns"> });
  const candidates = useQuery(api.audits.listCandidates, { auditRunId: auditId as Id<"auditRuns"> });
  const opportunities = useQuery(api.audits.listOpportunities, { auditRunId: auditId as Id<"auditRuns"> });
  const generateFix = useMutation(api.audits.generateFix);
  const retryAudit = useMutation(api.audits.retry);

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

  return (
    <main className="audit-shell">
      <section className="audit-panel" aria-labelledby="audit-title">
        <div className="eyebrow"><span className="eyebrow-mark" /> Digia Audit</div>
        <div className="audit-heading">
          <div>
            <p className="audit-kicker">Audit in progress</p>
            <h1 id="audit-title">Turning reviews into a decision.</h1>
          </div>
          <span className="audit-status">{audit.status}</span>
        </div>
        <p className="audit-source">{audit.sourceUrl}</p>
        <ol className="stage-list" aria-label="Audit progress">
          {stages.map(([key, label], index) => {
            const state = index < currentIndex ? "done" : index === currentIndex ? "active" : "waiting";
            return <li className={`stage stage-${state}`} key={key}><span className="stage-marker" />{label}<span className="stage-state">{state === "active" ? "now" : state}</span></li>;
          })}
        </ol>
        {audit.scrapeStatus === "complete" || audit.scrapeStatus === "partial" ? <div className="review-summary"><strong>{audit.reviewCount} reviews collected</strong><span>{audit.usableReviewCount} usable · {audit.skippedReviewCount ?? 0} malformed · {audit.lowQualityReviewCount ?? 0} low quality</span>{audit.scrapeWarning ? <p>{audit.scrapeWarning}</p> : null}{audit.reviewCount === 0 ? <p>No reviews were found for this app. No recurring problems can be identified.</p> : audit.usableReviewCount === 0 ? <p>No usable reviews were found. No recurring problems can be identified.</p> : null}</div> : <p className="audit-note">The scraper is contacting Google Play. No review data is shown until it is actually retrieved.</p>}
        {reviews && reviews.length > 0 ? <div className="review-list"><h2>Source reviews</h2>{reviews.map((review) => <article className="review-card" key={review._id}><div><span>{review.rating}/5</span><time>{review.reviewDate ?? "Date unavailable"}</time></div><p>{review.originalText}</p><small>{review.sourceReviewId}</small></article>)}</div> : null}
        {candidates && candidates.length > 0 ? <div className="candidate-list"><h2>Grounded problem candidates</h2>{candidates.map((candidate) => <article className="candidate-card" key={candidate._id}><div><strong>{candidate.problemStatement}</strong><span>{Math.round(candidate.confidence * 100)}% confidence</span></div><p>{candidate.category} · {candidate.supportingSignalCount} supporting review{candidate.supportingSignalCount === 1 ? "" : "s"}</p></article>)}</div> : candidates && audit.analysisStatus === "complete" ? <p className="audit-note">No recurring problems found in the usable reviews.</p> : null}
        {opportunities && opportunities.length > 0 ? <div className="opportunity-list"><h2>Ranked opportunities</h2>{opportunities.map((opportunity, index) => <article className="opportunity-card" key={opportunity._id}><div className="opportunity-rank">#{index + 1}</div><div className="opportunity-main"><strong>{opportunity.problemStatement}</strong><p>{opportunity.issueType} · {opportunity.digiaAddressable ? "Digia addressable" : `Owner: ${opportunity.recommendedOwner}`}</p><span>{opportunity.priorityScore} priority · {opportunity.evidenceCount} supporting reviews</span>{opportunity.digiaAddressable && opportunity.evidenceCount >= 2 && !opportunity.intervention ? <button className="fix-button" onClick={() => generateFix({ opportunityId: opportunity._id })}>Generate Fix</button> : null}{opportunity.intervention?.generationStatus === "running" ? <span>Generating recommendation…</span> : null}{opportunity.intervention?.generationStatus === "failed" ? <span className="fix-error">Fix generation failed: {opportunity.intervention.errorMessage}</span> : null}{opportunity.intervention?.generationStatus === "complete" ? <div className="fix-result"><strong>Recommended {opportunity.intervention.experienceType}</strong><span>Audience: {opportunity.intervention.audience}</span><span>Trigger: {opportunity.intervention.trigger}</span><span>Copy: {opportunity.intervention.suggestedCopy}</span><span>Success metric: {opportunity.intervention.successMetric}</span></div> : null}</div></article>)}</div> : null}
      </section>
    </main>
  );
}
