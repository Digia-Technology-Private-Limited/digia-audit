import { mutation, query } from "./_generated/server";
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

    return await ctx.db.insert("auditRuns", {
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
      currentStage: "validating",
      updatedAt: now,
    });
  },
});

export const get = query({
  args: { auditRunId: v.id("auditRuns") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.auditRunId);
  },
});
