import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { paginationOptsValidator } from "convex/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

const MIN_ACTIONABLE_EVIDENCE = 10;
const ANALYSIS_WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

function getAnalysisWindow(now: number) {
  return {
    analysisWindowStart: now - ANALYSIS_WINDOW_DAYS * DAY_MS,
    analysisWindowEnd: now,
  };
}

function isReviewInAnalysisWindow(reviewDate: string | undefined, audit: { analysisWindowStart?: number; analysisWindowEnd?: number }) {
  if (audit.analysisWindowStart === undefined || audit.analysisWindowEnd === undefined) return true;
  const timestamp = reviewDate ? Date.parse(reviewDate) : Number.NaN;
  return Number.isFinite(timestamp) && timestamp >= audit.analysisWindowStart && timestamp <= audit.analysisWindowEnd;
}

async function getValidReviewIds(ctx: any, audit: { appId: Id<"apps">; analysisWindowStart?: number; analysisWindowEnd?: number }, auditRunId: Id<"auditRuns">, reviewIds: string[], knownObservedReviewIds?: Set<string>) {
  const observedReviewIds = knownObservedReviewIds ?? new Set((await ctx.db.query("reviewObservations").withIndex("by_audit_review", (q: any) => q.eq("auditRunId", auditRunId)).collect()).map((observation: any) => observation.reviewId as string));
  const validIds: Id<"reviews">[] = [];
  for (const reviewId of [...new Set(reviewIds)]) {
    if (!observedReviewIds.has(reviewId)) continue;
    const review = await ctx.db.get(reviewId as Id<"reviews">);
    if (review?.appId === audit.appId && review.qualityStatus === "usable" && review.originalText.trim() && isReviewInAnalysisWindow(review.reviewDate, audit)) {
      validIds.push(review._id);
    }
  }
  return validIds;
}

async function getValidEvidence(ctx: any, opportunity: { _id: Id<"opportunities">; appId: Id<"apps">; auditRunId: Id<"auditRuns"> }, audit: { analysisWindowStart?: number; analysisWindowEnd?: number }) {
  const evidence = await ctx.db.query("evidence").withIndex("by_opportunity", (q: any) => q.eq("opportunityId", opportunity._id)).collect();
  const resolvedReviewIds = new Set<string>();
  const resolved = await Promise.all(evidence.map(async (item: any) => {
    if (item.appId !== opportunity.appId || item.auditRunId !== opportunity.auditRunId) return null;
    if (resolvedReviewIds.has(item.reviewId)) return null;
    resolvedReviewIds.add(item.reviewId);
    const review = await ctx.db.get(item.reviewId);
    if (!review || review.appId !== opportunity.appId || review.qualityStatus !== "usable" || !review.originalText.trim() || !isReviewInAnalysisWindow(review.reviewDate, audit)) return null;
    return { evidence: item, review };
  }));
  return resolved.filter((item: any): item is { evidence: any; review: any } => item !== null);
}

async function persistReviewBatch(ctx: any, auditRunId: Id<"auditRuns">, appId: Id<"apps">, reviews: any[], now: number) {
  for (const review of reviews) {
    const existing = await ctx.db
      .query("reviews")
      .withIndex("by_app_source_review", (q: any) => q.eq("appId", appId).eq("source", "googlePlay").eq("sourceReviewId", review.sourceReviewId))
      .unique();
    const reviewId = existing?._id ?? await ctx.db.insert("reviews", {
      appId,
      source: "googlePlay",
      sourceReviewId: review.sourceReviewId,
      sourceReviewIdKind: review.sourceReviewIdKind,
      originalText: review.originalText,
      rating: review.rating,
      reviewDate: review.reviewDate,
      scrapedAt: now,
      version: review.version,
      qualityStatus: review.qualityStatus,
    });
    const existingObservation = await ctx.db
      .query("reviewObservations")
      .withIndex("by_audit_review", (q: any) => q.eq("auditRunId", auditRunId).eq("reviewId", reviewId))
      .unique();
    if (!existingObservation) await ctx.db.insert("reviewObservations", { auditRunId, reviewId, observedAt: now });
  }
}

