"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupCampaignRecipients = cleanupCampaignRecipients;
const CampaignRecipient_model_1 = __importDefault(require("../models/CampaignRecipient.model"));
const logger_1 = require("../utils/logger");
/**
 * Whether to delete CampaignRecipient records when a campaign completes.
 * Set to "false" to keep records for debugging/history.
 * Defaults to "true" to conserve MongoDB storage (especially on free tier).
 */
const DELETE_ON_COMPLETE = process.env.DELETE_RECIPIENTS_ON_COMPLETE !== "false";
/**
 * Deletes all CampaignRecipient records for a given campaign.
 * This is called when a campaign reaches "sent" status to free up MongoDB storage.
 *
 * The campaign's aggregated stats (stats.sent, stats.failed, stats.total)
 * are preserved on the Campaign document itself.
 * Failed email details are preserved in the BullMQ dead letter queue (Redis).
 */
async function cleanupCampaignRecipients(campaignId) {
    if (!DELETE_ON_COMPLETE) {
        logger_1.logger.debug("[cleanup] Skipping recipient cleanup (DELETE_RECIPIENTS_ON_COMPLETE=false)", {
            campaignId,
        });
        return;
    }
    try {
        const result = await CampaignRecipient_model_1.default.deleteMany({ campaignId });
        logger_1.logger.info("[cleanup] Deleted campaign recipient records", {
            campaignId,
            deletedCount: result.deletedCount,
        });
    }
    catch (error) {
        logger_1.logger.error("[cleanup] Failed to delete campaign recipient records", {
            campaignId,
            error: error instanceof Error ? error.message : String(error),
        });
    }
}
//# sourceMappingURL=cleanup-recipients.service.js.map