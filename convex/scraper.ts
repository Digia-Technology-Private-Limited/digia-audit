"use node";

import gplay from "google-play-scraper";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

const MAX_REVIEWS = 500;
const SCRAPE_TIMEOUT_MS = 20_000;

type RawReview = {
  id?: unknown;
  text?: unknown;
  score?: unknown;
  date?: unknown;
  version?: unknown;
};

function derivedReviewId(review: RawReview, packageId: string) {
  const source = `${packageId}|${String(review.text ?? "").trim()}|${String(review.score ?? "")}|${String(review.date ?? "")}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `derived:${(hash >>> 0).toString(16)}`;
}

function withTimeout<T>(promise: Promise<T>) {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("The Play Store request timed out.")), SCRAPE_TIMEOUT_MS)),
  ]);
}

function errorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  if (/not found|does not exist|404|not available/i.test(message)) return "App not found on Google Play Store.";
  if (/timed out/i.test(message)) return message;
  return "Could not collect reviews from Google Play Store.";
}

export const run = internalAction({
  args: { auditRunId: v.id("auditRuns"), packageId: v.string() },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.audits.updateScrapeStarted, { auditRunId: args.auditRunId });

    try {
      const app = await withTimeout(gplay.app({ appId: args.packageId, lang: "en", country: "us" }));
      const result = await withTimeout(gplay.reviews({ appId: args.packageId, lang: "en", country: "us", sort: 2, num: MAX_REVIEWS }));
      const rawReviews = Array.isArray(result) ? result : result.data;
      const seen = new Set<string>();
      const normalized = [];
      let skippedReviewCount = 0;
      let lowQualityReviewCount = 0;

      for (const raw of rawReviews as RawReview[]) {
        const text = typeof raw.text === "string" ? raw.text.trim() : "";
        const rating = typeof raw.score === "number" ? raw.score : Number(raw.score);
        const reviewId = typeof raw.id === "string" && raw.id.trim() ? raw.id : derivedReviewId(raw, args.packageId);
        if (!text || !Number.isInteger(rating) || rating < 1 || rating > 5 || !raw.date) {
          skippedReviewCount += 1;
          continue;
        }
        if (seen.has(reviewId)) continue;
        seen.add(reviewId);
        const qualityStatus = text.length < 5 ? "lowQuality" : "usable";
        if (qualityStatus === "lowQuality") lowQualityReviewCount += 1;
        normalized.push({
          sourceReviewId: reviewId,
          sourceReviewIdKind: typeof raw.id === "string" && raw.id.trim() ? "native" as const : "derived" as const,
          originalText: text,
          rating,
          reviewDate: String(raw.date),
          version: typeof raw.version === "string" && raw.version ? raw.version : undefined,
          qualityStatus: qualityStatus as "usable" | "lowQuality",
        });
      }

      if (rawReviews.length > 0 && normalized.length === 0) {
        throw new Error("Google Play returned no valid review records.");
      }

      const warnings = [];
      if (skippedReviewCount > 0) warnings.push(`${skippedReviewCount} malformed review record(s) were skipped.`);
      if (normalized.length < 10) warnings.push("Fewer than 10 reviews were available. This audit is low confidence.");
      await ctx.runMutation(internal.audits.saveScrapeResult, {
        auditRunId: args.auditRunId,
        appId: (await ctx.runQuery(internal.audits.getAppForAudit, { auditRunId: args.auditRunId }))!.appId,
        appName: app.title,
        developer: app.developer,
        reviews: normalized,
        skippedReviewCount,
        lowQualityReviewCount,
        scrapeStatus: skippedReviewCount > 0 ? "partial" : "complete",
        warning: warnings.length > 0 ? warnings.join(" ") : undefined,
      });
    } catch (error) {
      await ctx.runMutation(internal.audits.saveScrapeFailure, { auditRunId: args.auditRunId, message: errorMessage(error) });
    }
  },
});
