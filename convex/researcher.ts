"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const model = "gpt-4o-mini";
const MAX_BATCH_CHARS = 60_000;
const MAX_CONCURRENT_BATCHES = 4;

type ResearchReview = { reviewId: string; text: string; rating: number; date: string | null };
type ResearchCandidate = { problemStatement: string; evidenceReviewIds: string[]; category: string; confidence: number };

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          problemStatement: { type: "string" },
          evidenceReviewIds: { type: "array", items: { type: "string" } },
          category: { type: "string" },
          confidence: { type: "number", minimum: 0, maximum: 1 },
        },
        required: ["problemStatement", "evidenceReviewIds", "category", "confidence"],
      },
    },
  },
  required: ["candidates"],
} as const;

function chunkReviews(reviews: ResearchReview[]) {
  const batches: ResearchReview[][] = [];
  let batch: ResearchReview[] = [];
  let batchChars = 2;
  for (const review of reviews) {
    const reviewChars = JSON.stringify(review).length + 1;
    if (batch.length > 0 && batchChars + reviewChars > MAX_BATCH_CHARS) {
      batches.push(batch);
      batch = [];
      batchChars = 2;
    }
    batch.push(review);
    batchChars += reviewChars;
  }
  if (batch.length > 0) batches.push(batch);
  return batches;
}

async function runResearchBatch(reviews: ResearchReview[]) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
    },
    body: JSON.stringify({
      model,
      store: false,
      instructions: "You are the Researcher agent in a product feedback audit. Find specific recurring user problems from this batch of supplied reviews. Use only the supplied review IDs and text. Do not invent or generalize beyond the evidence. A candidate must cite one or more review IDs from this batch. Prefer concrete problems over sentiment, praise, feature wishes without a problem, or vague statements like users dislike UX. Return no candidate when evidence does not support a concrete problem.",
      input: JSON.stringify(reviews),
      text: { format: { type: "json_schema", name: "research_candidates", strict: true, schema: outputSchema } },
    }),
  });
  if (!response.ok) throw new Error(`Researcher request failed (${response.status}).`);
  const body = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
  const outputText = body.output_text ?? body.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "";
  const parsed = JSON.parse(outputText) as { candidates?: Array<{ problemStatement?: unknown; evidenceReviewIds?: unknown; category?: unknown; confidence?: unknown }> };
  if (!Array.isArray(parsed.candidates)) throw new Error("Researcher returned an invalid candidate list.");
  return parsed.candidates.map((candidate): ResearchCandidate => ({
    problemStatement: typeof candidate.problemStatement === "string" ? candidate.problemStatement : "",
    evidenceReviewIds: Array.isArray(candidate.evidenceReviewIds) ? candidate.evidenceReviewIds.filter((id): id is string => typeof id === "string") : [],
    category: typeof candidate.category === "string" ? candidate.category : "Other",
    confidence: typeof candidate.confidence === "number" ? candidate.confidence : 0,
  }));
}

export const run = internalAction({
  args: { auditRunId: v.id("auditRuns"), appId: v.id("apps") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.audits.updateResearchStarted, { auditRunId: args.auditRunId });
    try {
      let cursor: string | null = null;
      let totalReviews = 0;
      const candidateBatches: ResearchCandidate[][] = [];
      while (true) {
        const result: { page: ResearchReview[]; isDone: boolean; continueCursor: string } = await ctx.runQuery(internal.audits.getUsableReviewsPage, {
          auditRunId: args.auditRunId,
          paginationOpts: { numItems: 2000, cursor },
        });
        const reviews = result.page;
        totalReviews += reviews.length;
        const batches = chunkReviews(reviews);
        for (let index = 0; index < batches.length; index += MAX_CONCURRENT_BATCHES) {
          const batchGroup = batches.slice(index, index + MAX_CONCURRENT_BATCHES);
          candidateBatches.push(...await Promise.all(batchGroup.map((batch) => runResearchBatch(batch))));
        }
        if (result.isDone) break;
        cursor = result.continueCursor;
      }
      if (totalReviews === 0) {
        await ctx.runMutation(internal.audits.saveResearchResult, { auditRunId: args.auditRunId, candidates: [] });
        return;
      }
      await ctx.runMutation(internal.audits.saveResearchResult, { auditRunId: args.auditRunId, candidates: candidateBatches.flat() });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Researcher failed unexpectedly.";
      await ctx.runMutation(internal.audits.saveAnalysisFailure, { auditRunId: args.auditRunId, message });
    }
  },
});
