"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startActiveCampaignDispatcher = void 0;
const uuid_1 = require("uuid");
const Campaign_model_1 = __importDefault(require("../models/Campaign.model"));
const redis_client_1 = require("../config/redis-client");
const campaign_dispatch_service_1 = require("./campaign-dispatch.service");
const email_allocation_service_1 = require("./email-allocation.service");
const platform_settings_service_1 = require("./platform-settings.service");
const logger_1 = require("../utils/logger");
let dispatcherTimer = null;
let isDispatching = false;
const LOCK_KEY = "lock:active-campaign-dispatch";
const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;
const takeDispatchLock = async (ttlMs) => {
    const token = (0, uuid_1.v4)();
    const redis = (0, redis_client_1.getRedisClient)();
    const result = await redis.set(LOCK_KEY, token, "PX", ttlMs, "NX");
    if (result !== "OK") {
        return null;
    }
    return { token };
};
const releaseDispatchLock = async (token) => {
    const redis = (0, redis_client_1.getRedisClient)();
    await redis.eval(RELEASE_LOCK_SCRIPT, 1, LOCK_KEY, token);
};
const getEligibleCampaignsByUser = async (usersPerTick) => {
    const pausedReasonsToResume = [
        "Campaign paused because your current send limit has been reached. Try again after the limit resets.",
        "Campaign paused because your email package has no remaining credits.",
    ];
    const candidates = await Campaign_model_1.default.find({
        $or: [
            { status: "sending" },
            {
                status: "paused",
                pauseReason: { $in: pausedReasonsToResume },
            },
        ],
    })
        .sort({ updatedAt: 1 })
        .limit(usersPerTick * 8);
    const selectedByUser = new Map();
    for (const campaign of candidates) {
        const userId = campaign.userId.toString();
        if (!selectedByUser.has(userId)) {
            selectedByUser.set(userId, campaign);
        }
        if (selectedByUser.size >= usersPerTick) {
            break;
        }
    }
    return [...selectedByUser.values()];
};
const filterPayableReadyCampaigns = async (campaigns) => {
    const eligible = [];
    for (const campaign of campaigns) {
        const activeAllocation = await (0, email_allocation_service_1.getActiveEmailAllocation)(campaign.userId.toString());
        const remainingCredits = activeAllocation
            ? Math.max(activeAllocation.emailsPurchased -
                activeAllocation.consumedEmails -
                activeAllocation.reservedEmails, 0)
            : 0;
        if (activeAllocation && remainingCredits > 0) {
            eligible.push(campaign);
            continue;
        }
        await Campaign_model_1.default.findByIdAndUpdate(campaign._id, {
            $set: {
                status: "paused",
                pauseReason: "Campaign paused because your email package has no remaining credits.",
            },
        });
    }
    return eligible;
};
const dispatchActiveCampaigns = async () => {
    if (isDispatching)
        return;
    isDispatching = true;
    const dispatchSettings = await (0, platform_settings_service_1.getPlatformDispatchSettings)();
    if (!dispatchSettings.enabled) {
        isDispatching = false;
        return;
    }
    const lock = await takeDispatchLock(Math.max(dispatchSettings.intervalMs - 250, 1000));
    if (!lock) {
        isDispatching = false;
        return;
    }
    try {
        const campaigns = await getEligibleCampaignsByUser(dispatchSettings.usersPerTick);
        const payableCampaigns = await filterPayableReadyCampaigns(campaigns);
        for (const campaign of payableCampaigns) {
            try {
                // If campaign was previously paused for quota/rate-limit, log resumption
                if (campaign.status === "paused" &&
                    [
                        "Campaign paused because your current send limit has been reached. Try again after the limit resets.",
                        "Campaign paused because your email package has no remaining credits."
                    ].includes(campaign.pauseReason ?? "")) {
                    logger_1.logger.info("Automatically resuming campaign after quota/rate-limit reset", {
                        campaignId: campaign._id.toString(),
                        userId: campaign.userId.toString(),
                        previousPauseReason: campaign.pauseReason,
                    });
                }
                const result = await (0, campaign_dispatch_service_1.dispatchCampaign)(campaign);
                logger_1.logger.info("Active campaign dispatch tick completed", {
                    campaignId: campaign._id.toString(),
                    userId: campaign.userId.toString(),
                    queued: result.queued,
                    rateLimited: result.rateLimited,
                    creditLimited: result.creditLimited,
                    alreadyCompleted: result.alreadyCompleted,
                });
            }
            catch (error) {
                logger_1.logger.error("Active campaign dispatch failed", {
                    campaignId: campaign._id.toString(),
                    userId: campaign.userId.toString(),
                    error: error instanceof Error ? error.message : String(error),
                });
            }
        }
    }
    finally {
        await releaseDispatchLock(lock.token).catch(() => {
            // no-op; lock expires automatically
        });
        isDispatching = false;
    }
};
const startActiveCampaignDispatcher = () => {
    if (dispatcherTimer)
        return;
    const scheduleNextTick = async () => {
        let delayMs = 5000;
        try {
            const settings = await (0, platform_settings_service_1.getPlatformDispatchSettings)();
            delayMs = settings.intervalMs;
        }
        catch (error) {
            logger_1.logger.error("Failed to resolve active dispatcher interval", {
                error: error instanceof Error ? error.message : String(error),
            });
        }
        dispatcherTimer = setTimeout(() => {
            dispatchActiveCampaigns().catch((error) => {
                logger_1.logger.error("Active campaign dispatcher tick failed", {
                    error: error instanceof Error ? error.message : String(error),
                });
            }).finally(() => {
                scheduleNextTick().catch((scheduleError) => {
                    logger_1.logger.error("Failed to schedule next active dispatch tick", {
                        error: scheduleError instanceof Error ? scheduleError.message : String(scheduleError),
                    });
                });
            });
        }, delayMs);
    };
    scheduleNextTick().catch((error) => {
        logger_1.logger.error("Failed to start active campaign dispatcher", {
            error: error instanceof Error ? error.message : String(error),
        });
    });
    dispatchActiveCampaigns().catch((error) => {
        logger_1.logger.error("Initial active campaign dispatch failed", {
            error: error instanceof Error ? error.message : String(error),
        });
    });
};
exports.startActiveCampaignDispatcher = startActiveCampaignDispatcher;
//# sourceMappingURL=active-campaign-dispatcher.service.js.map