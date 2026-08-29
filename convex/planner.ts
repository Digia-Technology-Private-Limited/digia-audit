"use node";

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const outputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    audience: { type: "string" },
    trigger: { type: "string" },
    experienceType: { type: "string", enum: ["Spotlight", "Tooltip", "Bottom Sheet", "Walkthrough", "Inline Card", "Survey"] },
    suggestedCopy: { type: "string" },
    successMetric: { type: "string" },
  },
  required: ["audience", "trigger", "experienceType", "suggestedCopy", "successMetric"],
} as const;

export const run = internalAction({
  args: { interventionId: v.id("interventions"), opportunityId: v.id("opportunities") },
  handler: async (ctx, args) => {
    try {
      const input = await ctx.runQuery(internal.audits.getPlannerInput, { opportunityId: args.opportunityId });
      const response = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY ?? ""}` },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          store: false,
          instructions: "You are the Action Planner agent for Digia. Recommend one concrete in-app experience for this evidence-backed product problem. Use the real review evidence. Do not recommend a Digia intervention for engineering, performance, data, or backend failures. Keep the audience, trigger, copy, and success metric specific. This is a recommendation only; do not claim it was published.",
          input: JSON.stringify(input),
          text: { format: { type: "json_schema", name: "digia_intervention", strict: true, schema: outputSchema } },
        }),
      });
      if (!response.ok) throw new Error(`Action Planner request failed (${response.status}).`);
      const body = await response.json() as { output_text?: string; output?: Array<{ content?: Array<{ text?: string }> }> };
      const outputText = body.output_text ?? body.output?.flatMap((item) => item.content ?? []).map((item) => item.text ?? "").join("") ?? "";
      const result = JSON.parse(outputText) as Record<string, unknown>;
      for (const field of ["audience", "trigger", "experienceType", "suggestedCopy", "successMetric"]) {
        if (typeof result[field] !== "string" || !result[field]) throw new Error("Action Planner returned an incomplete recommendation.");
      }
      await ctx.runMutation(internal.audits.saveIntervention, { interventionId: args.interventionId, audience: result.audience as string, trigger: result.trigger as string, experienceType: result.experienceType as string, suggestedCopy: result.suggestedCopy as string, successMetric: result.successMetric as string });
    } catch (error) {
      await ctx.runMutation(internal.audits.failIntervention, { interventionId: args.interventionId, message: error instanceof Error ? error.message : "Action Planner failed unexpectedly." });
    }
  },
});
