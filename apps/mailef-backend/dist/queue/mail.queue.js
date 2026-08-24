"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mailQueue = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
exports.mailQueue = new bullmq_1.Queue("mail-queue", {
    connection: redis_1.redisConnection,
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 4400, // 5s, 10s, 20s
        },
        removeOnComplete: { count: 1000 },
        removeOnFail: { count: 500 },
    },
});
//# sourceMappingURL=mail.queue.js.map