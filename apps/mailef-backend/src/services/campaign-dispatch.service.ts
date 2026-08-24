import mongoose from "mongoose";
import Campaign from "../models/Campaign.model";
import CampaignRecipient from "../models/CampaignRecipient.model";
import List from "../models/List.model";
import ListSuppression from "../models/ListSuppression.model";
import Subscriber from "../models/Subscriber.model";
import { mailQueue } from "../queue/mail.queue";
import { MailJobData, ICampaign } from "../types";
import {
  getActiveEmailAllocation,
  reserveEmailCredits,
  releaseReservedEmailCredits,
} from "./email-allocation.service";
import { getEffectiveRateLimits } from "./rate-limit.service";
import { reserveDispatchQuota } from "./quota-reservation.service";
import { getPlatformDispatchSettings } from "./platform-settings.service";
import { getChunkRows, getListManifest } from "./s3-list.service";

/**
 * Pauses a campaign and cleans up the BullMQ queue + reserved credits so that
 * the allocation accurately reflects what has actually been sent.
 *
 * Without this, queued-but-unsent recipients keep `reservedEmails` inflated,
 * making the package look depleted even when very few emails have been sent.
 */
export const pauseCampaignAndReleaseQueue = async (
  campaignId: string,
  pauseReason: string,
  pausedBy: "user" | "admin" | "system" = "system"
): Promise<void> => {
  // 1. Mark the campaign paused immediately so no new dispatches start.
  await Campaign.findByIdAndUpdate(campaignId, {
    $set: { status: "paused", pauseReason, pausedBy },
  });

  // 2. Count queued recipients — these have credits reserved but not yet sent.
  const queuedCount = await CampaignRecipient.countDocuments({
    campaignId,
    status: "queued",
  });

  if (queuedCount === 0) return;

  // 3. Remove those jobs from BullMQ so they won't be processed.
  try {
    const campaign = await Campaign.findById(campaignId).select("userId").lean();
    if (campaign?.userId) {
      // Remove waiting/delayed jobs whose jobId matches a queued recipient _id.
      const queuedRecipients = await CampaignRecipient.find({
        campaignId,
        status: "queued",
      }).select("_id").lean();
      const jobIds = new Set(queuedRecipients.map((r) => r._id.toString()));
      const waitingJobs = await mailQueue.getJobs(["waiting", "delayed"]);
      await Promise.allSettled(
        waitingJobs
          .filter((job) => job.opts?.jobId && jobIds.has(String(job.opts.jobId)))
          .map((job) => job.remove())
      );
    }
  } catch {
    // BullMQ removal is best-effort; the status reset below is the source of truth.
  }

  // 4. Reset recipient status back to "pending" so they are picked up on resume.
  await CampaignRecipient.updateMany(
    { campaignId, status: "queued" },
    { $set: { status: "pending" } }
  );

  // 5. Release the reserved credits from the user's active allocation.
  //    reconcileReservedEmails will now count 0 queued rows and correctly
  //    reflect only the emails actually consumed.
  try {
    const campaign = await Campaign.findById(campaignId).select("userId").lean();
    if (campaign?.userId) {
      const { getActiveEmailAllocation } = await import("./email-allocation.service");
      const allocation = await getActiveEmailAllocation(campaign.userId.toString());
      if (allocation) {
        await releaseReservedEmailCredits(allocation._id.toString(), queuedCount);
      }
    }
  } catch {
    // best-effort — reconcileReservedEmails will self-heal on the next fetch
  }
};

export interface DispatchCampaignResult {
  totalActiveSubscribers: number;
  queued: number;
  remainingAllowance: number | null;
  rateLimited: boolean;
  creditLimited: boolean;
  hasActiveAllocation: boolean;
  alreadyCompleted: boolean;
}

interface DispatchState {
  remainingCredits: number;
  remainingInRun: number;
  totalQueued: number;
  rateLimitReached: boolean;
}

interface DispatchCampaignOptions {
  retryFailedRecipients?: boolean;
}

type DispatchableRecipientStatus = "pending" | "failed";

interface QueueCandidate {
  _id: string;
  email: string;
  subscriberId?: string;
  previousStatus: DispatchableRecipientStatus;
}

import { selectSendingDomain } from "./sending-domain.service";
import { logger } from "../utils/logger";
import { batchValidateMxRecords } from "./email-validation.service";
import { cleanupCampaignRecipients } from "./cleanup-recipients.service";

