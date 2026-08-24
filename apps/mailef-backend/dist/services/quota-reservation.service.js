"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.reserveDispatchQuota = void 0;
const redis_client_1 = require("../config/redis-client");
const QUOTA_RESERVE_SCRIPT = `
local requested = tonumber(ARGV[1])
if (not requested) or requested <= 0 then
  return 0
end

local allowed = requested

for i, key in ipairs(KEYS) do
  local argIndex = 2 + (i - 1) * 2
  local limit = tonumber(ARGV[argIndex])

  if limit and limit > 0 then
    local current = tonumber(redis.call('GET', key) or '0')
    local remaining = limit - current

    if remaining < allowed then
      allowed = remaining
    end
  end
end

if allowed <= 0 then
  return 0
end

for i, key in ipairs(KEYS) do
  local ttlArgIndex = 3 + (i - 1) * 2
  local ttlMs = tonumber(ARGV[ttlArgIndex])
  local newValue = redis.call('INCRBY', key, allowed)

  if newValue == allowed and ttlMs and ttlMs > 0 then
    redis.call('PEXPIRE', key, ttlMs)
  elseif ttlMs and ttlMs > 0 then
    local currentTtl = redis.call('PTTL', key)

    -- Repair missing or clearly invalid TTL to avoid stale quota blocks.
    if (not currentTtl) or currentTtl < 0 or currentTtl > (ttlMs + 60000) then
      redis.call('PEXPIRE', key, ttlMs)
    end
  end
end

return allowed
`;
const pad2 = (value) => value.toString().padStart(2, "0");
const getUtcWindowTokens = (nowMs) => {
    const nowDate = new Date(nowMs);
    const year = nowDate.getUTCFullYear();
    const month = pad2(nowDate.getUTCMonth() + 1);
    const day = pad2(nowDate.getUTCDate());
    const hour = pad2(nowDate.getUTCHours());
    const minute = pad2(nowDate.getUTCMinutes());
    const minuteToken = `${year}${month}${day}${hour}${minute}`;
    const hourToken = `${year}${month}${day}${hour}`;
    const dayToken = `${year}${month}${day}`;
    const minuteTtlMs = 60000 - (nowMs % 60000) + 1000;
    const hourTtlMs = 3600000 - (nowMs % 3600000) + 1000;
    const dayStartUtcMs = Date.UTC(nowDate.getUTCFullYear(), nowDate.getUTCMonth(), nowDate.getUTCDate());
    const dayTtlMs = dayStartUtcMs + 86400000 - nowMs + 1000;
    return {
        minute: { token: minuteToken, ttlMs: minuteTtlMs },
        hour: { token: hourToken, ttlMs: hourTtlMs },
        day: { token: dayToken, ttlMs: dayTtlMs },
    };
};
const buildQuotaKeys = (userId, limits, nowMs) => {
    const windows = getUtcWindowTokens(nowMs);
    const keys = [];
    const args = [];
    // Global-level keys act as a shared pool across ALL users.
    // For example, if globalLimits.perDay = 40, then all users combined
    // can only send 40 emails in that day — regardless of how many users exist.
    if (limits.globalLimits.perMinute !== undefined) {
        keys.push(`quota:global:minute:${windows.minute.token}`);
        args.push(limits.globalLimits.perMinute, windows.minute.ttlMs);
    }
    if (limits.globalLimits.perHour !== undefined) {
        keys.push(`quota:global:hour:${windows.hour.token}`);
        args.push(limits.globalLimits.perHour, windows.hour.ttlMs);
    }
    if (limits.globalLimits.perDay !== undefined) {
        keys.push(`quota:global:day:${windows.day.token}`);
        args.push(limits.globalLimits.perDay, windows.day.ttlMs);
    }
    // Per-user keys act as a user-specific cap (stricter of global & user limits).
    // These are combined with the global keys above, so the more restrictive
    // of the two always wins.
    if (limits.effectiveUserLimits.perMinute !== undefined) {
        keys.push(`quota:user:${userId}:minute:${windows.minute.token}`);
        args.push(limits.effectiveUserLimits.perMinute, windows.minute.ttlMs);
    }
    if (limits.effectiveUserLimits.perHour !== undefined) {
        keys.push(`quota:user:${userId}:hour:${windows.hour.token}`);
        args.push(limits.effectiveUserLimits.perHour, windows.hour.ttlMs);
    }
    if (limits.effectiveUserLimits.perDay !== undefined) {
        keys.push(`quota:user:${userId}:day:${windows.day.token}`);
        args.push(limits.effectiveUserLimits.perDay, windows.day.ttlMs);
    }
    return { keys, args };
};
const reserveDispatchQuota = async (userId, requested, limits) => {
    const safeRequested = Math.max(Math.floor(requested), 0);
    if (safeRequested <= 0)
        return 0;
    const { keys, args } = buildQuotaKeys(userId, limits, Date.now());
    if (keys.length === 0) {
        return safeRequested;
    }
    const redis = (0, redis_client_1.getRedisClient)();
    const result = await redis.eval(QUOTA_RESERVE_SCRIPT, keys.length, ...keys, safeRequested, ...args);
    const granted = Number(result);
    if (!Number.isFinite(granted) || granted <= 0) {
        return 0;
    }
    return Math.min(granted, safeRequested);
};
exports.reserveDispatchQuota = reserveDispatchQuota;
//# sourceMappingURL=quota-reservation.service.js.map