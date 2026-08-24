import { Queue } from "bullmq";
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
    errorDetails?: Record<string, any> | null;
    failedAt: string;
}
export declare const mailDeadLetterQueue: Queue<MailDeadLetterJobData, any, string, MailDeadLetterJobData, any, string>;
//# sourceMappingURL=mail.dead-letter.queue.d.ts.map