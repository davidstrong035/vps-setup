import { Response } from "express";
import Campaign from "../models/Campaign.model";
import CampaignRecipient from "../models/CampaignRecipient.model";
import List from "../models/List.model";
import Subscriber from "../models/Subscriber.model";
import { logAuditFromRequest } from "../services/audit-log.service";
import { dispatchCampaign, pauseCampaignAndReleaseQueue } from "../services/campaign-dispatch.service";
import { getActiveEmailAllocation } from "../services/email-allocation.service";
import { selectSendingDomain } from "../services/sending-domain.service";
import { AuthRequest } from "../types";

const isCampaignSchedulingEnabled = /^(1|true|yes|on)$/i.test(
  process.env.ENABLE_SCHEDULED_CAMPAIGN_DISPATCHER || "false"
);

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const sanitizeLocalPart = (value: string): string => {
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._+-]+/g, "");

  return sanitized || "no-reply";
};

const buildFromEmailForDomain = (
  rawFromEmail: string,
  fromName: string,
  domain: string
): string => {
  const localPart = String(rawFromEmail || "").trim().toLowerCase().split("@")[0];
  const fallbackLocalPart = sanitizeLocalPart(
    localPart || fromName.replace(/\s+/g, ".")
  );

  return `${fallbackLocalPart}@${domain.toLowerCase()}`;
};

const normalizeCampaignSender = async (input: {
  fromName: string;
  userId?: string | null;
}): Promise<{ fromEmail: string; sendingDomain?: string }> => {
  const resolvedDomain = await selectSendingDomain(null, input.userId ?? null);

  if (!resolvedDomain) {
    return { fromEmail: `no-reply@unknown` };
  }

  const safeLocalPart = sanitizeLocalPart(
    input.fromName.replace(/\s+/g, '.')
  );

  return {
    fromEmail: `${safeLocalPart}@${resolvedDomain}`,
    sendingDomain: resolvedDomain,
  };
};

export const getCampaigns = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaigns = await Campaign.find({ userId: req.userId }).sort({ createdAt: -1 });
    res.json({ campaigns });
  } catch (error) {
    res.status(500).json({ message: "Failed to get campaigns", error });
  }
};

export const getMyQueueOverview = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const userId = req.userId;
    if (!userId) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }

    const activeCampaigns = await Campaign.find({
      userId,
      status: { $in: ["sending", "scheduled", "paused"] },
    })
      .select("_id name status scheduledAt stats")
      .sort({ updatedAt: -1 })
      .lean();

    if (activeCampaigns.length === 0) {
      res.json({
        summary: {
          sendingCampaigns: 0,
          scheduledCampaigns: 0,
          pausedCampaigns: 0,
          queuedRecipients: 0,
          sentRecipients: 0,
          failedRecipients: 0,
          lastUpdatedAt: new Date().toISOString(),
        },
        campaigns: [],
      });
      return;
    }

    const campaignIds = activeCampaigns.map((campaign) => campaign._id);

    const grouped = await CampaignRecipient.aggregate<{
      _id: { campaignId: string; status: string };
      count: number;
    }>([
      {
        $match: {
          campaignId: { $in: campaignIds },
          userId,
        },
      },
      {
        $group: {
          _id: { campaignId: "$campaignId", status: "$status" },
          count: { $sum: 1 },
        },
      },
    ]);

    const queueByCampaign = new Map<
      string,
      {
        queued: number;
        sent: number;
        failed: number;
        bounced: number;
        complained: number;
      }
    >();

    for (const row of grouped) {
      const campaignId = String(row._id.campaignId);
      const status = String(row._id.status);

      if (!queueByCampaign.has(campaignId)) {
        queueByCampaign.set(campaignId, {
          queued: 0,
          sent: 0,
          failed: 0,
          bounced: 0,
          complained: 0,
        });
      }

      const current = queueByCampaign.get(campaignId)!;
      if (status === "queued") current.queued = row.count;
      if (status === "sent") current.sent = row.count;
      if (status === "failed") current.failed = row.count;
      if (status === "bounced") current.bounced = row.count;
      if (status === "complained") current.complained = row.count;
    }

    const campaigns = activeCampaigns.map((campaign) => {
      const queue = queueByCampaign.get(String(campaign._id)) || {
        queued: 0,
        sent: 0,
        failed: 0,
        bounced: 0,
        complained: 0,
      };

      const totalExpected = campaign.stats?.total || 0;
      const totalProcessed =
        queue.sent + queue.failed + queue.bounced + queue.complained;
      const remaining = Math.max(totalExpected - totalProcessed, 0);

      return {
        campaignId: campaign._id,
        name: campaign.name,
        status: campaign.status,
        scheduledAt: campaign.scheduledAt,
        queue: {
          ...queue,
          totalExpected,
          totalProcessed,
          remaining,
        },
      };
    });

    const summary = campaigns.reduce(
      (acc, campaign) => {
        if (campaign.status === "sending") acc.sendingCampaigns += 1;
        if (campaign.status === "scheduled") acc.scheduledCampaigns += 1;
        if (campaign.status === "paused") acc.pausedCampaigns += 1;
        acc.queuedRecipients += campaign.queue.queued;
        acc.sentRecipients += campaign.queue.sent;
        acc.failedRecipients += campaign.queue.failed + campaign.queue.bounced + campaign.queue.complained;
        return acc;
      },
      {
        sendingCampaigns: 0,
        scheduledCampaigns: 0,
        pausedCampaigns: 0,
        queuedRecipients: 0,
        sentRecipients: 0,
        failedRecipients: 0,
      },
    );

    res.json({
      summary: {
        ...summary,
        lastUpdatedAt: new Date().toISOString(),
      },
      campaigns,
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to get queue overview", error });
  }
};

