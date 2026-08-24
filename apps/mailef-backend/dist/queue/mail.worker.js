"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.startMailWorker = void 0;
const bullmq_1 = require("bullmq");
const redis_1 = require("../config/redis");
const redis_client_1 = require("../config/redis-client");
const mailer_service_1 = require("../services/mailer.service");
const Campaign_model_1 = __importDefault(require("../models/Campaign.model"));
const CampaignRecipient_model_1 = __importDefault(require("../models/CampaignRecipient.model"));
const email_allocation_service_1 = require("../services/email-allocation.service");
const campaign_dispatch_service_1 = require("../services/campaign-dispatch.service");
const platform_settings_service_1 = require("../services/platform-settings.service");
const logger_1 = require("../utils/logger");
const mail_dead_letter_queue_1 = require("./mail.dead-letter.queue");
const next_send_time_service_1 = require("../services/next-send-time.service");
const domain_rotation_service_1 = require("../services/domain-rotation.service");
const cleanup_recipients_service_1 = require("../services/cleanup-recipients.service");
const mailWorkerBootConcurrency = Math.max(Number(process.env.MAIL_WORKER_CONCURRENCY) || 5, 10);
const mailJobLockDurationMs = Math.max(Number(process.env.MAIL_JOB_LOCK_DURATION_MS) || 180000, 30000);
const mailJobStalledIntervalMs = Math.max(Number(process.env.MAIL_JOB_STALLED_INTERVAL_MS) || 30000, 5000);
const mailJobMaxStalledCount = Math.max(Number(process.env.MAIL_JOB_MAX_STALLED_COUNT) || 2, 1);
const sleep = (ms) => new Promise((resolve) => {
    setTimeout(resolve, ms);
});
let activeSendCount = 0;
const acquireConcurrencySlot = async () => {
    while (true) {
        const { workerConcurrency } = await (0, platform_settings_service_1.getPlatformDispatchSettings)();
        const allowedConcurrency = Math.max(Number(workerConcurrency) || 1, 1);
        if (activeSendCount < allowedConcurrency) {
            activeSendCount += 1;
            let released = false;
            return () => {
                if (!released) {
                    released = true;
                    activeSendCount = Math.max(activeSendCount - 1, 0);
                }
            };
        }
        await sleep(100);
    }
};
/**
 * Per-user pacing: each user has their own send schedule stored in Redis.
 * User A can send at 3-min intervals while User B sends at 3-min intervals in parallel.
 * Pacing is tracked per-user, so no global serialization bottleneck.
 */
