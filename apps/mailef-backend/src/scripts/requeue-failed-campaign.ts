/**
 * Requeue failed/stuck campaign recipients.
 *
 * Usage:
 *   npx ts-node src/scripts/requeue-failed-campaign.ts <campaignId>
 *   npx ts-node src/scripts/requeue-failed-campaign.ts <campaignId> --flush-quota
 *
 * What it does:
 *   1. Obliterates all failed/stalled BullMQ jobs for the campaign
 *   2. Resets failed + queued recipients back to pending
 *   3. Resets campaign stats (sent/failed) to match reality
 *   4. Optionally flushes Redis quota keys so rate limits don't block the retry
 */

import dotenv from "dotenv";
dotenv.config();

import mongoose from "mongoose";
import { Queue } from "bullmq";
import IORedis from "ioredis";

const MONGODB_URI = process.env.MONGODB_URI_PROD || process.env.MONGODB_URI || "";
const REDIS_URL = process.env.REDIS_URL || "redis://localhost:6379";

async function main() {
  const campaignId = process.argv[2];
  const flushQuota = process.argv.includes("--flush-quota");

  if (!campaignId || !mongoose.Types.ObjectId.isValid(campaignId)) {
    console.error("Usage: npx ts-node src/scripts/requeue-failed-campaign.ts <campaignId> [--flush-quota]");
    process.exit(1);
  }

  // ── Connect ────────────────────────────────────────────────────────────────
  await mongoose.connect(MONGODB_URI);
  console.log("Connected to MongoDB");

  const redis = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const queue = new Queue("mail-queue", { connection: redis });

  const db = mongoose.connection.db!;
  const campaignObjId = new mongoose.Types.ObjectId(campaignId);

  // ── 1. Check campaign exists ───────────────────────────────────────────────
  const campaign = await db.collection("campaigns").findOne(
    { _id: campaignObjId },
    { projection: { status: 1, stats: 1, userId: 1 } }
  );

  if (!campaign) {
    console.error(`Campaign ${campaignId} not found`);
    process.exit(1);
  }

  console.log(`Campaign status: ${campaign.status}`);
  console.log(`Campaign stats:`, campaign.stats);

  // ── 2. Recipient counts before ─────────────────────────────────────────────
  const before = await db.collection("campaignrecipients").aggregate([
    { $match: { campaignId: campaignObjId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]).toArray();
  console.log("Recipients before:", before);

  // ── 3. Obliterate BullMQ queue (clears all failed/stalled jobs) ────────────
  console.log("Obliterating BullMQ queue...");
  await queue.obliterate({ force: true });
  console.log("BullMQ queue cleared");

  // ── 4. Reset failed + queued recipients to pending ─────────────────────────
  const resetResult = await db.collection("campaignrecipients").updateMany(
    { campaignId: campaignObjId, status: { $in: ["failed", "queued"] } },
    { $set: { status: "pending", lastError: null, retryCount: 0 } }
  );
  console.log(`Reset ${resetResult.modifiedCount} recipients to pending`);

  // ── 5. Recalculate and fix campaign stats ──────────────────────────────────
  const sentCount = await db.collection("campaignrecipients").countDocuments({
    campaignId: campaignObjId,
    status: "sent",
  });

  await db.collection("campaigns").updateOne(
    { _id: campaignObjId },
    { $set: { "stats.sent": sentCount, "stats.failed": 0, status: "sending", pauseReason: null } }
  );
  console.log(`Campaign stats reset — sent: ${sentCount}, failed: 0, status: sending`);

  // ── 6. Optionally flush Redis quota keys ───────────────────────────────────
  if (flushQuota) {
    const userId = campaign.userId?.toString();
    const patterns = userId
      ? [`quota:user:${userId}:*`, "quota:global:*"]
      : ["quota:global:*"];

    let totalDeleted = 0;
    for (const pattern of patterns) {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
        totalDeleted += keys.length;
      }
    }
    console.log(`Flushed ${totalDeleted} Redis quota keys`);
  }

  // ── 7. Summary ─────────────────────────────────────────────────────────────
  const after = await db.collection("campaignrecipients").aggregate([
    { $match: { campaignId: campaignObjId } },
    { $group: { _id: "$status", count: { $sum: 1 } } },
  ]).toArray();
  console.log("Recipients after:", after);
  console.log("Done — the dispatcher will pick up pending recipients on the next tick.");

  await queue.close();
  redis.disconnect();
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