export const createCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const {
      name,
      subject,
      fromName,
      fromEmail,
      listId,
      html,
      templateId,
      scheduledAt,
    } = req.body;

    if (!name || !subject || !fromName || !listId || !html) {
      await logAuditFromRequest(req, {
        action: "campaign.create",
        resourceType: "campaign",
        status: "failure",
        metadata: { reason: "missing_required_fields" },
      });
      res.status(400).json({ message: "Missing required fields" });
      return;
    }

    const parsedScheduledAt = scheduledAt ? new Date(String(scheduledAt)) : undefined;
    if (parsedScheduledAt && Number.isNaN(parsedScheduledAt.getTime())) {
      await logAuditFromRequest(req, {
        action: "campaign.create",
        resourceType: "campaign",
        status: "failure",
        metadata: { reason: "invalid_scheduled_at" },
      });
      res.status(400).json({ message: "Invalid scheduledAt value" });
      return;
    }

    if (parsedScheduledAt && !isCampaignSchedulingEnabled) {
      await logAuditFromRequest(req, {
        action: "campaign.create",
        resourceType: "campaign",
        status: "failure",
        metadata: { reason: "scheduling_disabled" },
      });
      res.status(400).json({ message: "Campaign scheduling is currently disabled" });
      return;
    }

    const shouldSchedule = parsedScheduledAt && parsedScheduledAt.getTime() > Date.now();
    const sender = await normalizeCampaignSender({
      fromName: String(fromName),
      userId: req.userId,
    });

    const campaign = await Campaign.create({
      userId: req.userId,
      name,
      subject,
      fromName,
      fromEmail: sender.fromEmail,
      sendingDomain: sender.sendingDomain,
      listId,
      html,
      templateId,
      scheduledAt: parsedScheduledAt,
      status: shouldSchedule ? "scheduled" : "draft",
    });

    await logAuditFromRequest(req, {
      action: "campaign.create",
      resourceType: "campaign",
      resourceId: campaign._id.toString(),
      status: "success",
      metadata: { status: campaign.status, scheduledAt: campaign.scheduledAt },
    });

    res.status(201).json({ campaign });
  } catch (error) {
    res.status(500).json({ message: "Failed to create campaign", error });
  }
};

