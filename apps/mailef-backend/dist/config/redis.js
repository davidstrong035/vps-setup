"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.redisConnection = void 0;
require("./env");
// Pass a plain config object so BullMQ uses its own bundled ioredis version
// and we avoid type-incompatibility between the two ioredis copies.
const rawRedisUrl = process.env.REDIS_URL || process.env.REDIS_HOST;
const buildRedisConnection = () => {
    if (rawRedisUrl && /^rediss?:\/\//.test(rawRedisUrl)) {
        const parsed = new URL(rawRedisUrl);
        return {
            host: parsed.hostname,
            port: Number(parsed.port) || 6379,
            username: parsed.username || undefined,
            password: parsed.password || undefined,
            tls: parsed.protocol === "rediss:" ? {} : undefined,
            maxRetriesPerRequest: null,
        };
    }
    return {
        host: process.env.REDIS_HOST || "localhost",
        port: Number(process.env.REDIS_PORT) || 6379,
        username: process.env.REDIS_USERNAME || undefined,
        password: process.env.REDIS_PASSWORD || undefined,
        tls: process.env.REDIS_TLS === "true" ? {} : undefined,
        maxRetriesPerRequest: null,
    };
};
exports.redisConnection = buildRedisConnection();
//# sourceMappingURL=redis.js.map