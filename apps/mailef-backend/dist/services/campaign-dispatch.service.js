"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.dispatchCampaign = exports.pauseCampaignAndReleaseQueue = void 0;
const mongoose_1 = __importDefault(require("mongoose"));
const Campaign_model_1 = __importDefault(require("../models/Campaign.model"));
const CampaignRecipient_model_1 = __importDefault(require("../models/CampaignRecipient.model"));
const List_model_1 = __importDefault(require("../models/List.model"));
const ListSuppression_model_1 = __importDefault(require("../models/ListSuppression.model"));
const Subscriber_model_1 = __importDefault(require("../models/Subscriber.model"));
const mail_queue_1 = require("../queue/mail.queue");
const email_allocation_service_1 = require("./email-allocation.service");
const rate_limit_service_1 = require("./rate-limit.service");
const quota_reservation_service_1 = require("./quota-reservation.service");
const platform_settings_service_1 = require("./platform-settings.service");
const s3_list_service_1 = require("./s3-list.service");
/**
 * Pauses a campaign and cleans up the BullMQ queue + reserved credits so that
 * the allocation accurately reflects what has actually been sent.
 *
 * Without this, queued-but-unsent recipients keep `reservedEmails` inflated,
 * making the package look depleted even when very few emails have been sent.
 */