export const getCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.userId });
    if (!campaign) {
      res.status(404).json({ message: "Campaign not found" });
      return;
    }
    res.json({ campaign });
  } catch (error) {
    res.status(500).json({ message: "Failed to get campaign", error });
  }
};

export const updateCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaignId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const campaign = await Campaign.findOne({ _id: campaignId, userId: req.userId });
    if (!campaign) {
      res.status(404).json({ message: "Campaign not found" });
      return;
    }
    if (!["draft", "scheduled"].includes(campaign.status)) {
      res.status(400).json({ message: "Only draft or scheduled campaigns can be edited" });
      return;
    }

    const updates = { ...req.body } as Record<string, unknown>;

    if (
      Object.prototype.hasOwnProperty.call(updates, "fromName") ||
      Object.prototype.hasOwnProperty.call(updates, "sendingDomain")
    ) {
      const normalizedSender = await normalizeCampaignSender({
        fromName: String(updates.fromName ?? campaign.fromName),
        userId: req.userId,
      });

      updates.fromEmail = normalizedSender.fromEmail;
      updates.sendingDomain = normalizedSender.sendingDomain;
    }

    if (Object.prototype.hasOwnProperty.call(updates, "scheduledAt")) {
      const rawScheduledAt = updates.scheduledAt;

      if (rawScheduledAt === null || rawScheduledAt === "") {
        updates.scheduledAt = undefined;
        updates.status = "draft";
      } else {
        if (!isCampaignSchedulingEnabled) {
          res.status(400).json({ message: "Campaign scheduling is currently disabled" });
          return;
        }

        const parsedScheduledAt = new Date(String(rawScheduledAt));
        if (Number.isNaN(parsedScheduledAt.getTime())) {
          res.status(400).json({ message: "Invalid scheduledAt value" });
          return;
        }

        updates.scheduledAt = parsedScheduledAt;
        updates.status = parsedScheduledAt.getTime() > Date.now() ? "scheduled" : "draft";
      }
    }

    const updated = await Campaign.findByIdAndUpdate(
      campaignId,
      { $set: updates },
      { returnDocument: "after" }
    );

    await logAuditFromRequest(req, {
      action: "campaign.update",
      resourceType: "campaign",
      resourceId: campaignId,
      status: "success",
      metadata: {
        fieldsUpdated: Object.keys(updates),
        status: updated?.status,
      },
    });

    res.json({ campaign: updated });
  } catch (error) {
    res.status(500).json({ message: "Failed to update campaign", error });
  }
};

export const deleteCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaignId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const campaign = await Campaign.findOneAndDelete({
      _id: campaignId,
      userId: req.userId,
      status: "draft",
    });
    if (!campaign) {
      res.status(404).json({ message: "Campaign not found or not in draft status" });
      return;
    }

    await logAuditFromRequest(req, {
      action: "campaign.delete",
      resourceType: "campaign",
      resourceId: campaignId,
      status: "success",
    });

    res.json({ message: "Campaign deleted" });
  } catch (error) {
    res.status(500).json({ message: "Failed to delete campaign", error });
  }
};

