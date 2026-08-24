"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getGlobalQuotaUsage = void 0;
const redis_client_1 = require("../config/redis-client");
const rate_limit_service_1 = require("./rate-limit.service");
const pad2 = (value) => value.toString().padStart(2, "0");
const getUtcWindowTokens = (nowMs) => {
    const nowDate = new Date(nowMs);
    const year = nowDate.getUTCFullYear();
    const month = pad2(nowDate.getUTCMonth() + 1);
    const day = pad2(nowDate.getUTCDate());
    const hour = pad2(nowDate.getUTCHours());
    const minute = pad2(nowDate.getUTCMinutes());
    return {
        minute: `${year}${month}${day}${hour}${minute}`,
        hour: `${year}${month}${day}${hour}`,
        day: `${year}${month}${day}`,
    };
};
const getGlobalQuotaUsage = async () => {
    const limits = await (0, rate_limit_service_1.getGlobalRateLimits)();
    const windows = getUtcWindowTokens(Date.now());
    const redis = (0, redis_client_1.getRedisClient)();
    const [minuteUsed, hourUsed, dayUsed] = await Promise.all([
        limits.perMinute !== undefined
            ? redis.get(`quota:global:minute:${windows.minute}`).then((v) => Number(v) || 0)
            : Promise.resolve(0),
        limits.perHour !== undefined
            ? redis.get(`quota:global:hour:${windows.hour}`).then((v) => Number(v) || 0)
            : Promise.resolve(0),
        limits.perDay !== undefined
            ? redis.get(`quota:global:day:${windows.day}`).then((v) => Number(v) || 0)
            : Promise.resolve(0),
    ]);
    return {
        perMinute: {
            limit: limits.perMinute,
            used: minuteUsed,
            remaining: limits.perMinute !== undefined ? Math.max(limits.perMinute - minuteUsed, 0) : Infinity,
        },
        perHour: {
            limit: limits.perHour,
            used: hourUsed,
            remaining: limits.perHour !== undefined ? Math.max(limits.perHour - hourUsed, 0) : Infinity,
        },
        perDay: {
            limit: limits.perDay,
            used: dayUsed,
            remaining: limits.perDay !== undefined ? Math.max(limits.perDay - dayUsed, 0) : Infinity,
        },
    };
};
exports.getGlobalQuotaUsage = getGlobalQuotaUsage;
//# sourceMappingURL=global-quota-usage.service.js.map