const pauseCampaignAndReleaseQueue = async (campaignId, pauseReason, pausedBy = "system") => {
    // 1. Mark the campaign paused immediately so no new dispatches start.
    await Campaign_model_1.default.findByIdAndUpdate(campaignId, {
        $set: { status: "paused", pauseReason, pausedBy },
    });
    // 2. Count queued recipients — these have credits reserved but not yet sent.
    const queuedCount = await CampaignRecipient_model_1.default.countDocuments({
        campaignId,
        status: "queued",
    });
    if (queuedCount === 0)
        return;
    // 3. Remove those jobs from BullMQ so they won't be processed.
    try {
        const campaign = await Campaign_model_1.default.findById(campaignId).select("userId").lean();
        if (campaign?.userId) {
            // Remove waiting/delayed jobs whose jobId matches a queued recipient _id.
            const queuedRecipients = await CampaignRecipient_model_1.default.find({
                campaignId,
                status: "queued",
            }).select("_id").lean();
            const jobIds = new Set(queuedRecipients.map((r) => r._id.toString()));
            const waitingJobs = await mail_queue_1.mailQueue.getJobs(["waiting", "delayed"]);
            await Promise.allSettled(waitingJobs
                .filter((job) => job.opts?.jobId && jobIds.has(String(job.opts.jobId)))
                .map((job) => job.remove()));
        }
    }
    catch {
        // BullMQ removal is best-effort; the status reset below is the source of truth.
    }
    // 4. Reset recipient status back to "pending" so they are picked up on resume.
    await CampaignRecipient_model_1.default.updateMany({ campaignId, status: "queued" }, { $set: { status: "pending" } });
    // 5. Release the reserved credits from the user's active allocation.
    //    reconcileReservedEmails will now count 0 queued rows and correctly
    //    reflect only the emails actually consumed.
    try {
        const campaign = await Campaign_model_1.default.findById(campaignId).select("userId").lean();
        if (campaign?.userId) {
            const { getActiveEmailAllocation } = await Promise.resolve().then(() => __importStar(require("./email-allocation.service")));
            const allocation = await getActiveEmailAllocation(campaign.userId.toString());
            if (allocation) {
                await (0, email_allocation_service_1.releaseReservedEmailCredits)(allocation._id.toString(), queuedCount);
            }
        }
    }
    catch {
        // best-effort — reconcileReservedEmails will self-heal on the next fetch
    }
};
exports.pauseCampaignAndReleaseQueue = pauseCampaignAndReleaseQueue;
const sending_domain_service_1 = require("./sending-domain.service");
const logger_1 = require("../utils/logger");
const email_validation_service_1 = require("./email-validation.service");
const cleanup_recipients_service_1 = require("./cleanup-recipients.service");
const resolveCampaignFromEmail = async (campaign) => {
    const userId = campaign.userId?.toString() || null;
    const selectedDomain = await (0, sending_domain_service_1.selectSendingDomain)(campaign.sendingDomain, userId);
    if (!selectedDomain) {
        return campaign.fromEmail;
    }
    const safeLocalPart = campaign.fromName.replace(/\s+/g, '.').toLowerCase().replace(/[^a-z0-9._+-]+/g, '') ||
        'no-reply';
    return `${safeLocalPart}@${selectedDomain}`;
};
const buildJobs = async (campaign, recipients, emailAllocationId, appUrl) => {
    const fromEmail = await resolveCampaignFromEmail(campaign);
    return recipients.map((recipient) => {
        const email = recipient.email;
        return {
            name: 'send-email',
            opts: {
                jobId: recipient._id,
            },
            data: {
                campaignId: campaign._id.toString(),
                campaignRecipientId: recipient._id,
                emailAllocationId,
                subscriberId: recipient.subscriberId,
                userId: campaign.userId?.toString(),
                to: email,
                subject: campaign.subject,
                html: campaign.html.replace('{{unsubscribe_url}}', `${appUrl}/unsubscribe?email=${email}&listId=${campaign.listId}`),
                fromName: campaign.fromName,
                fromEmail,
            },
        };
    });
};
const queueRecipientBatch = async (campaign, recipients, state, options) => {
    let queueLimit = recipients.length;
    queueLimit = Math.min(queueLimit, state.remainingInRun);
    queueLimit = Math.min(queueLimit, state.remainingCredits);
    logger_1.logger.info("[dispatch] queueRecipientBatch", {
        campaignId: campaign._id.toString(),
        recipientsCount: recipients.length,
        remainingInRun: state.remainingInRun,
        remainingCredits: state.remainingCredits,
        queueLimit,
    });
    if (queueLimit <= 0) {
        return { queuedCount: 0, halted: state.remainingCredits <= 0 || state.remainingInRun <= 0 };
    }
    const grantedByQuota = await (0, quota_reservation_service_1.reserveDispatchQuota)(campaign.userId.toString(), queueLimit, {
        globalLimits: options.globalLimits,
        effectiveUserLimits: options.effectiveLimits,
    });
    if (grantedByQuota <= 0) {
        state.rateLimitReached = options.hasRateLimitConfig;
        return { queuedCount: 0, halted: true };
    }
    const limitedTargets = recipients.slice(0, grantedByQuota);
    const quotaLimitedThisBatch = grantedByQuota < queueLimit;
    if (limitedTargets.length === 0) {
        return { queuedCount: 0, halted: false };
    }
    const reservedAllocation = options.activeAllocationId
        ? await (0, email_allocation_service_1.reserveEmailCredits)(options.activeAllocationId, limitedTargets.length)
        : null;
    if (options.activeAllocationId && !reservedAllocation) {
        state.remainingCredits = 0;
        return { queuedCount: 0, halted: true };
    }
    const emailAllocationId = reservedAllocation?._id.toString() || options.activeAllocationId || "";
    await CampaignRecipient_model_1.default.updateMany({ _id: { $in: limitedTargets.map((item) => item._id) } }, { $set: { status: "queued", lastError: null } });
    const jobs = await buildJobs(campaign, limitedTargets, emailAllocationId, options.appUrl);
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await mail_queue_1.mailQueue.addBulk(jobs);
        state.totalQueued += jobs.length;
        state.remainingCredits = Math.max(state.remainingCredits - jobs.length, 0);
        state.remainingInRun = Math.max(state.remainingInRun - jobs.length, 0);
        if (quotaLimitedThisBatch) {
            state.rateLimitReached = true;
            return { queuedCount: jobs.length, halted: true };
        }
        return {
            queuedCount: jobs.length,
            halted: state.remainingCredits <= 0 || state.remainingInRun <= 0,
        };
    }
    catch (error) {
        if (reservedAllocation) {
            await (0, email_allocation_service_1.releaseReservedEmailCredits)(reservedAllocation._id.toString(), jobs.length);
        }
        if (limitedTargets.length > 0) {
            await CampaignRecipient_model_1.default.bulkWrite(limitedTargets.map((item) => ({
                updateOne: {
                    filter: { _id: item._id },
                    update: {
                        $set: {
                            status: item.previousStatus,
                        },
                    },
                },
            })));
        }
        throw error;
    }
};
const finalizeDispatchResult = async (campaign, totalSubscribers, state) => {
    const campaignIdStr = campaign._id.toString();
    let alreadyCompleted = false;
    logger_1.logger.info("[dispatch] finalizing", {
        campaignId: campaignIdStr,
        totalQueued: state.totalQueued,
        remainingCredits: state.remainingCredits,
        rateLimitReached: state.rateLimitReached,
        remainingInRun: state.remainingInRun,
    });
    if (state.totalQueued === 0) {
        const [sentCount, queuedCount, failedCount, pendingCount] = await Promise.all([
            CampaignRecipient_model_1.default.countDocuments({ campaignId: campaign._id, status: "sent" }),
            CampaignRecipient_model_1.default.countDocuments({ campaignId: campaign._id, status: "queued" }),
            CampaignRecipient_model_1.default.countDocuments({ campaignId: campaign._id, status: "failed" }),
            CampaignRecipient_model_1.default.countDocuments({ campaignId: campaign._id, status: "pending" }),
        ]);
        const processedCount = sentCount + failedCount;
        const hasBacklog = queuedCount > 0 || pendingCount > 0;
        logger_1.logger.info("[dispatch] zero queued — evaluating outcome", {
            campaignId: campaignIdStr,
            sentCount, queuedCount, failedCount, pendingCount, processedCount, totalSubscribers, hasBacklog,
            remainingCredits: state.remainingCredits,
            rateLimitReached: state.rateLimitReached,
        });
        if (processedCount >= totalSubscribers) {
            alreadyCompleted = true;
            await Campaign_model_1.default.findByIdAndUpdate(campaign._id, {
                $set: { status: "sent", pauseReason: null, sentAt: campaign.sentAt || new Date() },
            });
            // Free up MongoDB storage by deleting individual recipient records
            await (0, cleanup_recipients_service_1.cleanupCampaignRecipients)(campaign._id.toString());
        }
        else if (!hasBacklog) {
            alreadyCompleted = true;
            await Campaign_model_1.default.findByIdAndUpdate(campaign._id, {
                $set: { status: "sent", pauseReason: null, sentAt: campaign.sentAt || new Date() },
            });
            // Free up MongoDB storage by deleting individual recipient records
            await (0, cleanup_recipients_service_1.cleanupCampaignRecipients)(campaign._id.toString());
        }
        else if (state.remainingCredits <= 0) {
            logger_1.logger.warn("[dispatch] pausing — no remaining credits", { campaignId: campaignIdStr });
            await (0, exports.pauseCampaignAndReleaseQueue)(campaign._id.toString(), "Campaign paused because your email package has no remaining credits.");
        }
        else if (state.rateLimitReached) {
            logger_1.logger.warn("[dispatch] rate limit reached — keeping sending", { campaignId: campaignIdStr });
            await Campaign_model_1.default.findByIdAndUpdate(campaign._id, {
                $set: { status: "sending", pauseReason: null },
            });
        }
        else {
            logger_1.logger.warn("[dispatch] zero queued but backlog exists and credits available — unexpected state", {
                campaignId: campaignIdStr,
                sentCount, queuedCount, failedCount, pendingCount, remainingCredits: state.remainingCredits,
            });
        }
    }
    return {
        totalActiveSubscribers: totalSubscribers,
        queued: state.totalQueued,
        remainingAllowance: state.rateLimitReached ? 0 : null,
        rateLimited: state.rateLimitReached,
        creditLimited: state.remainingCredits <= 0,
        hasActiveAllocation: true,
        alreadyCompleted,
    };
};
const dispatchMongoListCampaign = async (campaign, state, options) => {
    let lastSubscriberId = null;
    while (!state.rateLimitReached && state.remainingCredits > 0 && state.remainingInRun > 0) {
        const query = {
            listId: campaign.listId,
            status: "active",
        };
        if (lastSubscriberId) {
            query._id = { $gt: lastSubscriberId };
        }
        const subscribers = await Subscriber_model_1.default.find(query)
            .select("_id email")
            .sort({ _id: 1 })
            .limit(options.batchSize)
            .lean();
        if (subscribers.length === 0)
            break;
        lastSubscriberId = subscribers[subscribers.length - 1]._id.toString();
        const emails = subscribers.map((item) => item.email.toLowerCase());
        // Batch MX validate all unique domains in this batch
        const mxResult = await (0, email_validation_service_1.batchValidateMxRecords)(emails);
        const validEmailSet = new Set(mxResult.valid.map((e) => e.toLowerCase()));
        if (mxResult.invalid.length > 0) {
            logger_1.logger.warn("[dispatch] Skipping recipients with invalid MX domains", {
                campaignId: campaign._id.toString(),
                count: mxResult.invalid.length,
                sample: mxResult.invalid.slice(0, 5).map((r) => r.email),
            });
        }
        const existingRecipients = await CampaignRecipient_model_1.default.find({
            campaignId: campaign._id,
            email: { $in: emails },
        })
            .select("_id subscriberId email status")
            .lean();
        const existingByEmail = new Map(existingRecipients.map((item) => [item.email.toLowerCase(), item]));
        const newSubscribers = subscribers.filter((item) => validEmailSet.has(item.email.toLowerCase()) && !existingByEmail.has(item.email.toLowerCase()));
        const insertedIds = new Map();
        if (newSubscribers.length > 0) {
            const docsToInsert = newSubscribers.map((sub) => {
                const docId = new mongoose_1.default.Types.ObjectId();
                insertedIds.set(sub.email.toLowerCase(), docId.toString());
                return {
                    _id: docId,
                    campaignId: campaign._id,
                    userId: campaign.userId,
                    listId: campaign.listId,
                    subscriberId: sub._id,
                    email: sub.email,
                    status: "pending",
                };
            });
            try {
                await CampaignRecipient_model_1.default.insertMany(docsToInsert, { ordered: false });
            }
            catch (error) {
                // Only ignore duplicate key errors (11000). Re-throw all others.
                if (error instanceof Error && 'code' in error && error.code !== 11000) {
                    throw error;
                }
            }
        }
        const failedRecipients = options.retryFailedRecipients
            ? existingRecipients.filter((item) => item.status === "failed")
            : [];
        const pendingRecipients = existingRecipients.filter((item) => item.status === "pending");
        const newEmailSet = new Set(newSubscribers.map((item) => item.email.toLowerCase()));
        const failedEmailSet = new Set(failedRecipients.map((item) => item.email.toLowerCase()));
        const pendingEmailSet = new Set(pendingRecipients.map((item) => item.email.toLowerCase()));
        const queueTargets = [];
        for (const subscriber of subscribers) {
            const normalizedEmail = subscriber.email.toLowerCase();
            if (newEmailSet.has(normalizedEmail)) {
                const docId = insertedIds.get(normalizedEmail);
                if (docId) {
                    queueTargets.push({
                        _id: docId,
                        email: subscriber.email,
                        subscriberId: subscriber._id.toString(),
                        previousStatus: "pending",
                    });
                }
            }
            else if (pendingEmailSet.has(normalizedEmail)) {
                const pendingRecipient = existingByEmail.get(normalizedEmail);
                if (pendingRecipient) {
                    queueTargets.push({
                        _id: pendingRecipient._id.toString(),
                        email: pendingRecipient.email,
                        subscriberId: pendingRecipient.subscriberId?.toString(),
                        previousStatus: "pending",
                    });
                }
            }
            else if (failedEmailSet.has(normalizedEmail)) {
                const failed = existingByEmail.get(normalizedEmail);
                if (failed) {
                    queueTargets.push({
                        _id: failed._id.toString(),
                        email: failed.email,
                        subscriberId: failed.subscriberId?.toString(),
                        previousStatus: "failed",
                    });
                }
            }
        }
        const queued = await queueRecipientBatch(campaign, queueTargets, state, options);
        if (queued.halted)
            break;
    }
};
const dispatchS3ListCampaign = async (campaign, state, listManifestKey, options) => {
    const manifest = await (0, s3_list_service_1.getListManifest)(listManifestKey);
    let chunkIndex = Math.max(Number(campaign.dispatchCursorChunkIndex || 0), 0);
    let rowOffset = Math.max(Number(campaign.dispatchCursorRowOffset || 0), 0);
    // If the cursor is at the end of the list but pending recipients still exist,
    // reset the cursor so we re-scan and pick them up (e.g. after stalled jobs).
    if (chunkIndex >= manifest.chunkKeys.length) {
        const pendingCount = await CampaignRecipient_model_1.default.countDocuments({
            campaignId: campaign._id,
            status: { $in: ["pending", "failed"] },
        });
        if (pendingCount > 0) {
            logger_1.logger.info("[dispatch] S3 cursor exhausted but pending recipients exist — resetting cursor", {
                campaignId: campaign._id.toString(),
                pendingCount,
            });
            chunkIndex = 0;
            rowOffset = 0;
            await Campaign_model_1.default.findByIdAndUpdate(campaign._id, {
                $set: { dispatchCursorChunkIndex: 0, dispatchCursorRowOffset: 0 },
            });
        }
    }
    while (!state.rateLimitReached && state.remainingCredits > 0 && state.remainingInRun > 0) {
        if (chunkIndex >= manifest.chunkKeys.length) {
            break;
        }
        const rows = await (0, s3_list_service_1.getChunkRows)(manifest.chunkKeys[chunkIndex]);
        const windowRows = rows.slice(rowOffset);
        if (windowRows.length === 0) {
            chunkIndex += 1;
            rowOffset = 0;
            await Campaign_model_1.default.findByIdAndUpdate(campaign._id, {
                $set: { dispatchCursorChunkIndex: chunkIndex, dispatchCursorRowOffset: rowOffset },
            });
            continue;
        }
        const emails = windowRows.map((row) => row.email.toLowerCase());
        // Batch MX validate all unique domains in this batch
        const mxResult = await (0, email_validation_service_1.batchValidateMxRecords)(emails);
        const validEmailSet = new Set(mxResult.valid.map((e) => e.toLowerCase()));
        if (mxResult.invalid.length > 0) {
            logger_1.logger.warn("[dispatch:S3] Skipping recipients with invalid MX domains", {
                campaignId: campaign._id.toString(),
                count: mxResult.invalid.length,
                sample: mxResult.invalid.slice(0, 5).map((r) => r.email),
            });
        }
        const suppressed = await ListSuppression_model_1.default.find({
            listId: campaign.listId,
            email: { $in: emails },
        })
            .select("email")
            .lean();
        const suppressedSet = new Set(suppressed.map((item) => item.email.toLowerCase()));
        const existingRecipients = await CampaignRecipient_model_1.default.find({
            campaignId: campaign._id,
            email: { $in: emails },
        })
            .select("_id email status")
            .lean();
        const existingByEmail = new Map(existingRecipients.map((item) => [item.email.toLowerCase(), item]));
        const newRows = windowRows.filter((row) => validEmailSet.has(row.email.toLowerCase()) && !suppressedSet.has(row.email.toLowerCase()) && !existingByEmail.has(row.email.toLowerCase()));
        const insertedIds = new Map();
        if (newRows.length > 0) {
            const docsToInsert = newRows.map((row) => {
                const docId = new mongoose_1.default.Types.ObjectId();
                insertedIds.set(row.email.toLowerCase(), docId.toString());
                return {
                    _id: docId,
                    campaignId: campaign._id,
                    userId: campaign.userId,
                    listId: campaign.listId,
                    email: row.email,
                    status: "pending",
                };
            });
            try {
                await CampaignRecipient_model_1.default.insertMany(docsToInsert, { ordered: false });
            }
            catch (error) {
                // Only ignore duplicate key errors (11000). Re-throw all others.
                if (error instanceof Error && 'code' in error && error.code !== 11000) {
                    throw error;
                }
            }
        }
        const failedRecipients = options.retryFailedRecipients
            ? existingRecipients.filter((item) => item.status === "failed")
            : [];
        const pendingRecipients = existingRecipients.filter((item) => item.status === "pending");
        const newEmailSet = new Set(newRows.map((row) => row.email.toLowerCase()));
        const failedEmailSet = new Set(failedRecipients.map((row) => row.email.toLowerCase()));
        const pendingEmailSet = new Set(pendingRecipients.map((row) => row.email.toLowerCase()));
        const actionableTargets = [];
        for (const [index, row] of windowRows.entries()) {
            const normalizedEmail = row.email.toLowerCase();
            if (suppressedSet.has(normalizedEmail))
                continue;
            if (newEmailSet.has(normalizedEmail)) {
                const docId = insertedIds.get(normalizedEmail);
                if (docId) {
                    actionableTargets.push({
                        _id: docId,
                        email: row.email,
                        sourceIndex: index,
                        previousStatus: "pending",
                    });
                }
            }
            else if (pendingEmailSet.has(normalizedEmail)) {
                const pendingRecipient = existingByEmail.get(normalizedEmail);
                if (pendingRecipient) {
                    actionableTargets.push({
                        _id: pendingRecipient._id.toString(),
                        email: pendingRecipient.email,
                        sourceIndex: index,
                        previousStatus: "pending",
                    });
                }
            }
            else if (failedEmailSet.has(normalizedEmail)) {
                const failed = existingByEmail.get(normalizedEmail);
                if (failed) {
                    actionableTargets.push({
                        _id: failed._id.toString(),
                        email: failed.email,
                        sourceIndex: index,
                        previousStatus: "failed",
                    });
                }
            }
        }
        if (actionableTargets.length === 0) {
            rowOffset += windowRows.length;
            if (rowOffset >= rows.length) {
                chunkIndex += 1;
                rowOffset = 0;
            }
            await Campaign_model_1.default.findByIdAndUpdate(campaign._id, {
                $set: { dispatchCursorChunkIndex: chunkIndex, dispatchCursorRowOffset: rowOffset },
            });
            continue;
        }
        const queueResult = await queueRecipientBatch(campaign, actionableTargets.map((item) => ({
            _id: item._id,
            email: item.email,
            previousStatus: item.previousStatus,
        })), state, options);
        if (queueResult.queuedCount === 0) {
            const firstActionableSourceIndex = actionableTargets[0]?.sourceIndex ?? 0;
            rowOffset += firstActionableSourceIndex;
        }
        else if (queueResult.queuedCount < actionableTargets.length) {
            rowOffset += actionableTargets[queueResult.queuedCount - 1].sourceIndex + 1;
        }
        else {
            rowOffset += windowRows.length;
        }
        if (rowOffset >= rows.length) {
            chunkIndex += 1;
            rowOffset = 0;
        }
        await Campaign_model_1.default.findByIdAndUpdate(campaign._id, {
            $set: { dispatchCursorChunkIndex: chunkIndex, dispatchCursorRowOffset: rowOffset },
        });
        if (queueResult.halted) {
            break;
        }
    }
};
const dispatchCampaign = async (campaign, options = {}) => {
    const campaignIdStr = campaign._id.toString();
    const userIdStr = campaign.userId?.toString();
    const list = await List_model_1.default.findById(campaign.listId)
        .select("_id subscriberCount storageType s3ManifestKey")
        .lean();
    const totalSubscribers = list
        ? list.storageType === "s3"
            ? Number(list.subscriberCount || 0)
            : await Subscriber_model_1.default.countDocuments({
                listId: campaign.listId,
                status: "active",
            })
        : 0;
    logger_1.logger.info("[dispatch] starting", { campaignId: campaignIdStr, userId: userIdStr, totalSubscribers, listStorageType: list?.storageType });
    if (totalSubscribers === 0) {
        logger_1.logger.warn("[dispatch] no active subscribers — skipping", { campaignId: campaignIdStr });
        return {
            totalActiveSubscribers: 0,
            queued: 0,
            remainingAllowance: null,
            rateLimited: false,
            creditLimited: false,
            hasActiveAllocation: false,
            alreadyCompleted: false,
        };
    }
    await Campaign_model_1.default.findByIdAndUpdate(campaign._id, {
        $set: { status: "sending", pauseReason: null, "stats.total": totalSubscribers },
    });
    const appUrl = process.env.APP_URL || "http://localhost:4400";
    const batchSize = Math.max(Number(process.env.CAMPAIGN_ENQUEUE_BATCH_SIZE) || 1000, 100);
    const dispatchSettings = await (0, platform_settings_service_1.getPlatformDispatchSettings)();
    const maxPerRun = dispatchSettings.maxPerRun;
    const activeAllocation = await (0, email_allocation_service_1.getActiveEmailAllocation)(campaign.userId.toString());
    const remainingCredits = activeAllocation
        ? Math.max(activeAllocation.emailsPurchased -
            activeAllocation.consumedEmails -
            activeAllocation.reservedEmails, 0)
        : 0;
    logger_1.logger.info("[dispatch] credit check", {
        campaignId: campaignIdStr,
        userId: userIdStr,
        hasAllocation: Boolean(activeAllocation),
        emailsPurchased: activeAllocation?.emailsPurchased ?? 0,
        consumedEmails: activeAllocation?.consumedEmails ?? 0,
        reservedEmails: activeAllocation?.reservedEmails ?? 0,
        remainingCredits,
        maxPerRun,
    });
    const state = {
        remainingCredits,
        remainingInRun: maxPerRun,
        totalQueued: 0,
        rateLimitReached: false,
    };
    const { globalLimits, effectiveLimits } = await (0, rate_limit_service_1.getEffectiveRateLimits)(campaign.userId.toString());
    const hasRateLimitConfig = effectiveLimits.perMinute !== undefined ||
        effectiveLimits.perHour !== undefined ||
        effectiveLimits.perDay !== undefined;
    logger_1.logger.info("[dispatch] rate limit config", {
        campaignId: campaignIdStr,
        hasRateLimitConfig,
        effectiveLimits,
    });
    if (list?.storageType === "s3" && list.s3ManifestKey) {
        await dispatchS3ListCampaign(campaign, state, list.s3ManifestKey, {
            appUrl,
            activeAllocationId: activeAllocation?._id.toString(),
            globalLimits,
            effectiveLimits,
            hasRateLimitConfig,
            retryFailedRecipients: options.retryFailedRecipients,
        });
    }
    else {
        await dispatchMongoListCampaign(campaign, state, {
            appUrl,
            batchSize,
            activeAllocationId: activeAllocation?._id.toString(),
            globalLimits,
            effectiveLimits,
            hasRateLimitConfig,
            retryFailedRecipients: options.retryFailedRecipients,
        });
    }
    const result = await finalizeDispatchResult(campaign, totalSubscribers, state);
    return {
        ...result,
        hasActiveAllocation: Boolean(activeAllocation),
    };
};
exports.dispatchCampaign = dispatchCampaign;
//# sourceMappingURL=campaign-dispatch.service.js.map