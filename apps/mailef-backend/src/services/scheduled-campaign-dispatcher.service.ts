import Campaign from "../models/Campaign.model";
import { dispatchCampaign } from "./campaign-dispatch.service";
import { logAuditEvent } from "./audit-log.service";
import { logger } from "../utils/logger";

let schedulerTimer: NodeJS.Timeout | null = null;
let isDispatching = false;

const dispatchDueCampaigns = async () => {
  if (isDispatching) return;

  isDispatching = true;
  try {
    const dueCampaigns = await Campaign.find({
      status: "scheduled",
      scheduledAt: { $lte: new Date() },
    })
      .sort({ scheduledAt: 1 })
      .limit(20);

    for (const campaign of dueCampaigns) {
      try {
        const result = await dispatchCampaign(campaign);

        if (result.totalActiveSubscribers === 0) {
          await Campaign.findByIdAndUpdate(campaign._id, {
            $set: {
              status: "paused",
              pauseReason: "Campaign paused because the selected list has no active subscribers.",
            },
          });
          await logAuditEvent({
            actorType: "system",
            action: "campaign.scheduled_dispatch",
            resourceType: "campaign",
            resourceId: campaign._id.toString(),
            targetUserId: campaign.userId.toString(),
            status: "failure",
            metadata: { reason: "no_active_subscribers" },
          });
          logger.warn("Scheduled campaign has no active subscribers", {
            campaignId: campaign._id.toString(),
            userId: campaign.userId.toString(),
          });
          continue;
        }

        await logAuditEvent({
          actorType: "system",
          action: "campaign.scheduled_dispatch",
          resourceType: "campaign",
          resourceId: campaign._id.toString(),
          targetUserId: campaign.userId.toString(),
          status: "success",
          metadata: {
            queued: result.queued,
            rateLimited: result.rateLimited,
            remainingAllowance: result.remainingAllowance,
          },
        });

        logger.info("Scheduled campaign dispatch completed", {
          campaignId: campaign._id.toString(),
          queued: result.queued,
          rateLimited: result.rateLimited,
          remainingAllowance: result.remainingAllowance,
        });
      } catch (error) {
        await logAuditEvent({
          actorType: "system",
          action: "campaign.scheduled_dispatch",
          resourceType: "campaign",
          resourceId: campaign._id.toString(),
          targetUserId: campaign.userId.toString(),
          status: "failure",
          metadata: {
            reason: "dispatch_error",
            error: error instanceof Error ? error.message : String(error),
          },
        });
        logger.error("Failed to dispatch scheduled campaign", {
          campaignId: campaign._id.toString(),
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    isDispatching = false;
  }
};

export const startScheduledCampaignDispatcher = (): void => {
  if (schedulerTimer) return;

  const intervalMs = Math.max(Number(process.env.SCHEDULED_DISPATCH_INTERVAL_MS) || 30000, 5000);

  schedulerTimer = setInterval(() => {
    dispatchDueCampaigns().catch((error) => {
      logger.error("Scheduled campaign dispatcher tick failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  }, intervalMs);

  dispatchDueCampaigns().catch((error) => {
    logger.error("Initial scheduled campaign dispatch failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  });
};