export const sendCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaignId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const campaign = await Campaign.findOne({ _id: campaignId, userId: req.userId });
    if (!campaign) {
      await logAuditFromRequest(req, {
        action: "campaign.send",
        resourceType: "campaign",
        resourceId: campaignId,
        status: "failure",
        metadata: { reason: "campaign_not_found" },
      });
      res.status(404).json({ message: "Campaign not found" });
      return;
    }
    if (!["draft", "paused", "scheduled", "sending"].includes(campaign.status)) {
      await logAuditFromRequest(req, {
        action: "campaign.send",
        resourceType: "campaign",
        resourceId: campaign._id.toString(),
        status: "failure",
        metadata: { reason: "invalid_status", status: campaign.status },
      });
      res.status(400).json({ message: "Campaign cannot be sent in its current state" });
      return;
    }

    if (campaign.status === "sending") {
      res.status(409).json({
        message:
          "Campaign is already sending. Please wait for queue processing updates instead of clicking resume.",
      });
      return;
    }

    if (campaign.status === "paused") {
      // Resume should re-scan from the beginning so pending recipients from earlier chunks are discoverable.
      await Campaign.findByIdAndUpdate(campaign._id, {
        $set: {
          dispatchCursorChunkIndex: 0,
          dispatchCursorRowOffset: 0,
        },
      });
      campaign.dispatchCursorChunkIndex = 0;
      campaign.dispatchCursorRowOffset = 0;
    }

    // Pre-flight: verify user has enough send credits for all active subscribers
    const list = await List.findOne({ _id: campaign.listId, userId: req.userId })
      .select("subscriberCount storageType")
      .lean();

    const totalActiveSubscribers = list?.storageType === "s3"
      ? Number(list.subscriberCount || 0)
      : await Subscriber.countDocuments({
          listId: campaign.listId,
          status: "active",
        });

    if (totalActiveSubscribers > 0) {
      const activeAllocation = await getActiveEmailAllocation(campaign.userId.toString());
      const remainingCredits = activeAllocation
        ? Math.max(
            activeAllocation.emailsPurchased - activeAllocation.consumedEmails - activeAllocation.reservedEmails,
            0
          )
        : 0;

      if (!activeAllocation) {
        await logAuditFromRequest(req, {
          action: "campaign.send",
          resourceType: "campaign",
          resourceId: campaign._id.toString(),
          status: "failure",
          metadata: { reason: "no_active_email_package" },
        });
        res.status(403).json({
          message: "You do not have an active email package. Contact admin after payment confirmation.",
          totalActiveSubscribers,
          remainingCredits: 0,
        });
        return;
      }

      if (totalActiveSubscribers > remainingCredits) {
        await logAuditFromRequest(req, {
          action: "campaign.send",
          resourceType: "campaign",
          resourceId: campaign._id.toString(),
          status: "failure",
          metadata: { reason: "insufficient_credits", totalActiveSubscribers, remainingCredits },
        });
        res.status(403).json({
          message: `Your email package has only ${remainingCredits.toLocaleString()} remaining credits, but this campaign targets ${totalActiveSubscribers.toLocaleString()} subscribers. Top up your credits or reduce the list.`,
          totalActiveSubscribers,
          remainingCredits,
        });
        return;
      }
    }

    const result = await dispatchCampaign(campaign, {
      retryFailedRecipients: campaign.status === "paused",
    });
    if (result.totalActiveSubscribers === 0) {
      await logAuditFromRequest(req, {
        action: "campaign.send",
        resourceType: "campaign",
        resourceId: campaign._id.toString(),
        status: "failure",
        metadata: { reason: "no_active_subscribers" },
      });
      res.status(400).json({ message: "No active subscribers in this list" });
      return;
    }

    if (result.queued === 0 && !result.hasActiveAllocation) {
      await logAuditFromRequest(req, {
        action: "campaign.send",
        resourceType: "campaign",
        resourceId: campaign._id.toString(),
        status: "failure",
        metadata: { reason: "no_active_email_package" },
      });
      res.status(403).json({
        message: "You do not have an active email package. Contact admin after payment confirmation.",
        totalActiveSubscribers: result.totalActiveSubscribers,
        queued: 0,
      });
      return;
    }

    if (result.queued === 0 && result.creditLimited) {
      await logAuditFromRequest(req, {
        action: "campaign.send",
        resourceType: "campaign",
        resourceId: campaign._id.toString(),
        status: "failure",
        metadata: { reason: "email_package_exhausted", totalActiveSubscribers: result.totalActiveSubscribers },
      });
      res.status(403).json({
        message: "Your email package has no remaining credits.",
        totalActiveSubscribers: result.totalActiveSubscribers,
        queued: 0,
      });
      return;
    }

    if (result.queued === 0 && result.rateLimited) {
      await logAuditFromRequest(req, {
        action: "campaign.send",
        resourceType: "campaign",
        resourceId: campaign._id.toString(),
        status: "success",
        metadata: { reason: "rate_limited", totalActiveSubscribers: result.totalActiveSubscribers },
      });
      res.status(202).json({
        message:
          "Campaign is throttled by your send limit and will continue automatically when the limit window resets.",
        totalActiveSubscribers: result.totalActiveSubscribers,
        queued: 0,
        throttled: true,
      });
      return;
    }

    if (result.queued === 0 && result.alreadyCompleted) {
      await logAuditFromRequest(req, {
        action: "campaign.send",
        resourceType: "campaign",
        resourceId: campaign._id.toString(),
        status: "success",
        metadata: {
          reason: "already_completed",
          totalActiveSubscribers: result.totalActiveSubscribers,
        },
      });
      res.json({
        message: "This campaign has already been fully delivered to all active recipients.",
        totalActiveSubscribers: result.totalActiveSubscribers,
        queued: 0,
      });
      return;
    }

    if (result.queued === 0) {
      await logAuditFromRequest(req, {
        action: "campaign.send",
        resourceType: "campaign",
        resourceId: campaign._id.toString(),
        status: "failure",
        metadata: {
          reason: "no_retryable_recipients",
          totalActiveSubscribers: result.totalActiveSubscribers,
        },
      });
      res.status(409).json({
        message:
          campaign.status === "paused"
            ? "No recipients were re-queued. Any remaining failures are already finalized in the Dead Letter Queue until you retry after fixing the root cause."
            : "No recipients were queued for this campaign.",
        totalActiveSubscribers: result.totalActiveSubscribers,
        queued: 0,
      });
      return;
    }

    const message =
      result.creditLimited && result.queued > 0
        ? `Campaign partially queued for ${result.queued} recipients because the user's email package limit was reached`
        : result.remainingAllowance === 0
          ? `Campaign partially queued for ${result.queued} recipients due to current send limits`
          : campaign.status === "paused"
            ? `Campaign resumed and queued for ${result.queued} recipients`
            : `Campaign queued for ${result.queued} recipients`;

    res.json({
      message,
      totalActiveSubscribers: result.totalActiveSubscribers,
      queued: result.queued,
    });

    await logAuditFromRequest(req, {
      action: "campaign.send",
      resourceType: "campaign",
      resourceId: campaign._id.toString(),
      status: "success",
      metadata: {
        queued: result.queued,
        totalActiveSubscribers: result.totalActiveSubscribers,
        rateLimited: result.rateLimited,
        alreadyCompleted: result.alreadyCompleted,
      },
    });
  } catch (error) {
    res.status(500).json({ message: "Failed to send campaign", error });
  }
};