export const create = mutation({
  args: {
    sourceUrl: v.string(),
    packageId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    const { analysisWindowStart, analysisWindowEnd } = getAnalysisWindow(now);
    const existingApp = await ctx.db
      .query("apps")
      .withIndex("by_platform_package", (q) => q.eq("platform", "android").eq("packageName", args.packageId))
      .unique();

    const appId = existingApp?._id ?? await ctx.db.insert("apps", {
      platform: "android",
      packageName: args.packageId,
      canonicalPlayStoreUrl: `https://play.google.com/store/apps/details?id=${encodeURIComponent(args.packageId)}`,
      createdAt: now,
      updatedAt: now,
    });

    if (existingApp) {
      await ctx.db.patch(existingApp._id, { updatedAt: now });
    }

    const requesterId = await ctx.db.insert("requesters", {
      name: "Guest",
      createdAt: now,
      updatedAt: now,
    });

    const auditRunId = await ctx.db.insert("auditRuns", {
      appId,
      requesterId,
      source: "googlePlay",
      sourceUrl: args.sourceUrl,
      requestedAt: now,
      startedAt: now,
      status: "running",
      scrapeStatus: "pending",
      analysisStatus: "pending",
      analysisWindowStart,
      analysisWindowEnd,
      analysisWindowType: "fixed_days",
      analysisWindowDays: ANALYSIS_WINDOW_DAYS,
      reviewsFetched: 0,
      pagesFetched: 0,
      rawReviewsReturned: 0,
      duplicateReviewsRemoved: 0,
      reviewsInWindow: 0,
      reviewsAnalyzed: 0,
      windowCoverageStatus: "partial",
      reviewCount: 0,
      usableReviewCount: 0,
      skippedReviewCount: 0,
      lowQualityReviewCount: 0,
      currentStage: "validating",
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.scraper.run, { auditRunId, packageId: args.packageId });
    return auditRunId;
  },
});

export const getAppForAudit = internalQuery({
  args: { auditRunId: v.id("auditRuns") },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditRunId);
    if (!audit) throw new Error("Audit not found");
    return { appId: audit.appId };
  },
});

export const updateScrapeStarted = internalMutation({
  args: { auditRunId: v.id("auditRuns") },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.patch(args.auditRunId, {
      status: "running",
      scrapeStatus: "running",
      currentStage: "collecting",
      scrapeError: undefined,
      scrapeWarning: undefined,
      updatedAt: now,
    });
  },
});

export const retry = mutation({
  args: { auditRunId: v.id("auditRuns") },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditRunId);
    if (!audit) throw new Error("Audit not found");
    const now = Date.now();
    const { analysisWindowStart, analysisWindowEnd } = getAnalysisWindow(now);
    await ctx.db.patch(args.auditRunId, {
      status: "running",
      scrapeStatus: "pending",
      analysisStatus: "pending",
      startedAt: now,
      analysisWindowStart,
      analysisWindowEnd,
      analysisWindowType: "fixed_days",
      analysisWindowDays: ANALYSIS_WINDOW_DAYS,
      reviewsFetched: 0,
      pagesFetched: 0,
      rawReviewsReturned: 0,
      duplicateReviewsRemoved: 0,
      reviewsInWindow: 0,
      reviewsAnalyzed: 0,
      oldestReviewFetchedAt: undefined,
      newestReviewFetchedAt: undefined,
      windowCoverageStatus: "partial",
      collectionStopReason: undefined,
      reviewCount: 0,
      usableReviewCount: 0,
      skippedReviewCount: 0,
      lowQualityReviewCount: 0,
      scrapeError: undefined,
      scrapeWarning: undefined,
      currentStage: "validating",
      updatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.scraper.run, { auditRunId: args.auditRunId, packageId: (await ctx.db.get(audit.appId))!.packageName });
  },
});

