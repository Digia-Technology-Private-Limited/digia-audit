"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const model = "gpt-4o-mini";

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    opportunities: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          problemStatement: { type: "string" },
          evidenceReviewIds: { type: "array", items: { type: "string" } },
          frequency: { type: "number", minimum: 1, maximum: 10 },
          severity: { type: "number", minimum: 1, maximum: 10 },
          confidence: { type: "number", minimum: 1, maximum: 10 },
          trend: { type: "number", minimum: 1, maximum: 10 },
          impact: { type: "number", minimum: 1, maximum: 10 },
          diagnosis: { type: "string" },
          issueType: { type: "string", enum: ["Engineering", "UX", "Education", "Feature Gap", "Performance", "Data", "Support", "Other"] },
          digiaAddressable: { type: "boolean" },
          recommendedOwner: { type: "string" },
        },
        required: ["problemStatement", "evidenceReviewIds", "frequency", "severity", "confidence", "trend", "impact", "diagnosis", "issueType", "digiaAddressable", "recommendedOwner"],
      },
    },
  },
  required: ["opportunities"],
} as const;

export const run = internalAction({
  args: { auditRunId: v.id("auditRuns"), appId: v.id("apps") },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.audits.updateAnalysisStage, { auditRunId: args.auditRunId, stage: "consolidating" });
    try {
      const candidates = await ctx.runQuery(internal.audits.getAnalystInput, { auditRunId: args.auditRunId });
      await ctx.runMutation(internal.audits.updateAnalysisStage, { auditRunId: args.auditRunId, stage: "diagnosing" });
      if (candidates.length === 0) {
        await ctx.runMutation(internal.audits.saveAnalystResult, { auditRunId: args.auditRunId, opportunities: [] });
        return;
      }
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
        body: JSON.stringify({
          model,
          store: false,
          instructions: "You are the Product Analyst agent. Consolidate grounded problem candidates into specific diagnosed opportunities. Use the supplied evidence review text to validate each diagnosis and cite only review IDs present in the supplied candidate evidence. When candidates describe the same specific problem, merge them and preserve the union of their supporting review IDs; keep distinct problems separate even when they share broad keywords. Only output an opportunity when the consolidated evidence contains at least 10 distinct supporting reviews. Diagnose whether the underlying issue is Engineering, UX, Education, Feature Gap, Performance, Data, Support, or Other. Be conservative about Digia addressability: crashes, backend failures, data corruption, and performance failures are not Digia-addressable. Digia can address discoverability, education, and in-product guidance. Propose ranking inputs from 1 to 10; these are inputs only and the application will calculate the score.",
          input: JSON.stringify(candidates),
          text: { format: { type: "json_schema", name: "analyst_opportunities", strict: true, schema: outputSchema } },
        }),
      });
      if (!response.ok) throw new Error(`Product Analyst request failed (${response.status}).`);
      const body = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
      const outputText = body.output_text ?? body.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "";
      const parsed = JSON.parse(outputText) as { opportunities?: unknown };
      if (!Array.isArray(parsed.opportunities)) throw new Error("Product Analyst returned an invalid opportunity list.");
      await ctx.runMutation(internal.audits.updateAnalysisStage, { auditRunId: args.auditRunId, stage: "ranking" });
      await ctx.runMutation(internal.audits.saveAnalystResult, { auditRunId: args.auditRunId, opportunities: parsed.opportunities as never[] });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Product Analyst failed unexpectedly.";
      await ctx.runMutation(internal.audits.saveAnalysisFailure, { auditRunId: args.auditRunId, message });
    }
  },
});
