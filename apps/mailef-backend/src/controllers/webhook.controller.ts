import { Request, Response } from "express";
import Campaign from "../models/Campaign.model";
import CampaignRecipient from "../models/CampaignRecipient.model";
import List from "../models/List.model";
import ListSuppression from "../models/ListSuppression.model";
import Subscriber from "../models/Subscriber.model";
import WebhookEvent from "../models/WebhookEvent.model";
import { logger } from "../utils/logger";

const MAX_WEBHOOK_RAW_PAYLOAD_CHARS = 16_000;

const updateSendingDomainHealth = async (
  fromEmail: string | undefined,
  change: { bounce?: number; complaint?: number; reputationDelta?: number; field?: string }
) => {
  if (!fromEmail || !fromEmail.includes("@")) return;

  const domain = fromEmail.split("@")[1].toLowerCase();
  const { SendingDomain } = require("../models/SendingDomain.model");
  const update: Record<string, unknown> = {
    ...(change.bounce ? { $inc: { bounceCount: change.bounce } } : {}),
  };

  if (change.complaint || change.reputationDelta) {
    update.$inc = {
      ...(update.$inc as Record<string, number> | undefined),
      ...(change.complaint ? { complaintCount: change.complaint } : {}),
      ...(change.reputationDelta ? { reputationScore: change.reputationDelta } : {}),
    };
  }

  if (change.field) {
    update.$set = { [change.field]: new Date() };
  }

  SendingDomain.findOneAndUpdate({ domain }, update, { returnDocument: "before" }).catch(() => {});
};

const toRawPayloadSnippet = (payload: unknown): string | undefined => {
  try {
    const serialized = JSON.stringify(payload);
    if (!serialized) return undefined;

    if (serialized.length <= MAX_WEBHOOK_RAW_PAYLOAD_CHARS) {
      return serialized;
    }

    return `${serialized.slice(0, MAX_WEBHOOK_RAW_PAYLOAD_CHARS)}...`;
  } catch {
    return undefined;
  }
};

const isPostalWebhookAuthorized = (req: Request): boolean => {
  const expectedToken = process.env.POSTAL_WEBHOOK_TOKEN?.trim();
  if (!expectedToken) return true;

  const authHeader = req.get("authorization") || "";
  const bearerToken = authHeader.startsWith("Bearer ")
    ? authHeader.slice("Bearer ".length).trim()
    : "";
  const headerToken =
    req.get("x-postal-webhook-token") || req.get("x-webhook-token") || "";
  const queryToken = typeof req.query.token === "string" ? req.query.token : "";

  return [bearerToken, headerToken, queryToken].some(
    (candidate) => candidate === expectedToken
  );
};

const looksLikePostalComplaint = (payload: Record<string, any>): boolean => {
  const candidateFields = [
    payload.event,
    payload.type,
    payload.status,
    payload.name,
    payload.feedback_type,
    payload.complaint?.feedback_type,
    payload.details,
    payload.output,
    payload.description,
    payload.bounce?.subject,
  ]
    .filter((value) => typeof value === "string")
    .join(" ")
    .toLowerCase();

  if (/(complain|spam complaint|feedback loop|fbl)/i.test(candidateFields)) {
    return true;
  }

  const spamStatus = String(
    payload.message?.spam_status || payload.original_message?.spam_status || ""
  )
    .trim()
    .toLowerCase();

  return Boolean(
    spamStatus &&
      !["notspam", "not_spam", "clean"].includes(spamStatus) &&
      /(spam|complain)/i.test(spamStatus)
  );
};

const resolvePostalEventType = (payload: Record<string, any>): string => {
  const explicitEvent =
    typeof payload.event === "string"
      ? payload.event
      : typeof payload.type === "string"
        ? payload.type
        : "";

  if (/(complain|spam.?complaint|feedback)/i.test(explicitEvent)) {
    return "MessageComplaint";
  }

  if (explicitEvent) return explicitEvent;
  if (looksLikePostalComplaint(payload)) return "MessageComplaint";
  if (payload.original_message && payload.bounce) return "MessageBounced";
  if (payload.url && payload.message) return "MessageLinkClicked";
  if (payload.ip_address && payload.user_agent && payload.message) return "MessageLoaded";

  const status = String(payload.status || "").trim().toLowerCase();
  if (status === "sent") return "MessageSent";
  if (status === "delayed") return "MessageDelayed";
  if (status === "held") return "MessageHeld";
  if (status.includes("fail")) return "MessageDeliveryFailed";

  return "Unknown";
};

const resolvePostalMessageId = (payload: Record<string, any>): string => {
  return String(
    payload.message?.message_id || payload.original_message?.message_id || ""
  ).trim();
};

const resolvePostalEventId = (
  payload: Record<string, any>,
  eventType: string,
  messageId: string
): string => {
  const preferred =
    payload.id ||
    payload.uuid ||
    payload.token ||
    payload.message?.token ||
    payload.original_message?.token ||
    payload.bounce?.token;
  const timestamp =
    payload.timestamp || payload.message?.timestamp || payload.original_message?.timestamp;

  return String(preferred || `${eventType}:${messageId || "unknown"}:${timestamp || Date.now()}`);
};