export const saveScrapeResult = internalMutation({
  args: {
    auditRunId: v.id("auditRuns"),
    appId: v.id("apps"),
    appName: v.optional(v.string()),
    developer: v.optional(v.string()),
    reviews: v.array(v.object({
      sourceReviewId: v.string(),
      sourceReviewIdKind: v.union(v.literal("native"), v.literal("derived")),
      originalText: v.string(),
      rating: v.number(),
      reviewDate: v.optional(v.string()),
      version: v.optional(v.string()),
      qualityStatus: v.union(v.literal("usable"), v.literal("lowQuality")),
    })),
    skippedReviewCount: v.number(),
    lowQualityReviewCount: v.number(),
    reviewsFetched: v.number(),
    reviewCountOverride: v.optional(v.number()),
    usableReviewCountOverride: v.optional(v.number()),
    pagesFetched: v.number(),
    rawReviewsReturned: v.number(),
    duplicateReviewsRemoved: v.number(),
    reviewsInWindow: v.number(),
    reviewsAnalyzed: v.number(),
    oldestReviewFetchedAt: v.optional(v.string()),
    newestReviewFetchedAt: v.optional(v.string()),
    windowCoverageStatus: v.union(v.literal("complete"), v.literal("partial")),
    collectionStopReason: v.union(
      v.literal("window_reached"),
      v.literal("source_exhausted"),
      v.literal("max_reviews_reached"),
      v.literal("pagination_failure"),
      v.literal("timeout"),
      v.literal("source_limit"),
    ),
    scrapeStatus: v.union(v.literal("partial"), v.literal("complete")),
    warning: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditRunId);
    if (!audit) throw new Error("Audit not found");

    const now = Date.now();
    if (args.appName || args.developer) {
      const app = await ctx.db.get(args.appId);
      if (app) {
        await ctx.db.patch(args.appId, {
          ...(args.appName ? { currentAppName: args.appName } : {}),
          ...(args.developer ? { currentDeveloper: args.developer } : {}),
          updatedAt: now,
        });
      }
    }

    await persistReviewBatch(ctx, args.auditRunId, args.appId, args.reviews, now);

    const reviewCount = args.reviewCountOverride ?? args.reviews.length;
    const usableReviewCount = args.usableReviewCountOverride ?? args.reviews.filter((review) => review.qualityStatus === "usable").length;
    await ctx.db.patch(args.auditRunId, {
      scrapeStatus: args.scrapeStatus,
      currentStage: "filtering",
      reviewCount,
      usableReviewCount,
      skippedReviewCount: args.skippedReviewCount,
      lowQualityReviewCount: args.lowQualityReviewCount,
      reviewsFetched: args.reviewsFetched,
      pagesFetched: args.pagesFetched,
      rawReviewsReturned: args.rawReviewsReturned,
      duplicateReviewsRemoved: args.duplicateReviewsRemoved,
      reviewsInWindow: args.reviewsInWindow,
      reviewsAnalyzed: args.reviewsAnalyzed,
      oldestReviewFetchedAt: args.oldestReviewFetchedAt,
      newestReviewFetchedAt: args.newestReviewFetchedAt,
      windowCoverageStatus: args.windowCoverageStatus,
      collectionStopReason: args.collectionStopReason,
      scrapeWarning: args.warning,
      updatedAt: now,
    });
    await ctx.scheduler.runAfter(0, internal.researcher.run, { auditRunId: args.auditRunId, appId: args.appId });
  },
});

export const saveScrapeBatch = internalMutation({
  args: {
    auditRunId: v.id("auditRuns"),
    appId: v.id("apps"),
    reviews: v.array(v.object({
      sourceReviewId: v.string(),
      sourceReviewIdKind: v.union(v.literal("native"), v.literal("derived")),
      originalText: v.string(),
      rating: v.number(),
      reviewDate: v.optional(v.string()),
      version: v.optional(v.string()),
      qualityStatus: v.union(v.literal("usable"), v.literal("lowQuality")),
    })),
  },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditRunId);
    if (!audit) throw new Error("Audit not found");
    await persistReviewBatch(ctx, args.auditRunId, args.appId, args.reviews, Date.now());
  },
});

