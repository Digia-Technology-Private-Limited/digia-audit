"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const model = "gpt-4o-mini";

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

export const run = internalAction({
  args: { auditRunId: v.id("auditRuns"), appId: v.id("apps") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.audits.updateResearchStarted, { auditRunId: args.auditRunId });
    try {
      const reviews = await ctx.runQuery(internal.audits.getUsableReviews, { auditRunId: args.auditRunId });
      if (reviews.length === 0) {
        await ctx.runMutation(internal.audits.saveResearchResult, { auditRunId: args.auditRunId, candidates: [] });
        return;
      }

      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}`,
        },
        body: JSON.stringify({
          model,
          store: false,
          instructions: "You are the Researcher agent in a product feedback audit. Find specific recurring user problems from the supplied reviews. Use only the supplied review IDs and text. Do not invent or generalize beyond the evidence. A candidate must cite one or more review IDs. Prefer concrete problems over sentiment, praise, feature wishes without a problem, or vague statements like users dislike UX. Return no candidate when evidence does not support a concrete problem.",
          input: JSON.stringify(reviews),
          text: { format: { type: "json_schema", name: "research_candidates", strict: true, schema: outputSchema } },
        }),
      });
      if (!response.ok) throw new Error(`Researcher request failed (${response.status}).`);
      const body = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
      const outputText = body.output_text ?? body.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "";
      const parsed = JSON.parse(outputText) as { candidates?: Array<{ problemStatement?: unknown; evidenceReviewIds?: unknown; category?: unknown; confidence?: unknown }> };
      if (!Array.isArray(parsed.candidates)) throw new Error("Researcher returned an invalid candidate list.");

      const candidates = parsed.candidates.map((candidate) => ({
        problemStatement: typeof candidate.problemStatement === "string" ? candidate.problemStatement : "",
        evidenceReviewIds: Array.isArray(candidate.evidenceReviewIds) ? candidate.evidenceReviewIds.filter((id): id is string => typeof id === "string") : [],
        category: typeof candidate.category === "string" ? candidate.category : "Other",
        confidence: typeof candidate.confidence === "number" ? candidate.confidence : 0,
      }));
      await ctx.runMutation(internal.audits.saveResearchResult, { auditRunId: args.auditRunId, candidates });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Researcher failed unexpectedly.";
      await ctx.runMutation(internal.audits.saveAnalysisFailure, { auditRunId: args.auditRunId, message });
    }
  },
});
