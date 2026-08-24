import { Queue } from "bullmq";
import { redisConnection } from "../config/redis";
import { MailJobData } from "../types";

export const mailQueue = new Queue<MailJobData>("mail-queue", {
  connection: redisConnection,
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