const waitForPerUserPacedSendSlot = async (userId) => {
    if (!userId) {
        // No user context, skip pacing (shouldn't happen in normal flow)
        return;
    }
    const { customIntervalMinutes, workerRateLimitMax, workerRateLimitDurationMs } = await (0, platform_settings_service_1.getPlatformDispatchSettings)();
    // Calculate gap in milliseconds
    let gapMs;
    if (customIntervalMinutes && customIntervalMinutes > 0) {
        gapMs = customIntervalMinutes * 60 * 1000; // Convert minutes to milliseconds
    }
    else {
        const limitMax = Math.max(Number(workerRateLimitMax) || 1, 1);
        const windowMs = Math.max(Number(workerRateLimitDurationMs) || 60000, 100);
        gapMs = Math.max(Math.ceil(windowMs / limitMax), 0);
    }
    // Redis key tracks next allowed send time for this user
    const redis = (0, redis_client_1.getRedisClient)();
    const userPaceKey = `user:pace:${userId}`;
    const now = Date.now();
    // Get stored next allowed send time
    const storedNextAllowed = await redis.get(userPaceKey);
    const nextAllowedSendAt = storedNextAllowed ? parseInt(storedNextAllowed, 10) : 0;
    // If we need to wait
    if (nextAllowedSendAt > now) {
        const waitMs = nextAllowedSendAt - now;
        await sleep(waitMs);
    }
    // Schedule next send for this user
    const scheduledNextSend = Date.now() + gapMs;
    await redis.set(userPaceKey, String(scheduledNextSend), "PX", gapMs + 1000);
    // Per-user rate limit check (minute/hour/day limits based on actual sent counts)
    const nextAllowed = await (0, next_send_time_service_1.getNextAllowedSendTime)(userId);
    const nowDate = new Date();
    if (nextAllowed && nextAllowed > nowDate) {
        await sleep(nextAllowed.getTime() - nowDate.getTime());
    }
};
const startMailWorker = () => {
    const worker = new bullmq_1.Worker("mail-queue", async (job) => {
        let { campaignId, to, subject, html, fromName, fromEmail, userId } = job.data;
        // If user has multiple domains, rotate the sending domain
        if (userId) {
            const nextDomain = await (0, domain_rotation_service_1.getNextSendingDomain)(userId);
            if (nextDomain) {
                // Replace domain in fromEmail if it exists, else construct new
                if (fromEmail && fromEmail.includes("@")) {
                    const local = fromEmail.split("@")[0];
                    fromEmail = `${local}@${nextDomain}`;
                }
                else {
                    fromEmail = `no-reply@${nextDomain}`;
                }
            }
        }
        // Extract domain from fromEmail (e.g., user@domain.com)
        let sendingDomain = null;
        if (fromEmail && fromEmail.includes('@')) {
            sendingDomain = fromEmail.split('@')[1].toLowerCase();
        }
        // IMPORTANT: Do pacing BEFORE acquiring concurrency slot
        // This ensures sleeping jobs don't hold slots, allowing other jobs to process
        await waitForPerUserPacedSendSlot(userId);
        const releaseConcurrencySlot = await acquireConcurrencySlot();
        try {
            const messageId = await (0, mailer_service_1.sendEmail)({ to, subject, html, fromName, fromEmail, userId });
            await CampaignRecipient_model_1.default.findByIdAndUpdate(job.data.campaignRecipientId, {
                $set: {
                    status: "sent",
                    messageId,
                    sentAt: new Date(),
                    lastError: null,
                },
            });
            // Increment usedToday for the sending domain (atomic, minimal write)
            if (sendingDomain) {
                const { SendingDomain } = require('../models/SendingDomain.model');
                SendingDomain.findOneAndUpdate({ domain: sendingDomain }, { $inc: { usedToday: 1 } }, { returnDocument: "before" }).catch(() => { });
                // Placeholder: Automated reputation adjustment (future bounce/complaint logic)
                // Example: Decrease reputationScore on bounce/complaint, increase on successful delivery
                // await SendingDomain.findOneAndUpdate(
                //   { domain: sendingDomain },
                //   { $inc: { reputationScore: delta } }
                // );
            }
            if (job.data.emailAllocationId) {
                await (0, email_allocation_service_1.consumeReservedEmailCredits)(job.data.emailAllocationId, 1);
            }
            // increment sent count on the campaign
            await Campaign_model_1.default.findByIdAndUpdate(campaignId, {
                $inc: { "stats.sent": 1 },
            });
            const campaign = await Campaign_model_1.default.findById(campaignId)
                .select("status stats.total stats.sent stats.failed")
                .lean();
            const sentCount = Number(campaign?.stats?.sent ?? 0);
            const failedCount = Number(campaign?.stats?.failed ?? 0);
            const totalCount = Number(campaign?.stats?.total ?? 0);
            const processedCount = sentCount + failedCount;
            if (campaign && totalCount > 0 && processedCount >= totalCount) {
                await Campaign_model_1.default.findByIdAndUpdate(campaignId, {
                    $set: { status: "sent", sentAt: new Date(), pauseReason: null },
                });
                // Free up MongoDB storage by deleting individual recipient records
                await (0, cleanup_recipients_service_1.cleanupCampaignRecipients)(campaignId);
            }
            return { messageId };
        }
        finally {
            releaseConcurrencySlot();
        }
    }, {
        connection: redis_1.redisConnection,
        concurrency: mailWorkerBootConcurrency,
        lockDuration: mailJobLockDurationMs,
        stalledInterval: mailJobStalledIntervalMs,
        maxStalledCount: mailJobMaxStalledCount,
    });
    worker.on("stalled", (jobId) => {
        logger_1.logger.warn("Mail job stalled and was re-queued by BullMQ", { jobId });
    });
    worker.on("completed", (job) => {
        logger_1.logger.info("Email sent", { to: job.data.to, jobId: job.id });
    });
    worker.on("failed", async (job, err) => {
        if (!job) {
            logger_1.logger.error("Email failed", { jobId: undefined, error: err.message });
            return;
        }
        const maxAttempts = Math.max(Number(job.opts.attempts) || 1, 1);
        const isFinalFailure = job.attemptsMade >= maxAttempts;
        if (job.data.campaignRecipientId) {
            try {
                await CampaignRecipient_model_1.default.findByIdAndUpdate(job.data.campaignRecipientId, {
                    $set: {
                        status: isFinalFailure ? "failed" : "queued",
                        lastError: err.message,
                    },
                    $inc: { retryCount: 1 },
                });
            }
            catch (updateError) {
                logger_1.logger.error("Failed to update campaign recipient on worker failure", {
                    campaignRecipientId: job.data.campaignRecipientId,
                    error: updateError instanceof Error ? updateError.message : String(updateError),
                });
            }
        }
        if (isFinalFailure && job.data.emailAllocationId) {
            try {
                await (0, email_allocation_service_1.releaseReservedEmailCredits)(job.data.emailAllocationId, 1);
            }
            catch (updateError) {
                logger_1.logger.error("Failed to release reserved email credit on worker failure", {
                    emailAllocationId: job.data.emailAllocationId,
                    error: updateError instanceof Error ? updateError.message : String(updateError),
                });
            }
        }
        if (isFinalFailure && job.data.campaignId) {
            try {
                await Campaign_model_1.default.findByIdAndUpdate(job.data.campaignId, {
                    $inc: { "stats.failed": 1 },
                });
                const campaign = await Campaign_model_1.default.findById(job.data.campaignId).select("status stats.total stats.sent stats.failed");
                const sentCount = Number(campaign?.stats?.sent ?? 0);
                const failedCount = Number(campaign?.stats?.failed ?? 0);
                const totalCount = Number(campaign?.stats?.total ?? 0);
                const processedCount = sentCount + failedCount;
                if (campaign && totalCount > 0 && processedCount >= totalCount) {
                    await Campaign_model_1.default.findByIdAndUpdate(job.data.campaignId, {
                        $set: { status: "sent", sentAt: new Date(), pauseReason: null },
                    });
                    // Free up MongoDB storage by deleting individual recipient records
                    await (0, cleanup_recipients_service_1.cleanupCampaignRecipients)(job.data.campaignId);
                }
                if (campaign?.status === "sending") {
                    const queuedCount = await CampaignRecipient_model_1.default.countDocuments({
                        campaignId: job.data.campaignId,
                        status: "queued",
                    });
                    if (queuedCount === 0) {
                        await (0, campaign_dispatch_service_1.pauseCampaignAndReleaseQueue)(job.data.campaignId, "Campaign paused because one or more emails failed after all retry attempts were exhausted. Review the Dead Letter Queue, then click resume after fixing the issue.");
                    }
                }
            }
            catch (campaignError) {
                logger_1.logger.error("Failed to update campaign status on final worker failure", {
                    campaignId: job.data.campaignId,
                    error: campaignError instanceof Error ? campaignError.message : String(campaignError),
                });
            }
        }
        if (isFinalFailure) {
            try {
                // Capture richer error details so DLQ entries include SMTP/provider responses
                const rawErr = err || {};
                const errorPayload = {
                    message: rawErr instanceof Error ? rawErr.message : String(rawErr || ''),
                    stack: rawErr instanceof Error ? rawErr.stack : undefined,
                    code: rawErr.code || rawErr.errno || undefined,
                    response: rawErr.response || rawErr.responseCode || rawErr.smtpResponse || undefined,
                    responseCode: rawErr.responseCode || rawErr.statusCode || undefined,
                };
                await mail_dead_letter_queue_1.mailDeadLetterQueue.add("send-email-dead-letter", {
                    campaignId: job.data.campaignId,
                    campaignRecipientId: job.data.campaignRecipientId,
                    emailAllocationId: job.data.emailAllocationId,
                    subscriberId: job.data.subscriberId,
                    to: job.data.to,
                    subject: job.data.subject,
                    fromEmail: job.data.fromEmail,
                    attemptsMade: job.attemptsMade,
                    maxAttempts,
                    errorMessage: errorPayload.message,
                    errorDetails: errorPayload,
                    failedAt: new Date().toISOString(),
                });
            }
            catch (deadLetterError) {
                logger_1.logger.error("Failed to enqueue dead-letter email job", {
                    jobId: job.id,
                    campaignId: job.data.campaignId,
                    error: deadLetterError instanceof Error ? deadLetterError.message : String(deadLetterError),
                });
            }
        }
        logger_1.logger.error("Email failed", {
            to: job.data.to,
            jobId: job.id,
            attemptsMade: job.attemptsMade,
            maxAttempts,
            final: isFinalFailure,
            error: err.message,
        });
    });
    return worker;
};
exports.startMailWorker = startMailWorker;
//# sourceMappingURL=mail.worker.js.map