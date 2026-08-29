import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";

export const create = mutation({
  args: {
    sourceUrl: v.string(),
    packageId: v.string(),
  },
  handler: async (ctx, args) => {
    const now = Date.now();
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
    await ctx.db.patch(args.auditRunId, {
      status: "running",
      scrapeStatus: "pending",
      analysisStatus: "pending",
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

    const observedReviewIds = [];
    for (const review of args.reviews) {
      const existing = await ctx.db
        .query("reviews")
        .withIndex("by_app_source_review", (q) => q.eq("appId", args.appId).eq("source", "googlePlay").eq("sourceReviewId", review.sourceReviewId))
        .unique();
      const reviewId = existing?._id ?? await ctx.db.insert("reviews", {
        appId: args.appId,
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
      observedReviewIds.push(reviewId);
    }

    for (const reviewId of observedReviewIds) {
      const existingObservation = await ctx.db
        .query("reviewObservations")
        .withIndex("by_audit_review", (q) => q.eq("auditRunId", args.auditRunId).eq("reviewId", reviewId))
        .unique();
      if (!existingObservation) {
        await ctx.db.insert("reviewObservations", { auditRunId: args.auditRunId, reviewId, observedAt: now });
      }
    }

    const reviewCount = args.reviews.length;
    const usableReviewCount = args.reviews.filter((review) => review.qualityStatus === "usable").length;
    await ctx.db.patch(args.auditRunId, {
      scrapeStatus: args.scrapeStatus,
      currentStage: "filtering",
      reviewCount,
      usableReviewCount,
      skippedReviewCount: args.skippedReviewCount,
      lowQualityReviewCount: args.lowQualityReviewCount,
      scrapeWarning: args.warning,
      updatedAt: now,
    });
    if (usableReviewCount > 0) {
      await ctx.scheduler.runAfter(0, internal.researcher.run, { auditRunId: args.auditRunId, appId: args.appId });
    }
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
    const observations = await ctx.db.query("reviewObservations").withIndex("by_audit_review", (q) => q.eq("auditRunId", args.auditRunId)).collect();
    const observedIds = new Set(observations.map((observation) => observation.reviewId));
    for (const candidate of args.candidates) {
      const evidenceReviewIds = [...new Set(candidate.evidenceReviewIds)]
        .filter((reviewId) => observedIds.has(reviewId as Id<"reviews">))
        .map((reviewId) => reviewId as Id<"reviews">);
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
    return await Promise.all(candidates.map(async (candidate) => ({
      candidateId: candidate._id,
      problemStatement: candidate.problemStatement,
      evidence: (await Promise.all(candidate.evidenceReviewIds.map((reviewId) => ctx.db.get(reviewId)))).filter((review): review is NonNullable<typeof review> => review !== null).map((review) => ({ reviewId: review._id, text: review.originalText, rating: review.rating, date: review.reviewDate ?? null })),
      category: candidate.category,
      supportingSignalCount: candidate.supportingSignalCount,
      researcherConfidence: candidate.confidence,
    })));
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
    const observedIds = new Set(observations.map((observation) => observation.reviewId));
    const now = Date.now();
    for (const opportunity of args.opportunities) {
      const evidenceReviewIds = [...new Set(opportunity.evidenceReviewIds)]
        .filter((reviewId) => observedIds.has(reviewId as Id<"reviews">))
        .map((reviewId) => reviewId as Id<"reviews">);
      if (!opportunity.problemStatement.trim() || evidenceReviewIds.length === 0) continue;
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
    await ctx.db.patch(args.auditRunId, { currentStage: "ranking", updatedAt: now });
  },
});

export const saveAnalysisFailure = internalMutation({
  args: { auditRunId: v.id("auditRuns"), message: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.auditRunId, { analysisStatus: "failed", status: "failed", analysisError: args.message, updatedAt: Date.now() });
  },
});

export const saveScrapeFailure = internalMutation({
  args: { auditRunId: v.id("auditRuns"), message: v.string() },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.auditRunId, {
      status: "failed",
      scrapeStatus: "failed",
      currentStage: "collecting",
      scrapeError: args.message,
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
    const observations = await ctx.db.query("reviewObservations").withIndex("by_audit_review", (q) => q.eq("auditRunId", args.auditRunId)).collect();
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
    return await Promise.all(opportunities.map(async (opportunity) => ({
      ...opportunity,
      evidenceCount: (await ctx.db.query("evidence").withIndex("by_opportunity", (q) => q.eq("opportunityId", opportunity._id)).collect()).length,
    })));
  },
});

export const getUsableReviews = internalQuery({
  args: { auditRunId: v.id("auditRuns") },
  handler: async (ctx, args) => {
    const observations = await ctx.db.query("reviewObservations").withIndex("by_audit_review", (q) => q.eq("auditRunId", args.auditRunId)).collect();
    const reviews = await Promise.all(observations.map((observation) => ctx.db.get(observation.reviewId)));
    return reviews.filter((review): review is NonNullable<typeof review> => review !== null && review.qualityStatus === "usable").map((review) => ({ reviewId: review._id, text: review.originalText, rating: review.rating, date: review.reviewDate ?? null }));
  },
});