export const handleSESWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;

    // SNS subscription confirmation
    if (body.Type === "SubscriptionConfirmation") {
      await fetch(body.SubscribeURL);
      res.sendStatus(200);
      return;
    }

    if (body.Type !== "Notification") {
      res.sendStatus(200);
      return;
    }

    if (!body.MessageId) {
      res.sendStatus(200);
      return;
    }

    try {
      const shouldStoreRawPayload =
        /^(1|true|yes|on)$/i.test(process.env.WEBHOOK_STORE_RAW_PAYLOAD || "true");

      await WebhookEvent.create({
        source: "ses",
        eventId: body.MessageId,
        eventType: body.Type,
        ...(shouldStoreRawPayload
          ? { rawPayload: toRawPayloadSnippet(body) }
          : {}),
        receivedAt: new Date(),
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        // duplicate SNS notification
        res.sendStatus(200);
        return;
      }
      throw error;
    }

    const sesEvent = typeof body.Message === "string" ? JSON.parse(body.Message) : body.Message;
    const eventType: string = sesEvent?.eventType || sesEvent?.notificationType;
    const messageId: string = sesEvent?.mail?.messageId;

    if (!messageId) {
      res.sendStatus(200);
      return;
    }

    const recipient = await CampaignRecipient.findOne({ messageId });
    if (!recipient) {
      res.sendStatus(200);
      return;
    }

    const list = await List.findById(recipient.listId).select("userId").lean();
    const upsertSuppression = async (
      status: "bounced" | "complained",
      source: "ses_bounce" | "ses_complaint"
    ) => {
      if (!list?.userId) return;

      await ListSuppression.findOneAndUpdate(
        { listId: recipient.listId, email: recipient.email.toLowerCase() },
        {
          $set: {
            userId: list.userId,
            listId: recipient.listId,
            email: recipient.email.toLowerCase(),
            status,
            source,
          },
        },
        { upsert: true, returnDocument: "after" }
      );
    };

    switch (eventType) {
      case "Bounce": {
        if (recipient.status !== "bounced") {
          await CampaignRecipient.findByIdAndUpdate(recipient._id, {
            $set: { status: "bounced", bouncedAt: new Date() },
          });
          if (recipient.subscriberId) {
            await Subscriber.updateOne(
              { _id: recipient.subscriberId },
              { $set: { status: "bounced" } }
            );
          }
          await upsertSuppression("bounced", "ses_bounce");
          await Campaign.findByIdAndUpdate(recipient.campaignId, {
            $inc: { "stats.bounced": 1 },
          });

          await updateSendingDomainHealth(recipient.fromEmail, {
            bounce: 1,
            reputationDelta: -10,
            field: "lastBounceAt",
          });
        }
        break;
      }

      case "Complaint": {
        if (recipient.status !== "complained") {
          await CampaignRecipient.findByIdAndUpdate(recipient._id, {
            $set: { status: "complained", complainedAt: new Date() },
          });
          if (recipient.subscriberId) {
            await Subscriber.updateOne(
              { _id: recipient.subscriberId },
              { $set: { status: "complained" } }
            );
          }
          await upsertSuppression("complained", "ses_complaint");
          await Campaign.findByIdAndUpdate(recipient.campaignId, {
            $inc: { "stats.complained": 1 },
          });

          await updateSendingDomainHealth(recipient.fromEmail, {
            complaint: 1,
            reputationDelta: -25,
            field: "lastComplaintAt",
          });
        }
        break;
      }

      case "Open": {
        if (!recipient.openedAt) {
          await CampaignRecipient.findByIdAndUpdate(recipient._id, {
            $set: { openedAt: new Date() },
          });
          await Campaign.findByIdAndUpdate(recipient.campaignId, {
            $inc: { "stats.opened": 1 },
          });
        }
        break;
      }

      case "Click": {
        if (!recipient.clickedAt) {
          await CampaignRecipient.findByIdAndUpdate(recipient._id, {
            $set: { clickedAt: new Date() },
          });
          await Campaign.findByIdAndUpdate(recipient.campaignId, {
            $inc: { "stats.clicked": 1 },
          });
        }
        break;
      }

      default:
        break;
    }

    res.sendStatus(200);
  } catch (error) {
    logger.error("Webhook error", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.sendStatus(200); // always return 200 to SNS to avoid retries
  }
};

