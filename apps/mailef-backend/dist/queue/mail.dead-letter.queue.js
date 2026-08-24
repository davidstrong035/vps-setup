"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.mailDeadLetterQueue = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
exports.mailDeadLetterQueue = new bullmq_1.Queue("mail-dead-letter-queue", {
    connection: redis_1.redisConnection,
    defaultJobOptions: {
        removeOnComplete: false,
        removeOnFail: false,
    },
});
//# sourceMappingURL=mail.dead-letter.queue.js.map