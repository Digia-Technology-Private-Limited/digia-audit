"use node";

import gplay from "google-play-scraper";
import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

export const MAX_REVIEWS_PER_AUDIT = 10_000;
const ANALYSIS_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const SCRAPE_TIMEOUT_MS = 20_000;
const REVIEW_STORAGE_BATCH_SIZE = 500;

type RawReview = {
  id?: unknown;
  text?: unknown;
  score?: unknown;
  date?: unknown;
  version?: unknown;
};

type ReviewsResponse = {
  data?: RawReview[];
  nextPaginationToken?: string | null;
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

function isTimeout(error: unknown) {
  return /timed out/i.test(error instanceof Error ? error.message : String(error));
}

async function saveReviewBatches(ctx: any, auditRunId: Id<"auditRuns">, appId: Id<"apps">, reviews: any[]) {
  for (let index = 0; index < reviews.length; index += REVIEW_STORAGE_BATCH_SIZE) {
    await ctx.runMutation(internal.audits.saveScrapeBatch, {
      auditRunId,
      appId,
      reviews: reviews.slice(index, index + REVIEW_STORAGE_BATCH_SIZE),
    });
  }
}

export const run = internalAction({
  args: { auditRunId: v.id("auditRuns"), packageId: v.string() },
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.audits.updateScrapeStarted, { auditRunId: args.auditRunId });

    let appName: string | undefined;
    let developer: string | undefined;
    let audit: { appId: Id<"apps">; analysisWindowStart?: number; analysisWindowEnd?: number } | null = null;
    const normalized: Array<{
      sourceReviewId: string;
      sourceReviewIdKind: "native" | "derived";
      originalText: string;
      rating: number;
      reviewDate: string;
      version?: string;
      qualityStatus: "usable" | "lowQuality";
    }> = [];
    const seen = new Set<string>();
    let reviewsFetched = 0;
    let pagesFetched = 0;
    let rawReviewsReturned = 0;
    let duplicateReviewsRemoved = 0;
    let skippedReviewCount = 0;
    let lowQualityReviewCount = 0;
    let oldestReviewFetchedAt: string | undefined;
    let newestReviewFetchedAt: string | undefined;

    try {
      audit = await ctx.runQuery(api.audits.get, { auditRunId: args.auditRunId });
      if (!audit) throw new Error("Audit not found");
      const analysisWindowEnd = audit.analysisWindowEnd ?? Date.now();
      const analysisWindowStart = audit.analysisWindowStart ?? analysisWindowEnd - ANALYSIS_WINDOW_DAYS * DAY_MS;
      const app = await withTimeout(gplay.app({ appId: args.packageId, lang: "en", country: "us" }));
      appName = app.title;
      developer = app.developer;
      let nextPaginationToken: string | null = null;
      let stopReason: "window_reached" | "source_exhausted" | "max_reviews_reached" = "source_exhausted";

      while (true) {
        const result: ReviewsResponse | RawReview[] = await withTimeout(gplay.reviews({
          appId: args.packageId,
          lang: "en",
          country: "us",
          sort: 2,
          paginate: true,
          ...(nextPaginationToken ? { nextPaginationToken } : {}),
        })) as ReviewsResponse | RawReview[];
        pagesFetched += 1;
        const rawReviews = (Array.isArray(result) ? result : result.data) as RawReview[] | undefined;
        const nextToken = Array.isArray(result) ? null : result.nextPaginationToken ?? null;
        if (!rawReviews || rawReviews.length === 0) {
          stopReason = "source_exhausted";
          break;
        }
        rawReviewsReturned += rawReviews.length;

        let reachedWindowBoundary = false;
        for (const raw of rawReviews) {
          if (reviewsFetched >= MAX_REVIEWS_PER_AUDIT) {
            stopReason = "max_reviews_reached";
            break;
          }
          const text = typeof raw.text === "string" ? raw.text.trim() : "";
          const rating = typeof raw.score === "number" ? raw.score : Number(raw.score);
          const reviewTimestamp = raw.date ? Date.parse(String(raw.date)) : Number.NaN;
          if (!text || !Number.isInteger(rating) || rating < 1 || rating > 5 || !Number.isFinite(reviewTimestamp)) {
            skippedReviewCount += 1;
            continue;
          }
          const reviewDate = new Date(reviewTimestamp).toISOString();
          const reviewId = typeof raw.id === "string" && raw.id.trim() ? raw.id : derivedReviewId(raw, args.packageId);
          if (seen.has(reviewId)) {
            duplicateReviewsRemoved += 1;
            continue;
          }
          seen.add(reviewId);
          reviewsFetched += 1;
          const capReached = reviewsFetched >= MAX_REVIEWS_PER_AUDIT;
          oldestReviewFetchedAt = oldestReviewFetchedAt && Date.parse(oldestReviewFetchedAt) <= reviewTimestamp ? oldestReviewFetchedAt : reviewDate;
          newestReviewFetchedAt = newestReviewFetchedAt && Date.parse(newestReviewFetchedAt) >= reviewTimestamp ? newestReviewFetchedAt : reviewDate;

          if (reviewTimestamp < analysisWindowStart) {
            if (capReached) stopReason = "max_reviews_reached";
            reachedWindowBoundary = true;
            break;
          }
          if (reviewTimestamp > analysisWindowEnd) {
            if (capReached) stopReason = "max_reviews_reached";
            if (capReached) break;
            continue;
          }
          const qualityStatus = text.length < 5 ? "lowQuality" : "usable";
          if (qualityStatus === "lowQuality") lowQualityReviewCount += 1;
          normalized.push({
            sourceReviewId: reviewId,
            sourceReviewIdKind: typeof raw.id === "string" && raw.id.trim() ? "native" : "derived",
            originalText: text,
            rating,
            reviewDate,
            version: typeof raw.version === "string" && raw.version ? raw.version : undefined,
            qualityStatus,
          });
          if (capReached) {
            stopReason = "max_reviews_reached";
            break;
          }
        }

        if (stopReason === "max_reviews_reached") break;
        if (reachedWindowBoundary) {
          stopReason = "window_reached";
          break;
        }
        if (!nextToken || nextToken === nextPaginationToken) {
          stopReason = "source_exhausted";
          break;
        }
        nextPaginationToken = nextToken;
      }

      const warnings = [];
      if (skippedReviewCount > 0) warnings.push(`${skippedReviewCount} malformed review record(s) were skipped.`);
      if (normalized.length < 10) warnings.push("Fewer than 10 reviews were available. This audit is low confidence.");
      if (stopReason === "max_reviews_reached") warnings.push(`The ${MAX_REVIEWS_PER_AUDIT.toLocaleString()} review collection limit was reached before the full 30-day window was covered.`);
      await saveReviewBatches(ctx, args.auditRunId, audit.appId, normalized);
      await ctx.runMutation(internal.audits.saveScrapeResult, {
        auditRunId: args.auditRunId,
        appId: audit.appId,
        appName,
        developer,
        reviews: [],
        skippedReviewCount,
        lowQualityReviewCount,
        reviewsFetched,
        reviewCountOverride: normalized.length,
        usableReviewCountOverride: normalized.filter((review) => review.qualityStatus === "usable").length,
        pagesFetched,
        rawReviewsReturned,
        duplicateReviewsRemoved,
        reviewsInWindow: normalized.length,
        reviewsAnalyzed: normalized.filter((review) => review.qualityStatus === "usable").length,
        oldestReviewFetchedAt,
        newestReviewFetchedAt,
        windowCoverageStatus: stopReason === "window_reached" || stopReason === "source_exhausted" ? "complete" : "partial",
        collectionStopReason: stopReason,
        scrapeStatus: stopReason === "window_reached" || stopReason === "source_exhausted" ? "complete" : "partial",
        warning: warnings.length > 0 ? warnings.join(" ") : undefined,
      });
    } catch (error) {
      if (audit && reviewsFetched > 0) {
        const timeout = isTimeout(error);
        await saveReviewBatches(ctx, args.auditRunId, audit.appId, normalized);
        await ctx.runMutation(internal.audits.saveScrapeResult, {
          auditRunId: args.auditRunId,
          appId: audit.appId,
          appName,
          developer,
          reviews: [],
          skippedReviewCount,
          lowQualityReviewCount,
          reviewsFetched,
          reviewCountOverride: normalized.length,
          usableReviewCountOverride: normalized.filter((review) => review.qualityStatus === "usable").length,
          pagesFetched,
          rawReviewsReturned,
          duplicateReviewsRemoved,
          reviewsInWindow: normalized.length,
          reviewsAnalyzed: normalized.filter((review) => review.qualityStatus === "usable").length,
          oldestReviewFetchedAt,
          newestReviewFetchedAt,
          windowCoverageStatus: "partial",
          collectionStopReason: timeout ? "timeout" : "pagination_failure",
          scrapeStatus: "partial",
          warning: `${errorMessage(error)} Collection stopped before the full 30-day window was covered.`,
        });
      } else {
        await ctx.runMutation(internal.audits.saveScrapeFailure, {
          auditRunId: args.auditRunId,
          message: errorMessage(error),
          pagesFetched,
          rawReviewsReturned,
          duplicateReviewsRemoved,
          collectionStopReason: isTimeout(error) ? "timeout" : "pagination_failure",
        });
      }
    }
  },
});
