"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertUserRateLimits = exports.upsertGlobalRateLimits = exports.getRemainingSendAllowance = exports.getEffectiveRateLimits = exports.getUserRateLimits = exports.getGlobalRateLimits = exports.normalizeRateLimits = void 0;
const mongoose_1 = require("mongoose");
const CampaignRecipient_model_1 = __importDefault(require("../models/CampaignRecipient.model"));
const RateLimitPolicy_model_1 = __importDefault(require("../models/RateLimitPolicy.model"));
const sanitizeLimit = (value) => {
    if (value === undefined || value === null || value === "")
        return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed) || parsed <= 0)
        return undefined;
    return Math.floor(parsed);
};
const normalizeRateLimits = (payload) => {
    return {
        perMinute: sanitizeLimit(payload.perMinute),
        perHour: sanitizeLimit(payload.perHour),
        perDay: sanitizeLimit(payload.perDay),
    };
};
exports.normalizeRateLimits = normalizeRateLimits;
const combineLimit = (globalLimit, userLimit) => {
    if (globalLimit === undefined && userLimit === undefined)
        return undefined;
    if (globalLimit === undefined)
        return userLimit;
    if (userLimit === undefined)
        return globalLimit;
    return Math.min(globalLimit, userLimit);
};
const getGlobalRateLimits = async () => {
    const globalPolicy = await RateLimitPolicy_model_1.default.findOne({ scope: "global" }).lean();
    return {
        perMinute: globalPolicy?.perMinute,
        perHour: globalPolicy?.perHour,
        perDay: globalPolicy?.perDay,
    };
};
exports.getGlobalRateLimits = getGlobalRateLimits;
const getUserRateLimits = async (userId) => {
    const userPolicy = await RateLimitPolicy_model_1.default.findOne({ scope: "user", userId }).lean();
    return {
        perMinute: userPolicy?.perMinute,
        perHour: userPolicy?.perHour,
        perDay: userPolicy?.perDay,
    };
};
exports.getUserRateLimits = getUserRateLimits;
const getEffectiveRateLimits = async (userId) => {
    const [globalLimits, userLimits] = await Promise.all([
        (0, exports.getGlobalRateLimits)(),
        (0, exports.getUserRateLimits)(userId),
    ]);
    return {
        globalLimits,
        userLimits,
        effectiveLimits: {
            perMinute: combineLimit(globalLimits.perMinute, userLimits.perMinute),
            perHour: combineLimit(globalLimits.perHour, userLimits.perHour),
            perDay: combineLimit(globalLimits.perDay, userLimits.perDay),
        },
    };
};
exports.getEffectiveRateLimits = getEffectiveRateLimits;
const getWindowSentCounts = async (userId) => {
    const now = Date.now();
    const oneMinuteAgo = new Date(now - 60 * 1000);
    const oneHourAgo = new Date(now - 60 * 60 * 1000);
    const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const [perMinuteSent, perHourSent, perDaySent] = await Promise.all([
        CampaignRecipient_model_1.default.countDocuments({
            userId: new mongoose_1.Types.ObjectId(userId),
            status: "sent",
            sentAt: { $gte: oneMinuteAgo },
        }),
        CampaignRecipient_model_1.default.countDocuments({
            userId: new mongoose_1.Types.ObjectId(userId),
            status: "sent",
            sentAt: { $gte: oneHourAgo },
        }),
        CampaignRecipient_model_1.default.countDocuments({
            userId: new mongoose_1.Types.ObjectId(userId),
            status: "sent",
            sentAt: { $gte: oneDayAgo },
        }),
    ]);
    return {
        perMinuteSent,
        perHourSent,
        perDaySent,
    };
};
const getRemainingSendAllowance = async (userId) => {
    const [{ effectiveLimits }, sentInWindows] = await Promise.all([
        (0, exports.getEffectiveRateLimits)(userId),
        getWindowSentCounts(userId),
    ]);
    const remainingValues = [];
    if (effectiveLimits.perMinute !== undefined) {
        remainingValues.push(Math.max(effectiveLimits.perMinute - sentInWindows.perMinuteSent, 0));
    }
    if (effectiveLimits.perHour !== undefined) {
        remainingValues.push(Math.max(effectiveLimits.perHour - sentInWindows.perHourSent, 0));
    }
    if (effectiveLimits.perDay !== undefined) {
        remainingValues.push(Math.max(effectiveLimits.perDay - sentInWindows.perDaySent, 0));
    }
    return {
        remaining: remainingValues.length > 0 ? Math.min(...remainingValues) : null,
        effectiveLimits,
        sentInWindows,
    };
};
exports.getRemainingSendAllowance = getRemainingSendAllowance;
const upsertGlobalRateLimits = async (limits) => {
    const setFields = { scope: "global", userId: null };
    const unsetFields = {};
    if (limits.perMinute !== undefined)
        setFields.perMinute = limits.perMinute;
    else
        unsetFields.perMinute = "";
    if (limits.perHour !== undefined)
        setFields.perHour = limits.perHour;
    else
        unsetFields.perHour = "";
    if (limits.perDay !== undefined)
        setFields.perDay = limits.perDay;
    else
        unsetFields.perDay = "";
    const update = { $set: setFields };
    if (Object.keys(unsetFields).length > 0)
        update.$unset = unsetFields;
    const updated = await RateLimitPolicy_model_1.default.findOneAndUpdate({ scope: "global" }, update, { returnDocument: "after", upsert: true }).lean();
    return {
        perMinute: updated?.perMinute,
        perHour: updated?.perHour,
        perDay: updated?.perDay,
    };
};
exports.upsertGlobalRateLimits = upsertGlobalRateLimits;
const upsertUserRateLimits = async (userId, limits) => {
    const setFields = { scope: "user", userId };
    const unsetFields = {};
    if (limits.perMinute !== undefined)
        setFields.perMinute = limits.perMinute;
    else
        unsetFields.perMinute = "";
    if (limits.perHour !== undefined)
        setFields.perHour = limits.perHour;
    else
        unsetFields.perHour = "";
    if (limits.perDay !== undefined)
        setFields.perDay = limits.perDay;
    else
        unsetFields.perDay = "";
    const update = { $set: setFields };
    if (Object.keys(unsetFields).length > 0)
        update.$unset = unsetFields;
    const updated = await RateLimitPolicy_model_1.default.findOneAndUpdate({ scope: "user", userId }, update, { returnDocument: "after", upsert: true }).lean();
    return {
        perMinute: updated?.perMinute,
        perHour: updated?.perHour,
        perDay: updated?.perDay,
    };
};
exports.upsertUserRateLimits = upsertUserRateLimits;
//# sourceMappingURL=rate-limit.service.js.map