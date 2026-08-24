"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startScheduledCampaignDispatcher = void 0;
const Campaign_model_1 = __importDefault(require("../models/Campaign.model"));
const campaign_dispatch_service_1 = require("./campaign-dispatch.service");
const audit_log_service_1 = require("./audit-log.service");
const logger_1 = require("../utils/logger");
let schedulerTimer = null;
let isDispatching = false;
const dispatchDueCampaigns = async () => {
    if (isDispatching)
        return;
    isDispatching = true;
    try {
        const dueCampaigns = await Campaign_model_1.default.find({
            status: "scheduled",
            scheduledAt: { $lte: new Date() },
        })
            .sort({ scheduledAt: 1 })
            .limit(20);
        for (const campaign of dueCampaigns) {
            try {
                const result = await (0, campaign_dispatch_service_1.dispatchCampaign)(campaign);
                if (result.totalActiveSubscribers === 0) {
                    await Campaign_model_1.default.findByIdAndUpdate(campaign._id, {
                        $set: {
                            status: "paused",
                            pauseReason: "Campaign paused because the selected list has no active subscribers.",
                        },
                    });
                    await (0, audit_log_service_1.logAuditEvent)({
                        actorType: "system",
                        action: "campaign.scheduled_dispatch",
                        resourceType: "campaign",
                        resourceId: campaign._id.toString(),
                        targetUserId: campaign.userId.toString(),
                        status: "failure",
                        metadata: { reason: "no_active_subscribers" },
                    });
                    logger_1.logger.warn("Scheduled campaign has no active subscribers", {
                        campaignId: campaign._id.toString(),
                        userId: campaign.userId.toString(),
                    });
                    continue;
                }
                await (0, audit_log_service_1.logAuditEvent)({
                    actorType: "system",
                    action: "campaign.scheduled_dispatch",
                    resourceType: "campaign",
                    resourceId: campaign._id.toString(),
                    targetUserId: campaign.userId.toString(),
                    status: "success",
                    metadata: {
                        queued: result.queued,
                        rateLimited: result.rateLimited,
                        remainingAllowance: result.remainingAllowance,
                    },
                });
                logger_1.logger.info("Scheduled campaign dispatch completed", {
                    campaignId: campaign._id.toString(),
                    queued: result.queued,
                    rateLimited: result.rateLimited,
                    remainingAllowance: result.remainingAllowance,
                });
            }
            catch (error) {
                await (0, audit_log_service_1.logAuditEvent)({
                    actorType: "system",
                    action: "campaign.scheduled_dispatch",
                    resourceType: "campaign",
                    resourceId: campaign._id.toString(),
                    targetUserId: campaign.userId.toString(),
                    status: "failure",
                    metadata: {
                        reason: "dispatch_error",
                        error: error instanceof Error ? error.message : String(error),
                    },
                });
                logger_1.logger.error("Failed to dispatch scheduled campaign", {
                    campaignId: campaign._id.toString(),
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }
    finally {
        isDispatching = false;
    }
};
const startScheduledCampaignDispatcher = () => {
    if (schedulerTimer)
        return;
    const intervalMs = Math.max(Number(process.env.SCHEDULED_DISPATCH_INTERVAL_MS) || 30000, 5000);
    schedulerTimer = setInterval(() => {
        dispatchDueCampaigns().catch((error) => {
            logger_1.logger.error("Scheduled campaign dispatcher tick failed", {
                error: error instanceof Error ? error.message : String(error),
            });
        });
    }, intervalMs);
    dispatchDueCampaigns().catch((error) => {
        logger_1.logger.error("Initial scheduled campaign dispatch failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    });
};
exports.startScheduledCampaignDispatcher = startScheduledCampaignDispatcher;
//# sourceMappingURL=scheduled-campaign-dispatcher.service.js.map