export const scheduleCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    if (!isCampaignSchedulingEnabled) {
      await logAuditFromRequest(req, {
        action: "campaign.schedule",
        resourceType: "campaign",
        status: "failure",
        metadata: { reason: "scheduling_disabled" },
      });
      res.status(403).json({ message: "Campaign scheduling is currently disabled" });
      return;
    }

    const campaignId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const campaign = await Campaign.findOne({ _id: campaignId, userId: req.userId });
    if (!campaign) {
      await logAuditFromRequest(req, {
        action: "campaign.schedule",
        resourceType: "campaign",
        resourceId: campaignId,
        status: "failure",
        metadata: { reason: "campaign_not_found" },
      });
      res.status(404).json({ message: "Campaign not found" });
      return;
    }

    if (!["draft", "paused", "scheduled"].includes(campaign.status)) {
      await logAuditFromRequest(req, {
        action: "campaign.schedule",
        resourceType: "campaign",
        resourceId: campaign._id.toString(),
        status: "failure",
        metadata: { reason: "invalid_status", status: campaign.status },
      });
      res.status(400).json({ message: "Campaign cannot be scheduled in its current state" });
      return;
    }

    const { scheduledAt } = req.body as { scheduledAt?: string };
    if (!scheduledAt) {
      await logAuditFromRequest(req, {
        action: "campaign.schedule",
        resourceType: "campaign",
        resourceId: campaign._id.toString(),
        status: "failure",
        metadata: { reason: "scheduled_at_missing" },
      });
      res.status(400).json({ message: "scheduledAt is required" });
      return;
    }

    const parsedScheduledAt = new Date(scheduledAt);
    if (Number.isNaN(parsedScheduledAt.getTime())) {
      await logAuditFromRequest(req, {
        action: "campaign.schedule",
        resourceType: "campaign",
        resourceId: campaign._id.toString(),
        status: "failure",
        metadata: { reason: "scheduled_at_invalid" },
      });
      res.status(400).json({ message: "Invalid scheduledAt value" });
      return;
    }

    if (parsedScheduledAt.getTime() <= Date.now()) {
      await logAuditFromRequest(req, {
        action: "campaign.schedule",
        resourceType: "campaign",
        resourceId: campaign._id.toString(),
        status: "failure",
        metadata: { reason: "scheduled_at_not_future" },
      });
      res.status(400).json({ message: "scheduledAt must be in the future" });
      return;
    }

    const updated = await Campaign.findByIdAndUpdate(
      campaign._id,
      {
        $set: {
          status: "scheduled",
          scheduledAt: parsedScheduledAt,
        },
      },
      { returnDocument: "after" }
    );

    await logAuditFromRequest(req, {
      action: "campaign.schedule",
      resourceType: "campaign",
      resourceId: campaign._id.toString(),
      status: "success",
      metadata: { scheduledAt: parsedScheduledAt.toISOString() },
    });

    res.json({ campaign: updated });
  } catch (error) {
    res.status(500).json({ message: "Failed to schedule campaign", error });
  }
};

