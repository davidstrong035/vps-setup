"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.cleanupQuotaKeys = void 0;
const dotenv_1 = __importDefault(require("dotenv"));
const redis_client_1 = require("../config/redis-client");
const logger_1 = require("../utils/logger");
dotenv_1.default.config();
const MAX_COUNT_PER_SCAN = 200;
const TTL_SKEW_TOLERANCE_MS = 60000;
const getCurrentUtcTokens = (nowMs) => {
    const now = new Date(nowMs);
    const yyyy = now.getUTCFullYear().toString();
    const mm = (now.getUTCMonth() + 1).toString().padStart(2, "0");
    const dd = now.getUTCDate().toString().padStart(2, "0");
    const hh = now.getUTCHours().toString().padStart(2, "0");
    const mi = now.getUTCMinutes().toString().padStart(2, "0");
    return {
        minute: `${yyyy}${mm}${dd}${hh}${mi}`,
        hour: `${yyyy}${mm}${dd}${hh}`,
        day: `${yyyy}${mm}${dd}`,
    };
};
const getExpectedTtlMs = (window, nowMs) => {
    if (window === "minute")
        return 60000 - (nowMs % 60000) + 1000;
    if (window === "hour")
        return 3600000 - (nowMs % 3600000) + 1000;
    const now = new Date(nowMs);
    const dayStartUtcMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return dayStartUtcMs + 86400000 - nowMs + 1000;
};
const parseQuotaKey = (key) => {
    const globalMatch = key.match(/^quota:global:(minute|hour|day):(\d+)$/);
    if (globalMatch) {
        return {
            window: globalMatch[1],
            token: globalMatch[2],
        };
    }
    const userMatch = key.match(/^quota:user:[^:]+:(minute|hour|day):(\d+)$/);
    if (userMatch) {
        return {
            window: userMatch[1],
            token: userMatch[2],
        };
    }
    return null;
};
const scanQuotaKeys = async (redis) => {
    let cursor = "0";
    const keys = [];
    do {
        const [nextCursor, batch] = await redis.scan(cursor, "MATCH", "quota:*", "COUNT", MAX_COUNT_PER_SCAN);
        cursor = nextCursor;
        keys.push(...batch);
    } while (cursor !== "0");
    return keys;
};
const cleanupQuotaKeys = async () => {
    const redis = (0, redis_client_1.getRedisClient)();
    const nowMs = Date.now();
    const currentTokens = getCurrentUtcTokens(nowMs);
    const keys = await scanQuotaKeys(redis);
    let deleted = 0;
    let ttlRepaired = 0;
    let skipped = 0;
    for (const key of keys) {
        const parsed = parseQuotaKey(key);
        if (!parsed) {
            skipped += 1;
            continue;
        }
        const expectedToken = currentTokens[parsed.window];
        if (parsed.token !== expectedToken) {
            await redis.del(key);
            deleted += 1;
            logger_1.logger.info("Deleted stale quota key from previous window", { key });
            continue;
        }
        const ttlMs = await redis.pttl(key);
        // -2: key disappeared between scan and check
        if (ttlMs === -2) {
            continue;
        }
        // -1: no expiry (dangerous for quota keys)
        if (ttlMs === -1) {
            await redis.del(key);
            deleted += 1;
            logger_1.logger.info("Deleted quota key with missing expiry", { key });
            continue;
        }
        const expectedTtlMs = getExpectedTtlMs(parsed.window, nowMs);
        if (ttlMs > expectedTtlMs + TTL_SKEW_TOLERANCE_MS) {
            await redis.pexpire(key, expectedTtlMs);
            ttlRepaired += 1;
            logger_1.logger.info("Repaired abnormally long quota key TTL", {
                key,
                ttlMs,
                expectedTtlMs,
            });
        }
    }
    logger_1.logger.info("Quota cleanup complete", { deleted, ttlRepaired, skipped, scanned: keys.length });
};
exports.cleanupQuotaKeys = cleanupQuotaKeys;
if (require.main === module) {
    (0, exports.cleanupQuotaKeys)()
        .then(() => process.exit(0))
        .catch((err) => {
        console.error("Quota cleanup failed:", err);
        logger_1.logger.error("Quota cleanup failed", {
            error: err instanceof Error ? err.message : String(err),
        });
        process.exit(1);
    });
}
//# sourceMappingURL=cleanup-redis-quotas.js.map