export const updateResearchStarted = internalMutation({
  args: { auditRunId: v.id("auditRuns") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.auditRunId, { analysisStatus: "running", currentStage: "researching", updatedAt: Date.now() });
  },
});

export const saveResearchResult = internalMutation({
  args: {
    auditRunId: v.id("auditRuns"),
    candidates: v.array(v.object({
      problemStatement: v.string(),
      evidenceReviewIds: v.array(v.string()),
      category: v.string(),
      confidence: v.number(),
    })),
  },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditRunId);
    if (!audit) throw new Error("Audit not found");
    const observations = await ctx.db.query("reviewObservations").withIndex("by_audit_review", (q) => q.eq("auditRunId", args.auditRunId)).take(20);
    const observedReviewIds = new Set(observations.map((observation) => observation.reviewId as string));
    for (const candidate of args.candidates) {
      const evidenceReviewIds = await getValidReviewIds(ctx, audit, args.auditRunId, candidate.evidenceReviewIds, observedReviewIds);
      if (!candidate.problemStatement.trim() || evidenceReviewIds.length === 0) continue;
      await ctx.db.insert("problemCandidates", {
        appId: audit.appId,
        auditRunId: args.auditRunId,
        problemStatement: candidate.problemStatement.trim(),
        evidenceReviewIds,
        category: candidate.category.trim() || "Other",
        supportingSignalCount: evidenceReviewIds.length,
        confidence: Math.max(0, Math.min(1, candidate.confidence)),
        status: "accepted",
      });
    }
    await ctx.db.patch(args.auditRunId, { analysisStatus: "complete", analysisError: undefined, currentStage: "consolidating", updatedAt: Date.now() });
    await ctx.scheduler.runAfter(0, internal.analyst.run, { auditRunId: args.auditRunId, appId: audit.appId });
  },
});

export const getAnalystInput = internalQuery({
  args: { auditRunId: v.id("auditRuns") },
  handler: async (ctx, args) => {
    const candidates = await ctx.db.query("problemCandidates").withIndex("by_audit", (q) => q.eq("auditRunId", args.auditRunId)).collect();
    const audit = await ctx.db.get(args.auditRunId);
    return await Promise.all(candidates.map(async (candidate) => {
      const evidenceReviewIds = (await Promise.all(candidate.evidenceReviewIds.map((reviewId) => ctx.db.get(reviewId))))
        .filter((review): review is NonNullable<typeof review> => review !== null && review.appId === (audit?.appId ?? candidate.appId) && review.qualityStatus === "usable" && review.originalText.trim().length > 0 && isReviewInAnalysisWindow(review.reviewDate, audit ?? {}))
        .map((review) => review._id);
      return {
      candidateId: candidate._id,
      problemStatement: candidate.problemStatement,
      evidence: (await Promise.all(evidenceReviewIds.map((reviewId) => ctx.db.get(reviewId)))).filter((review): review is NonNullable<typeof review> => review !== null).map((review) => ({ reviewId: review._id, text: review.originalText, rating: review.rating, date: review.reviewDate ?? null })),
      category: candidate.category,
      supportingSignalCount: evidenceReviewIds.length,
      researcherConfidence: candidate.confidence,
      };
    })).then((items) => items.filter((item): item is NonNullable<typeof item> => item !== null));
  },
});

export const updateAnalysisStage = internalMutation({
  args: { auditRunId: v.id("auditRuns"), stage: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.auditRunId, { currentStage: args.stage, updatedAt: Date.now() });
  },
});