export const getCampaignStats = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.userId }).select(
      "name status stats sentAt"
    );
    if (!campaign) {
      res.status(404).json({ message: "Campaign not found" });
      return;
    }
    res.json({ campaign });
  } catch (error) {
    res.status(500).json({ message: "Failed to get stats", error });
  }
};

export const pauseUserCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.userId });
    if (!campaign) {
      res.status(404).json({ message: "Campaign not found" });
      return;
    }
    if (campaign.status !== "sending") {
      res.status(400).json({ message: "Only a sending campaign can be paused" });
      return;
    }

    await pauseCampaignAndReleaseQueue(campaign._id.toString(), "Paused by user", "user");

    await logAuditFromRequest(req, {
      action: "campaign.pause",
      resourceType: "campaign",
      resourceId: campaign._id.toString(),
      status: "success",
      metadata: { campaignName: campaign.name },
    });

    res.json({ message: "Campaign paused successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to pause campaign", error });
  }
};

export const cancelUserCampaign = async (req: AuthRequest, res: Response): Promise<void> => {
  try {
    const campaign = await Campaign.findOne({ _id: req.params.id, userId: req.userId });
    if (!campaign) {
      res.status(404).json({ message: "Campaign not found" });
      return;
    }
    if (!["sending", "paused", "scheduled"].includes(campaign.status)) {
      res.status(400).json({ message: "Campaign cannot be cancelled in its current state" });
      return;
    }

    // Release queue and credits first
    await pauseCampaignAndReleaseQueue(campaign._id.toString(), "Cancelled by user", "user");

    // Then mark as cancelled (overwrite the "paused" set by pauseCampaignAndReleaseQueue)
    await Campaign.findByIdAndUpdate(campaign._id, {
      status: "cancelled",
      pauseReason: "Cancelled by user",
    });

    // Reset all pending/queued recipients so stats are accurate
    await CampaignRecipient.updateMany(
      { campaignId: campaign._id, status: { $in: ["pending", "queued"] } },
      { $set: { status: "cancelled" } },
    );

    await logAuditFromRequest(req, {
      action: "campaign.cancel",
      resourceType: "campaign",
      resourceId: campaign._id.toString(),
      status: "success",
      metadata: { campaignName: campaign.name },
    });

    res.json({ message: "Campaign cancelled successfully" });
  } catch (error) {
    res.status(500).json({ message: "Failed to cancel campaign", error });
  }
};