const resolveCampaignFromEmail = async (campaign: ICampaign): Promise<string> => {
  const userId = campaign.userId?.toString() || null;
  const selectedDomain = await selectSendingDomain(campaign.sendingDomain, userId);

  if (!selectedDomain) {
    return campaign.fromEmail;
  }

  const safeLocalPart =
    campaign.fromName.replace(/\s+/g, '.').toLowerCase().replace(/[^a-z0-9._+-]+/g, '') ||
    'no-reply';

  return `${safeLocalPart}@${selectedDomain}`;
};

const buildJobs = async (
  campaign: ICampaign,
  recipients: QueueCandidate[],
  emailAllocationId: string,
  appUrl: string
): Promise<{ name: string; data: MailJobData }[]> => {
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
        html: campaign.html.replace(
          '{{unsubscribe_url}}',
          `${appUrl}/unsubscribe?email=${email}&listId=${campaign.listId}`
        ),
        fromName: campaign.fromName,
        fromEmail,
      },
    };
  });
};

const queueRecipientBatch = async (
  campaign: ICampaign,
  recipients: QueueCandidate[],
  state: DispatchState,
  options: {
    activeAllocationId?: string;
    appUrl: string;
    globalLimits: Awaited<ReturnType<typeof getEffectiveRateLimits>>["globalLimits"];
    effectiveLimits: Awaited<ReturnType<typeof getEffectiveRateLimits>>["effectiveLimits"];
    hasRateLimitConfig: boolean;
  }
): Promise<{ queuedCount: number; halted: boolean }> => {
  let queueLimit = recipients.length;
  queueLimit = Math.min(queueLimit, state.remainingInRun);
  queueLimit = Math.min(queueLimit, state.remainingCredits);

  logger.info("[dispatch] queueRecipientBatch", {
    campaignId: campaign._id.toString(),
    recipientsCount: recipients.length,
    remainingInRun: state.remainingInRun,
    remainingCredits: state.remainingCredits,
    queueLimit,
  });

  if (queueLimit <= 0) {
    return { queuedCount: 0, halted: state.remainingCredits <= 0 || state.remainingInRun <= 0 };
  }

  const grantedByQuota = await reserveDispatchQuota(campaign.userId.toString(), queueLimit, {
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
    ? await reserveEmailCredits(options.activeAllocationId, limitedTargets.length)
    : null;

  if (options.activeAllocationId && !reservedAllocation) {
    state.remainingCredits = 0;
    return { queuedCount: 0, halted: true };
  }

  const emailAllocationId = reservedAllocation?._id.toString() || options.activeAllocationId || "";
  await CampaignRecipient.updateMany(
    { _id: { $in: limitedTargets.map((item) => item._id) } },
    { $set: { status: "queued", lastError: null } }
  );

  const jobs = await buildJobs(campaign, limitedTargets, emailAllocationId, options.appUrl);

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await mailQueue.addBulk(jobs as any);
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
  } catch (error) {
    if (reservedAllocation) {
      await releaseReservedEmailCredits(reservedAllocation._id.toString(), jobs.length);
    }

    if (limitedTargets.length > 0) {
      await CampaignRecipient.bulkWrite(
        limitedTargets.map((item) => ({
          updateOne: {
            filter: { _id: item._id },
            update: {
              $set: {
                status: item.previousStatus,
              },
            },
          },
        }))
      );
    }

    throw error;
  }
};

const finalizeDispatchResult = async (
  campaign: ICampaign,
  totalSubscribers: number,
  state: DispatchState
): Promise<DispatchCampaignResult> => {
  const campaignIdStr = campaign._id.toString();
  let alreadyCompleted = false;

  logger.info("[dispatch] finalizing", {
    campaignId: campaignIdStr,
    totalQueued: state.totalQueued,
    remainingCredits: state.remainingCredits,
    rateLimitReached: state.rateLimitReached,
    remainingInRun: state.remainingInRun,
  });

  if (state.totalQueued === 0) {
    const [sentCount, queuedCount, failedCount, pendingCount] = await Promise.all([
      CampaignRecipient.countDocuments({ campaignId: campaign._id, status: "sent" }),
      CampaignRecipient.countDocuments({ campaignId: campaign._id, status: "queued" }),
      CampaignRecipient.countDocuments({ campaignId: campaign._id, status: "failed" }),
      CampaignRecipient.countDocuments({ campaignId: campaign._id, status: "pending" }),
    ]);

    const processedCount = sentCount + failedCount;
    const hasBacklog = queuedCount > 0 || pendingCount > 0;

    logger.info("[dispatch] zero queued — evaluating outcome", {
      campaignId: campaignIdStr,
      sentCount, queuedCount, failedCount, pendingCount, processedCount, totalSubscribers, hasBacklog,
      remainingCredits: state.remainingCredits,
      rateLimitReached: state.rateLimitReached,
    });

    if (processedCount >= totalSubscribers) {
      alreadyCompleted = true;
      await Campaign.findByIdAndUpdate(campaign._id, {
        $set: { status: "sent", pauseReason: null, sentAt: campaign.sentAt || new Date() },
      });
      // Free up MongoDB storage by deleting individual recipient records
      await cleanupCampaignRecipients(campaign._id.toString());
    } else if (!hasBacklog) {
      alreadyCompleted = true;
      await Campaign.findByIdAndUpdate(campaign._id, {
        $set: { status: "sent", pauseReason: null, sentAt: campaign.sentAt || new Date() },
      });
      // Free up MongoDB storage by deleting individual recipient records
      await cleanupCampaignRecipients(campaign._id.toString());
    } else if (state.remainingCredits <= 0) {
      logger.warn("[dispatch] pausing — no remaining credits", { campaignId: campaignIdStr });
      await pauseCampaignAndReleaseQueue(
        campaign._id.toString(),
        "Campaign paused because your email package has no remaining credits."
      );
    } else if (state.rateLimitReached) {
      logger.warn("[dispatch] rate limit reached — keeping sending", { campaignId: campaignIdStr });
      await Campaign.findByIdAndUpdate(campaign._id, {
        $set: { status: "sending", pauseReason: null },
      });
    } else {
      logger.warn("[dispatch] zero queued but backlog exists and credits available — unexpected state", {
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

const dispatchMongoListCampaign = async (
  campaign: ICampaign,
  state: DispatchState,
  options: {
    appUrl: string;
    batchSize: number;
    activeAllocationId?: string;
    globalLimits: Awaited<ReturnType<typeof getEffectiveRateLimits>>["globalLimits"];
    effectiveLimits: Awaited<ReturnType<typeof getEffectiveRateLimits>>["effectiveLimits"];
    hasRateLimitConfig: boolean;
    retryFailedRecipients?: boolean;
  }
) => {
  let lastSubscriberId: string | null = null;

  while (!state.rateLimitReached && state.remainingCredits > 0 && state.remainingInRun > 0) {
    const query: Record<string, unknown> = {
      listId: campaign.listId,
      status: "active",
    };

    if (lastSubscriberId) {
      query._id = { $gt: lastSubscriberId };
    }

    const subscribers = await Subscriber.find(query)
      .select("_id email")
      .sort({ _id: 1 })
      .limit(options.batchSize)
      .lean();

    if (subscribers.length === 0) break;

    lastSubscriberId = subscribers[subscribers.length - 1]._id.toString();
    const emails = subscribers.map((item) => item.email.toLowerCase());

    // Batch MX validate all unique domains in this batch
    const mxResult = await batchValidateMxRecords(emails);
    const validEmailSet = new Set(mxResult.valid.map((e) => e.toLowerCase()));

    if (mxResult.invalid.length > 0) {
      logger.warn("[dispatch] Skipping recipients with invalid MX domains", {
        campaignId: campaign._id.toString(),
        count: mxResult.invalid.length,
        sample: mxResult.invalid.slice(0, 5).map((r) => r.email),
      });
    }

    const existingRecipients = await CampaignRecipient.find({
      campaignId: campaign._id,
      email: { $in: emails },
    })
      .select("_id subscriberId email status")
      .lean();

    const existingByEmail = new Map(existingRecipients.map((item) => [item.email.toLowerCase(), item]));
    const newSubscribers = subscribers.filter((item) => validEmailSet.has(item.email.toLowerCase()) && !existingByEmail.has(item.email.toLowerCase()));

    const insertedIds = new Map<string, string>();
    if (newSubscribers.length > 0) {
      const docsToInsert = newSubscribers.map((sub) => {
        const docId = new mongoose.Types.ObjectId();
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
        await CampaignRecipient.insertMany(docsToInsert, { ordered: false });
      } catch (error) {
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
    const queueTargets: QueueCandidate[] = [];
    
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
      } else if (pendingEmailSet.has(normalizedEmail)) {
        const pendingRecipient = existingByEmail.get(normalizedEmail);
        if (pendingRecipient) {
          queueTargets.push({
            _id: pendingRecipient._id.toString(),
            email: pendingRecipient.email,
            subscriberId: pendingRecipient.subscriberId?.toString(),
            previousStatus: "pending",
          });
        }
      } else if (failedEmailSet.has(normalizedEmail)) {
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
    if (queued.halted) break;
  }
};

const dispatchS3ListCampaign = async (
  campaign: ICampaign,
  state: DispatchState,
  listManifestKey: string,
  options: {
    appUrl: string;
    activeAllocationId?: string;
    globalLimits: Awaited<ReturnType<typeof getEffectiveRateLimits>>["globalLimits"];
    effectiveLimits: Awaited<ReturnType<typeof getEffectiveRateLimits>>["effectiveLimits"];
    hasRateLimitConfig: boolean;
    retryFailedRecipients?: boolean;
  }
) => {
  const manifest = await getListManifest(listManifestKey);
  let chunkIndex = Math.max(Number(campaign.dispatchCursorChunkIndex || 0), 0);
  let rowOffset = Math.max(Number(campaign.dispatchCursorRowOffset || 0), 0);

  // If the cursor is at the end of the list but pending recipients still exist,
  // reset the cursor so we re-scan and pick them up (e.g. after stalled jobs).
  if (chunkIndex >= manifest.chunkKeys.length) {
    const pendingCount = await CampaignRecipient.countDocuments({
      campaignId: campaign._id,
      status: { $in: ["pending", "failed"] },
    });
    if (pendingCount > 0) {
      logger.info("[dispatch] S3 cursor exhausted but pending recipients exist — resetting cursor", {
        campaignId: campaign._id.toString(),
        pendingCount,
      });
      chunkIndex = 0;
      rowOffset = 0;
      await Campaign.findByIdAndUpdate(campaign._id, {
        $set: { dispatchCursorChunkIndex: 0, dispatchCursorRowOffset: 0 },
      });
    }
  }

  while (!state.rateLimitReached && state.remainingCredits > 0 && state.remainingInRun > 0) {
    if (chunkIndex >= manifest.chunkKeys.length) {
      break;
    }

    const rows = await getChunkRows(manifest.chunkKeys[chunkIndex]);
    const windowRows = rows.slice(rowOffset);

    if (windowRows.length === 0) {
      chunkIndex += 1;
      rowOffset = 0;
      await Campaign.findByIdAndUpdate(campaign._id, {
        $set: { dispatchCursorChunkIndex: chunkIndex, dispatchCursorRowOffset: rowOffset },
      });
      continue;
    }

    const emails = windowRows.map((row) => row.email.toLowerCase());

    // Batch MX validate all unique domains in this batch
    const mxResult = await batchValidateMxRecords(emails);
    const validEmailSet = new Set(mxResult.valid.map((e) => e.toLowerCase()));

    if (mxResult.invalid.length > 0) {
      logger.warn("[dispatch:S3] Skipping recipients with invalid MX domains", {
        campaignId: campaign._id.toString(),
        count: mxResult.invalid.length,
        sample: mxResult.invalid.slice(0, 5).map((r) => r.email),
      });
    }

    const suppressed = await ListSuppression.find({
      listId: campaign.listId,
      email: { $in: emails },
    })
      .select("email")
      .lean();
    const suppressedSet = new Set(suppressed.map((item) => item.email.toLowerCase()));

    const existingRecipients = await CampaignRecipient.find({
      campaignId: campaign._id,
      email: { $in: emails },
    })
      .select("_id email status")
      .lean();
    const existingByEmail = new Map(existingRecipients.map((item) => [item.email.toLowerCase(), item]));

    const newRows = windowRows.filter(
      (row) => validEmailSet.has(row.email.toLowerCase()) && !suppressedSet.has(row.email.toLowerCase()) && !existingByEmail.has(row.email.toLowerCase())
    );

    const insertedIds = new Map<string, string>();
    if (newRows.length > 0) {
      const docsToInsert = newRows.map((row) => {
        const docId = new mongoose.Types.ObjectId();
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
        await CampaignRecipient.insertMany(docsToInsert, { ordered: false });
      } catch (error) {
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

    const actionableTargets: Array<QueueCandidate & { sourceIndex: number }> = [];
    for (const [index, row] of windowRows.entries()) {
      const normalizedEmail = row.email.toLowerCase();
      if (suppressedSet.has(normalizedEmail)) continue;
      
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
      } else if (pendingEmailSet.has(normalizedEmail)) {
        const pendingRecipient = existingByEmail.get(normalizedEmail);
        if (pendingRecipient) {
          actionableTargets.push({
            _id: pendingRecipient._id.toString(),
            email: pendingRecipient.email,
            sourceIndex: index,
            previousStatus: "pending",
          });
        }
      } else if (failedEmailSet.has(normalizedEmail)) {
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
      await Campaign.findByIdAndUpdate(campaign._id, {
        $set: { dispatchCursorChunkIndex: chunkIndex, dispatchCursorRowOffset: rowOffset },
      });
      continue;
    }

    const queueResult = await queueRecipientBatch(
      campaign,
      actionableTargets.map((item) => ({
        _id: item._id,
        email: item.email,
        previousStatus: item.previousStatus,
      })),
      state,
      options
    );

    if (queueResult.queuedCount === 0) {
      const firstActionableSourceIndex = actionableTargets[0]?.sourceIndex ?? 0;
      rowOffset += firstActionableSourceIndex;
    } else if (queueResult.queuedCount < actionableTargets.length) {
      rowOffset += actionableTargets[queueResult.queuedCount - 1].sourceIndex + 1;
    } else {
      rowOffset += windowRows.length;
    }

    if (rowOffset >= rows.length) {
      chunkIndex += 1;
      rowOffset = 0;
    }

    await Campaign.findByIdAndUpdate(campaign._id, {
      $set: { dispatchCursorChunkIndex: chunkIndex, dispatchCursorRowOffset: rowOffset },
    });

    if (queueResult.halted) {
      break;
    }
  }
};

export const dispatchCampaign = async (
  campaign: ICampaign,
  options: DispatchCampaignOptions = {}
): Promise<DispatchCampaignResult> => {
  const campaignIdStr = campaign._id.toString();
  const userIdStr = campaign.userId?.toString();

  const list = await List.findById(campaign.listId)
    .select("_id subscriberCount storageType s3ManifestKey")
    .lean();

  const totalSubscribers = list
    ? list.storageType === "s3"
      ? Number(list.subscriberCount || 0)
      : await Subscriber.countDocuments({
          listId: campaign.listId,
          status: "active",
        })
    : 0;

  logger.info("[dispatch] starting", { campaignId: campaignIdStr, userId: userIdStr, totalSubscribers, listStorageType: list?.storageType });

  if (totalSubscribers === 0) {
    logger.warn("[dispatch] no active subscribers — skipping", { campaignId: campaignIdStr });
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

  await Campaign.findByIdAndUpdate(campaign._id, {
    $set: { status: "sending", pauseReason: null, "stats.total": totalSubscribers },
  });

  const appUrl = process.env.APP_URL || "http://localhost:4400";
  const batchSize = Math.max(Number(process.env.CAMPAIGN_ENQUEUE_BATCH_SIZE) || 1000, 100);
  const dispatchSettings = await getPlatformDispatchSettings();
  const maxPerRun = dispatchSettings.maxPerRun;

  const activeAllocation = await getActiveEmailAllocation(campaign.userId.toString());
  const remainingCredits = activeAllocation
    ? Math.max(
        activeAllocation.emailsPurchased -
          activeAllocation.consumedEmails -
          activeAllocation.reservedEmails,
        0
      )
    : 0;

  logger.info("[dispatch] credit check", {
    campaignId: campaignIdStr,
    userId: userIdStr,
    hasAllocation: Boolean(activeAllocation),
    emailsPurchased: activeAllocation?.emailsPurchased ?? 0,
    consumedEmails: activeAllocation?.consumedEmails ?? 0,
    reservedEmails: activeAllocation?.reservedEmails ?? 0,
    remainingCredits,
    maxPerRun,
  });

  const state: DispatchState = {
    remainingCredits,
    remainingInRun: maxPerRun,
    totalQueued: 0,
    rateLimitReached: false,
  };

  const { globalLimits, effectiveLimits } = await getEffectiveRateLimits(campaign.userId.toString());
  const hasRateLimitConfig =
    effectiveLimits.perMinute !== undefined ||
    effectiveLimits.perHour !== undefined ||
    effectiveLimits.perDay !== undefined;

  logger.info("[dispatch] rate limit config", {
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
  } else {
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