export const saveAnalystResult = internalMutation({
  args: {
    auditRunId: v.id("auditRuns"),
    opportunities: v.array(v.object({
      problemStatement: v.string(),
      evidenceReviewIds: v.array(v.string()),
      frequency: v.number(),
      severity: v.number(),
      confidence: v.number(),
      trend: v.number(),
      impact: v.number(),
      diagnosis: v.string(),
      issueType: v.string(),
      digiaAddressable: v.boolean(),
      recommendedOwner: v.string(),
    })),
  },
  handler: async (ctx, args) => {
    const audit = await ctx.db.get(args.auditRunId);
    if (!audit) throw new Error("Audit not found");
    const observations = await ctx.db.query("reviewObservations").withIndex("by_audit_review", (q) => q.eq("auditRunId", args.auditRunId)).collect();
    const observedReviewIds = new Set(observations.map((observation) => observation.reviewId as string));
    const now = Date.now();
    for (const opportunity of args.opportunities) {
      const evidenceReviewIds = await getValidReviewIds(ctx, audit, args.auditRunId, opportunity.evidenceReviewIds, observedReviewIds);
      if (!opportunity.problemStatement.trim() || evidenceReviewIds.length < MIN_ACTIONABLE_EVIDENCE) continue;
      const frequency = Math.max(1, Math.min(10, Math.round(opportunity.frequency)));
      const severity = Math.max(1, Math.min(10, Math.round(opportunity.severity)));
      const confidence = Math.max(1, Math.min(10, Math.round(opportunity.confidence)));
      const trend = Math.max(1, Math.min(10, Math.round(opportunity.trend)));
      const impact = Math.max(1, Math.min(10, Math.round(opportunity.impact)));
      const opportunityId = await ctx.db.insert("opportunities", {
        appId: audit.appId,
        auditRunId: args.auditRunId,
        problemStatement: opportunity.problemStatement.trim(),
        frequency,
        severity,
        confidence,
        trend,
        impact,
        priorityScore: impact * confidence * frequency * trend,
        diagnosis: opportunity.diagnosis.trim() || "Other",
        issueType: opportunity.issueType.trim() || "Other",
        digiaAddressable: opportunity.digiaAddressable,
        recommendedOwner: opportunity.recommendedOwner.trim() || "Product",
        lowConfidence: evidenceReviewIds.length < 2 || confidence < 5,
        createdAt: now,
        updatedAt: now,
      });
      for (const reviewId of evidenceReviewIds) {
        await ctx.db.insert("evidence", { appId: audit.appId, auditRunId: args.auditRunId, opportunityId, reviewId });
      }
    }
    await ctx.db.patch(args.auditRunId, { status: "complete", completedAt: now, currentStage: "preparing", updatedAt: now });
  },
});

export const saveAnalysisFailure = internalMutation({
  args: { auditRunId: v.id("auditRuns"), message: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.auditRunId, { analysisStatus: "failed", status: "failed", analysisError: args.message, updatedAt: Date.now() });
  },
});

export const saveScrapeFailure = internalMutation({
  args: {
    auditRunId: v.id("auditRuns"),
    message: v.string(),
    pagesFetched: v.optional(v.number()),
    rawReviewsReturned: v.optional(v.number()),
    duplicateReviewsRemoved: v.optional(v.number()),
    collectionStopReason: v.optional(v.union(
      v.literal("pagination_failure"),
      v.literal("timeout"),
      v.literal("source_limit"),
    )),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.auditRunId, {
      status: "failed",
      scrapeStatus: "failed",
      currentStage: "collecting",
      scrapeError: args.message,
      windowCoverageStatus: "partial",
      collectionStopReason: args.collectionStopReason ?? "pagination_failure",
      pagesFetched: args.pagesFetched,
      rawReviewsReturned: args.rawReviewsReturned,
      duplicateReviewsRemoved: args.duplicateReviewsRemoved,
      updatedAt: Date.now(),
    });
  },
});

