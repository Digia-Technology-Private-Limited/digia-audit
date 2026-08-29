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
      </section>
    </main>
  );
}
