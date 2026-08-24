import dotenv from "dotenv";
import mongoose from "mongoose";
import CampaignRecipient from "../models/CampaignRecipient.model";
import Campaign from "../models/Campaign.model";

dotenv.config();

const mongoUri =
  process.env.MONGODB_URI_PROD || process.env.MONGODB_URI || process.env.MONGODB_URI_DEV;

if (!mongoUri) {
  console.error("Missing MongoDB URI. Set MONGODB_URI_PROD, MONGODB_URI or MONGODB_URI_DEV.");
  process.exit(1);
}

/**
 * Safety-net cleanup script that deletes CampaignRecipient records for campaigns
 * that have already completed (status "sent") but whose recipient records were not
 * cleaned up (e.g., due to a server restart mid-cleanup).
 *
 * This handles edge cases where the automatic cleanup in finalizeDispatchResult
 * or the mail worker was skipped.
 *
 * Configure via env vars:
 *   CAMPAIGN_RECIPIENT_CLEANUP_AGE_HOURS  - delete recipients for campaigns
 *                                            completed more than N hours ago (default: 24)
 *   DELETE_RECIPIENTS_ON_COMPLETE          - set to "false" to skip all cleanup
 */
const CLEANUP_AGE_HOURS = Math.max(
  Number(process.env.CAMPAIGN_RECIPIENT_CLEANUP_AGE_HOURS) || 24,
  1,
);

const DELETE_ENABLED = process.env.DELETE_RECIPIENTS_ON_COMPLETE !== "false";

export const cleanupOldRecipients = async (): Promise<void> => {
  if (!DELETE_ENABLED) {
    console.info("[cleanup-old-recipients] Skipped (DELETE_RECIPIENTS_ON_COMPLETE=false)");
    return;
  }

  console.info("[cleanup-old-recipients] Connecting to MongoDB...");
  await mongoose.connect(mongoUri, { autoIndex: false });

  try {
    // Find campaigns that were marked "sent" more than N hours ago
    const cutoffDate = new Date(Date.now() - CLEANUP_AGE_HOURS * 60 * 60 * 1000);

    const completedCampaigns = await Campaign.find({
      status: "sent",
      sentAt: { $lte: cutoffDate },
    })
      .select("_id name sentAt")
      .lean();

    console.info(
      `[cleanup-old-recipients] Found ${completedCampaigns.length} completed campaigns older than ${CLEANUP_AGE_HOURS}h`,
    );

    for (const campaign of completedCampaigns) {
      const result = await CampaignRecipient.deleteMany({
        campaignId: campaign._id,
      });

      if (result.deletedCount > 0) {
        console.info(
          `[cleanup-old-recipients] Deleted ${result.deletedCount} recipients for campaign ${campaign._id} (${campaign.name})`,
        );
      }
    }

    // Also clean up any orphaned recipient records (no parent campaign)
    // This handles recipients created during a campaign that was deleted
    const allCampaignIds = (
      await Campaign.find({}).select("_id").lean()
    ).map((c) => c._id);

    const orphanedResult = await CampaignRecipient.deleteMany({
      campaignId: { $nin: allCampaignIds },
    });

    if (orphanedResult.deletedCount > 0) {
      console.info(
        `[cleanup-old-recipients] Deleted ${orphanedResult.deletedCount} orphaned recipient records (no parent campaign)`,
      );
    }

    console.info("[cleanup-old-recipients] Done");
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  cleanupOldRecipients().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}