export const get = query({
  args: { auditRunId: v.id("auditRuns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.auditRunId);
  },
});

export const listReviews = query({
  args: { auditRunId: v.id("auditRuns") },
  handler: async (ctx, args) => {
    const observations = await ctx.db.query("reviewObservations").withIndex("by_audit_review", (q) => q.eq("auditRunId", args.auditRunId)).take(20);
    const reviews = await Promise.all(observations.map((observation) => ctx.db.get(observation.reviewId)));
    return reviews.filter((review): review is NonNullable<typeof review> => review !== null);
  },
});

export const listCandidates = query({
  args: { auditRunId: v.id("auditRuns") },
  handler: async (ctx, args) => {
    return await ctx.db.query("problemCandidates").withIndex("by_audit", (q) => q.eq("auditRunId", args.auditRunId)).collect();
  },
});

export const listOpportunities = query({
  args: { auditRunId: v.id("auditRuns") },
  handler: async (ctx, args) => {
    const opportunities = await ctx.db.query("opportunities").withIndex("by_audit_score", (q) => q.eq("auditRunId", args.auditRunId)).order("desc").collect();
    const audit = await ctx.db.get(args.auditRunId);
    return (await Promise.all(opportunities.map(async (opportunity) => {
      const validEvidence = await getValidEvidence(ctx, opportunity, audit ?? {});
      const evidenceCount = validEvidence.length;
      return {
        ...opportunity,
        evidenceCount,
        coveragePercent: audit && audit.usableReviewCount > 0 ? Math.round((evidenceCount / audit.usableReviewCount) * 100) : 0,
        intervention: (await ctx.db.query("interventions").withIndex("by_opportunity", (q) => q.eq("opportunityId", opportunity._id)).order("desc").first()) ?? null,
      };
    }))).filter((opportunity) => opportunity.evidenceCount >= MIN_ACTIONABLE_EVIDENCE);
  },
});

export const getOpportunity = query({
  args: { opportunityId: v.id("opportunities"), auditRunId: v.id("auditRuns") },
  handler: async (ctx, args) => {
    const opportunity = await ctx.db.get(args.opportunityId);
    if (!opportunity || opportunity.auditRunId !== args.auditRunId) return null;
    const audit = await ctx.db.get(opportunity.auditRunId);
    const validEvidence = await getValidEvidence(ctx, opportunity, audit ?? {});
    const evidence = await ctx.db.query("evidence").withIndex("by_opportunity", (q) => q.eq("opportunityId", args.opportunityId)).collect();
    const reviews = validEvidence.map((item: { review: any }) => item.review);
    const changes = await ctx.db.query("opportunityChanges").withIndex("by_opportunity", (q) => q.eq("opportunityId", args.opportunityId)).order("desc").collect();
    const intervention = await ctx.db.query("interventions").withIndex("by_opportunity", (q) => q.eq("opportunityId", args.opportunityId)).order("desc").first();
    return { opportunity, reviews, evidenceCount: validEvidence.length, missingEvidenceCount: evidence.length - validEvidence.length, changes, intervention: intervention ?? null };
  },
});

export const recalculateOpportunity = mutation({
  args: { opportunityId: v.id("opportunities"), impact: v.number(), frequency: v.number() },
  handler: async (ctx, args) => {
    const opportunity = await ctx.db.get(args.opportunityId);
    if (!opportunity) throw new Error("Opportunity not found");
    if (!Number.isInteger(args.impact) || args.impact < 1 || args.impact > 10 || !Number.isInteger(args.frequency) || args.frequency < 1 || args.frequency > 10) throw new Error("Impact and frequency must be whole numbers from 1 to 10.");
    const now = Date.now();
    if (args.impact !== opportunity.impact) await ctx.db.insert("opportunityChanges", { appId: opportunity.appId, auditRunId: opportunity.auditRunId, opportunityId: opportunity._id, field: "impact", changedBy: "Guest", previousValue: String(opportunity.impact), nextValue: String(args.impact), changedAt: now });
    if (args.frequency !== opportunity.frequency) await ctx.db.insert("opportunityChanges", { appId: opportunity.appId, auditRunId: opportunity.auditRunId, opportunityId: opportunity._id, field: "frequency", changedBy: "Guest", previousValue: String(opportunity.frequency), nextValue: String(args.frequency), changedAt: now });
    await ctx.db.patch(opportunity._id, { impact: args.impact, frequency: args.frequency, priorityScore: args.impact * opportunity.confidence * args.frequency * opportunity.trend, updatedAt: now });
  },
});

export const generateFix = mutation({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, args) => {
    const opportunity = await ctx.db.get(args.opportunityId);
    if (!opportunity) throw new Error("Opportunity not found");
    if (!opportunity.digiaAddressable) throw new Error("This problem is not marked Digia-addressable.");
    const audit = await ctx.db.get(opportunity.auditRunId);
    const evidence = await getValidEvidence(ctx, opportunity, audit ?? {});
    if (evidence.length < 2) throw new Error("At least two supporting reviews are required to generate a fix.");
    const current = await ctx.db.query("interventions").withIndex("by_opportunity", (q) => q.eq("opportunityId", args.opportunityId)).order("desc").first();
    if (current?.generationStatus === "running") return current._id;
    const interventionId = await ctx.db.insert("interventions", {
      appId: opportunity.appId,
      auditRunId: opportunity.auditRunId,
      opportunityId: opportunity._id,
      audience: "Pending generation",
      trigger: "Pending generation",
      experienceType: "Pending generation",
      suggestedCopy: "Pending generation",
      successMetric: "Pending generation",
      generationStatus: "running",
      generatedAt: Date.now(),
    });
    await ctx.scheduler.runAfter(0, internal.planner.run, { interventionId, opportunityId: opportunity._id });
    return interventionId;
  },
});

