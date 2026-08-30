"use client";

import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import Link from "next/link";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";

export function OpportunityDetail({ opportunityId }: { opportunityId: string }) {
  const id = opportunityId as Id<"opportunities">;
  const detail = useQuery(api.audits.getOpportunity, { opportunityId: id });
  const recalculate = useMutation(api.audits.recalculateOpportunity);
  const generateFix = useMutation(api.audits.generateFix);
  const [impact, setImpact] = useState<number | null>(null);
  const [frequency, setFrequency] = useState<number | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [isGeneratingFix, setIsGeneratingFix] = useState(false);

  if (detail === undefined) return <main className="audit-shell"><p className="audit-loading">Loading opportunity…</p></main>;
  if (detail === null) return <main className="audit-shell"><div className="audit-message"><p className="eyebrow">Opportunity unavailable</p><h1>This opportunity could not be found.</h1></div></main>;

  const currentImpact = impact ?? detail.opportunity.impact;
  const currentFrequency = frequency ?? detail.opportunity.frequency;
  const saveRanking = async () => {
    try {
      await recalculate({ opportunityId: id, impact: currentImpact, frequency: currentFrequency });
      setMessage("Ranking recalculated and saved.");
      setImpact(null);
      setFrequency(null);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Ranking could not be saved.");
    }
  };

  const handleGenerateFix = async () => {
    setIsGeneratingFix(true);
    try {
      await generateFix({ opportunityId: id });
    } catch {
      setIsGeneratingFix(false);
    }
  };

  return <main className="audit-shell"><section className="audit-panel detail-panel"><Link className="back-link" href={`/audits/${detail.opportunity.auditRunId}`}>← Back to audit</Link><p className="audit-kicker">Opportunity detail</p><h1>{detail.opportunity.problemStatement}</h1><div className="detail-tags"><span>{detail.opportunity.issueType}</span><span>{detail.opportunity.digiaAddressable ? "Digia addressable" : `Owner: ${detail.opportunity.recommendedOwner}`}</span><span>{detail.opportunity.lowConfidence ? "Low confidence" : "Evidence-backed"}</span></div><div className="detail-grid"><div><small>Diagnosis</small><strong>{detail.opportunity.diagnosis}</strong></div><div><small>Severity</small><strong>{detail.opportunity.severity}/10</strong></div><div><small>Confidence</small><strong>{detail.opportunity.confidence}/10</strong></div><div><small>Trend</small><strong>{detail.opportunity.trend}/10</strong></div><div><small>Priority score</small><strong>{detail.opportunity.priorityScore} / 10,000</strong><small className="priority-formula">{detail.opportunity.impact} impact × {detail.opportunity.confidence} confidence × {detail.opportunity.frequency} frequency × {detail.opportunity.trend} trend</small></div></div><div className="ranking-editor"><h2>Edit ranking inputs</h2><p>Change impact or frequency, then recalculate the score.</p><label>Impact <input type="number" min="1" max="10" value={currentImpact} onChange={(event) => setImpact(Number(event.target.value))} /></label><label>Frequency <input type="number" min="1" max="10" value={currentFrequency} onChange={(event) => setFrequency(Number(event.target.value))} /></label><button className="fix-button" onClick={saveRanking}>Recalculate ranking</button>{message ? <p role="status">{message}</p> : null}</div><div className="detail-evidence"><h2>Supporting reviews ({detail.reviews.length})</h2>{detail.reviews.map((review) => <article className="review-card" key={review._id}><div><span>{review.rating}/5</span><time>{review.reviewDate ?? "Date unavailable"}</time></div><p>{review.originalText}</p></article>)}</div>{detail.opportunity.digiaAddressable && detail.reviews.length >= 2 && !detail.intervention ? <button className="fix-button" disabled={isGeneratingFix} aria-live="polite" onClick={handleGenerateFix}>{isGeneratingFix ? "Generating" : "Generate Fix"}</button> : null}{detail.intervention?.generationStatus === "running" ? <span role="status">Generating recommendation…</span> : null}{detail.intervention?.generationStatus === "complete" ? <div className="fix-result"><strong>Recommended {detail.intervention.experienceType}</strong><span>Audience: {detail.intervention.audience}</span><span>Trigger: {detail.intervention.trigger}</span><span>Copy: {detail.intervention.suggestedCopy}</span><span>Success metric: {detail.intervention.successMetric}</span></div> : null}<div className="change-history"><h2>Change history</h2>{detail.changes.length === 0 ? <p>No ranking changes yet.</p> : detail.changes.map((change) => <p key={change._id}>{change.changedBy} changed {change.field} from {change.previousValue} to {change.nextValue}.</p>)}</div></section></main>;
}
