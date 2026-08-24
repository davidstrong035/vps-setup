import { Queue } from "bullmq";
import { redisConnection } from "../config/redis";

export interface MailDeadLetterJobData {
  campaignId: string;
  campaignRecipientId?: string;
  emailAllocationId?: string;
  subscriberId?: string;
  to: string;
  subject: string;
  fromEmail: string;
  attemptsMade: number;
  maxAttempts: number;
  errorMessage: string;
  // Optional richer error payload (SMTP/provider response, code, stack, etc.)
  errorDetails?: Record<string, any> | null;
  failedAt: string;
}

export const mailDeadLetterQueue = new Queue<MailDeadLetterJobData>("mail-dead-letter-queue", {
  connection: redisConnection,
  defaultJobOptions: {
    removeOnComplete: false,
    removeOnFail: false,
  },
});