export const getPlannerInput = internalQuery({
  args: { opportunityId: v.id("opportunities") },
  handler: async (ctx, args) => {
    const opportunity = await ctx.db.get(args.opportunityId);
    if (!opportunity) throw new Error("Opportunity not found");
    const audit = await ctx.db.get(opportunity.auditRunId);
    const evidence = await getValidEvidence(ctx, opportunity, audit ?? {});
    return { opportunity, reviews: evidence.map(({ review }) => ({ reviewId: review._id, text: review.originalText, rating: review.rating, date: review.reviewDate ?? null })) };
  },
});

export const saveIntervention = internalMutation({
  args: {
    interventionId: v.id("interventions"),
    audience: v.string(),
    trigger: v.string(),
    experienceType: v.string(),
    suggestedCopy: v.string(),
    successMetric: v.string(),
  },
  handler: async (ctx, args) => {
    const { interventionId, ...fields } = args;
    await ctx.db.patch(interventionId, { ...fields, generationStatus: "complete", generatedAt: Date.now(), errorMessage: undefined });
  },
});

export const failIntervention = internalMutation({
  args: { interventionId: v.id("interventions"), message: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.interventionId, { generationStatus: "failed", errorMessage: args.message, generatedAt: Date.now() });
  },
});

export const getUsableReviewsPage = internalQuery({
  args: { auditRunId: v.id("auditRuns"), paginationOpts: paginationOptsValidator },
  handler: async (ctx, args) => {
    const observations = await ctx.db.query("reviewObservations").withIndex("by_audit_review", (q) => q.eq("auditRunId", args.auditRunId)).paginate(args.paginationOpts);
    const audit = await ctx.db.get(args.auditRunId);
    const reviews = await Promise.all(observations.page.map((observation) => ctx.db.get(observation.reviewId)));
    return { ...observations, page: reviews
      .filter((review): review is NonNullable<typeof review> => review !== null && review.qualityStatus === "usable" && isReviewInAnalysisWindow(review.reviewDate, audit ?? {}))
      .map((review) => ({ reviewId: review._id, text: review.originalText, rating: review.rating, date: review.reviewDate ?? null })) };
  },
});
