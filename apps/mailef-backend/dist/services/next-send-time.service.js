"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getNextAllowedSendTime = getNextAllowedSendTime;
const mongoose_1 = require("mongoose");
const CampaignRecipient_model_1 = __importDefault(require("../models/CampaignRecipient.model"));
const rate_limit_service_1 = require("./rate-limit.service");
/**
 * Returns the soonest Date when the user will be allowed to send again, or null if not rate-limited.
 */
async function getNextAllowedSendTime(userId) {
    const { effectiveLimits } = await (0, rate_limit_service_1.getEffectiveRateLimits)(userId);
    const now = new Date();
    const windows = [
        { limit: effectiveLimits.perMinute, ms: 60 * 1000 },
        { limit: effectiveLimits.perHour, ms: 60 * 60 * 1000 },
        { limit: effectiveLimits.perDay, ms: 24 * 60 * 60 * 1000 },
    ];
    let soonest = null;
    for (const { limit, ms } of windows) {
        if (!limit)
            continue;
        // Find the Nth most recent sent message in this window
        const since = new Date(now.getTime() - ms);
        const recents = await CampaignRecipient_model_1.default.find({
            userId: new mongoose_1.Types.ObjectId(userId),
            status: "sent",
            sentAt: { $gte: since },
        })
            .sort({ sentAt: 1 })
            .select("sentAt")
            .lean();
        const sentAt = recents[0]?.sentAt ? new Date(recents[0].sentAt) : null;
        if (recents.length >= limit && sentAt) {
            // The earliest sentAt in the window + window size is when the user can send again
            const next = new Date(sentAt.getTime() + ms);
            if (!soonest || next < soonest)
                soonest = next;
        }
    }
    return soonest;
}
//# sourceMappingURL=next-send-time.service.js.map