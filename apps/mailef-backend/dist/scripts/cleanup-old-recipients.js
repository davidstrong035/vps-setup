"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupOldRecipients = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const mongoose_1 = __importDefault(require("mongoose"));
const CampaignRecipient_model_1 = __importDefault(require("../models/CampaignRecipient.model"));
const Campaign_model_1 = __importDefault(require("../models/Campaign.model"));
dotenv_1.default.config();
const mongoUri = process.env.MONGODB_URI_PROD || process.env.MONGODB_URI || process.env.MONGODB_URI_DEV;
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
const CLEANUP_AGE_HOURS = Math.max(Number(process.env.CAMPAIGN_RECIPIENT_CLEANUP_AGE_HOURS) || 24, 1);
const DELETE_ENABLED = process.env.DELETE_RECIPIENTS_ON_COMPLETE !== "false";
const cleanupOldRecipients = async () => {
    if (!DELETE_ENABLED) {
        console.info("[cleanup-old-recipients] Skipped (DELETE_RECIPIENTS_ON_COMPLETE=false)");
        return;
    }
    console.info("[cleanup-old-recipients] Connecting to MongoDB...");
    await mongoose_1.default.connect(mongoUri, { autoIndex: false });
    try {
        // Find campaigns that were marked "sent" more than N hours ago
        const cutoffDate = new Date(Date.now() - CLEANUP_AGE_HOURS * 60 * 60 * 1000);
        const completedCampaigns = await Campaign_model_1.default.find({
            status: "sent",
            sentAt: { $lte: cutoffDate },
        })
            .select("_id name sentAt")
            .lean();
        console.info(`[cleanup-old-recipients] Found ${completedCampaigns.length} completed campaigns older than ${CLEANUP_AGE_HOURS}h`);
        for (const campaign of completedCampaigns) {
            const result = await CampaignRecipient_model_1.default.deleteMany({
                campaignId: campaign._id,
            });
            if (result.deletedCount > 0) {
                console.info(`[cleanup-old-recipients] Deleted ${result.deletedCount} recipients for campaign ${campaign._id} (${campaign.name})`);
            }
        }
        // Also clean up any orphaned recipient records (no parent campaign)
        // This handles recipients created during a campaign that was deleted
        const allCampaignIds = (await Campaign_model_1.default.find({}).select("_id").lean()).map((c) => c._id);
        const orphanedResult = await CampaignRecipient_model_1.default.deleteMany({
            campaignId: { $nin: allCampaignIds },
        });
        if (orphanedResult.deletedCount > 0) {
            console.info(`[cleanup-old-recipients] Deleted ${orphanedResult.deletedCount} orphaned recipient records (no parent campaign)`);
        }
        console.info("[cleanup-old-recipients] Done");
    }
    finally {
        await mongoose_1.default.disconnect();
    }
};
exports.cleanupOldRecipients = cleanupOldRecipients;
if (require.main === module) {
    (0, exports.cleanupOldRecipients)().catch((err) => {
        console.error(err instanceof Error ? err.message : String(err));
        process.exit(1);
    });
}
//# sourceMappingURL=cleanup-old-recipients.js.map