export const handlePostalWebhook = async (req: Request, res: Response): Promise<void> => {
  try {
    if (!isPostalWebhookAuthorized(req)) {
      res.sendStatus(401);
      return;
    }

    const payload = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const eventType = resolvePostalEventType(payload || {});
    const messageId = resolvePostalMessageId(payload || {});
    const eventId = resolvePostalEventId(payload || {}, eventType, messageId);

    try {
      const shouldStoreRawPayload =
        /^(1|true|yes|on)$/i.test(process.env.WEBHOOK_STORE_RAW_PAYLOAD || "true");

      await WebhookEvent.create({
        source: "postal",
        eventId,
        eventType,
        ...(shouldStoreRawPayload ? { rawPayload: toRawPayloadSnippet(payload) } : {}),
        receivedAt: new Date(),
      });
    } catch (error: any) {
      if (error?.code === 11000) {
        res.sendStatus(200);
        return;
      }
      throw error;
    }

    if (!messageId) {
      res.sendStatus(200);
      return;
    }

    const recipient = await CampaignRecipient.findOne({ messageId });
    if (!recipient) {
      res.sendStatus(200);
      return;
    }

    const list = await List.findById(recipient.listId).select("userId").lean();
    const upsertSuppression = async (
      status: "bounced" | "complained",
      source: "postal_bounce" | "postal_complaint"
    ) => {
      if (!list?.userId) return;

      await ListSuppression.findOneAndUpdate(
        { listId: recipient.listId, email: recipient.email.toLowerCase() },
        {
          $set: {
            userId: list.userId,
            listId: recipient.listId,
            email: recipient.email.toLowerCase(),
            status,
            source,
          },
        },
        { upsert: true, returnDocument: "after" }
      );
    };

    switch (eventType) {
      case "MessageSent": {
        if (recipient.status !== "sent") {
          await CampaignRecipient.findByIdAndUpdate(recipient._id, {
            $set: { status: "sent", sentAt: new Date(), lastError: null },
          });
          await Campaign.findByIdAndUpdate(recipient.campaignId, {
            $inc: { "stats.sent": 1 },
          });
        } else if (!recipient.sentAt) {
          await CampaignRecipient.findByIdAndUpdate(recipient._id, {
            $set: { sentAt: new Date(), lastError: null },
          });
        }
        break;
      }

      case "MessageDeliveryFailed":
      case "MessageHeld": {
        if (!["bounced", "complained", "failed"].includes(recipient.status)) {
          await CampaignRecipient.findByIdAndUpdate(recipient._id, {
            $set: {
              status: "failed",
              lastError:
                String(payload?.details || payload?.output || "Delivery failed").slice(0, 500),
            },
          });
          await Campaign.findByIdAndUpdate(recipient.campaignId, {
            $inc: { "stats.failed": 1 },
          });
        }
        break;
      }

      case "MessageDelayed": {
        await CampaignRecipient.findByIdAndUpdate(recipient._id, {
          $set: {
            lastError: String(payload?.details || payload?.output || "Message delayed").slice(
              0,
              500
            ),
          },
        });
        break;
      }

      case "MessageComplaint":
      case "MessageComplained":
      case "MessageSpamComplaint":
      case "SpamComplaint": {
        if (recipient.status !== "complained") {
          await CampaignRecipient.findByIdAndUpdate(recipient._id, {
            $set: {
              status: "complained",
              complainedAt: new Date(),
              lastError: String(
                payload?.details || payload?.description || "Spam complaint received"
              ).slice(0, 500),
            },
          });
          if (recipient.subscriberId) {
            await Subscriber.updateOne(
              { _id: recipient.subscriberId },
              { $set: { status: "complained" } }
            );
          }
          await upsertSuppression("complained", "postal_complaint");
          await Campaign.findByIdAndUpdate(recipient.campaignId, {
            $inc: { "stats.complained": 1 },
          });
          await updateSendingDomainHealth(recipient.fromEmail, {
            complaint: 1,
            reputationDelta: -25,
            field: "lastComplaintAt",
          });
        }
        break;
      }

      case "MessageBounced": {
        if (recipient.status !== "bounced") {
          await CampaignRecipient.findByIdAndUpdate(recipient._id, {
            $set: {
              status: "bounced",
              bouncedAt: new Date(),
              lastError: String(payload?.details || "Message bounced").slice(0, 500),
            },
          });
          if (recipient.subscriberId) {
            await Subscriber.updateOne(
              { _id: recipient.subscriberId },
              { $set: { status: "bounced" } }
            );
          }
          await upsertSuppression("bounced", "postal_bounce");
          await Campaign.findByIdAndUpdate(recipient.campaignId, {
            $inc: { "stats.bounced": 1 },
          });
          await updateSendingDomainHealth(recipient.fromEmail, {
            bounce: 1,
            reputationDelta: -10,
            field: "lastBounceAt",
          });
        }
        break;
      }

      case "MessageLoaded": {
        if (!recipient.openedAt) {
          await CampaignRecipient.findByIdAndUpdate(recipient._id, {
            $set: { openedAt: new Date() },
          });
          await Campaign.findByIdAndUpdate(recipient.campaignId, {
            $inc: { "stats.opened": 1 },
          });
        }
        break;
      }

      case "MessageLinkClicked": {
        if (!recipient.clickedAt) {
          await CampaignRecipient.findByIdAndUpdate(recipient._id, {
            $set: { clickedAt: new Date() },
          });
          await Campaign.findByIdAndUpdate(recipient.campaignId, {
            $inc: { "stats.clicked": 1 },
          });
        }
        break;
      }

      default:
        break;
    }

    res.sendStatus(200);
  } catch (error) {
    logger.error("Postal webhook error", {
      error: error instanceof Error ? error.message : String(error),
    });
    res.sendStatus(200);
  }
};
