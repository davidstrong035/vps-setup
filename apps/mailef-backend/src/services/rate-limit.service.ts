import { Types } from "mongoose";
import CampaignRecipient from "../models/CampaignRecipient.model";
import RateLimitPolicy from "../models/RateLimitPolicy.model";

export interface SendRateLimits {
  perMinute?: number;
  perHour?: number;
  perDay?: number;
}

interface WindowCountResult {
  perMinuteSent: number;
  perHourSent: number;
  perDaySent: number;
}

const sanitizeLimit = (value: unknown): number | undefined => {
  if (value === undefined || value === null || value === "") return undefined;

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return undefined;

  return Math.floor(parsed);
};

export const normalizeRateLimits = (payload: Record<string, unknown>): SendRateLimits => {
  return {
    perMinute: sanitizeLimit(payload.perMinute),
    perHour: sanitizeLimit(payload.perHour),
    perDay: sanitizeLimit(payload.perDay),
  };
};

const combineLimit = (globalLimit?: number, userLimit?: number): number | undefined => {
  if (globalLimit === undefined && userLimit === undefined) return undefined;
  if (globalLimit === undefined) return userLimit;
  if (userLimit === undefined) return globalLimit;

  return Math.min(globalLimit, userLimit);
};

export const getGlobalRateLimits = async (): Promise<SendRateLimits> => {
  const globalPolicy = await RateLimitPolicy.findOne({ scope: "global" }).lean();

  return {
    perMinute: globalPolicy?.perMinute,
    perHour: globalPolicy?.perHour,
    perDay: globalPolicy?.perDay,
  };
};

export const getUserRateLimits = async (userId: string): Promise<SendRateLimits> => {
  const userPolicy = await RateLimitPolicy.findOne({ scope: "user", userId }).lean();

  return {
    perMinute: userPolicy?.perMinute,
    perHour: userPolicy?.perHour,
    perDay: userPolicy?.perDay,
  };
};

export const getEffectiveRateLimits = async (
  userId: string
): Promise<{
  globalLimits: SendRateLimits;
  userLimits: SendRateLimits;
  effectiveLimits: SendRateLimits;
}> => {
  const [globalLimits, userLimits] = await Promise.all([
    getGlobalRateLimits(),
    getUserRateLimits(userId),
  ]);

  return {
    globalLimits,
    userLimits,
    effectiveLimits: {
      perMinute: combineLimit(globalLimits.perMinute, userLimits.perMinute),
      perHour: combineLimit(globalLimits.perHour, userLimits.perHour),
      perDay: combineLimit(globalLimits.perDay, userLimits.perDay),
    },
  };
};

const getWindowSentCounts = async (userId: string): Promise<WindowCountResult> => {
  const now = Date.now();
  const oneMinuteAgo = new Date(now - 60 * 1000);
  const oneHourAgo = new Date(now - 60 * 60 * 1000);
  const oneDayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const [perMinuteSent, perHourSent, perDaySent] = await Promise.all([
    CampaignRecipient.countDocuments({
      userId: new Types.ObjectId(userId),
      status: "sent",
      sentAt: { $gte: oneMinuteAgo },
    }),
    CampaignRecipient.countDocuments({
      userId: new Types.ObjectId(userId),
      status: "sent",
      sentAt: { $gte: oneHourAgo },
    }),
    CampaignRecipient.countDocuments({
      userId: new Types.ObjectId(userId),
      status: "sent",
      sentAt: { $gte: oneDayAgo },
    }),
  ]);

  return {
    perMinuteSent,
    perHourSent,
    perDaySent,
  };
};

export const getRemainingSendAllowance = async (
  userId: string
): Promise<{
  remaining: number | null;
  effectiveLimits: SendRateLimits;
  sentInWindows: WindowCountResult;
}> => {
  const [{ effectiveLimits }, sentInWindows] = await Promise.all([
    getEffectiveRateLimits(userId),
    getWindowSentCounts(userId),
  ]);

  const remainingValues: number[] = [];

  if (effectiveLimits.perMinute !== undefined) {
    remainingValues.push(Math.max(effectiveLimits.perMinute - sentInWindows.perMinuteSent, 0));
  }

  if (effectiveLimits.perHour !== undefined) {
    remainingValues.push(Math.max(effectiveLimits.perHour - sentInWindows.perHourSent, 0));
  }

  if (effectiveLimits.perDay !== undefined) {
    remainingValues.push(Math.max(effectiveLimits.perDay - sentInWindows.perDaySent, 0));
  }

  return {
    remaining: remainingValues.length > 0 ? Math.min(...remainingValues) : null,
    effectiveLimits,
    sentInWindows,
  };
};

export const upsertGlobalRateLimits = async (limits: SendRateLimits): Promise<SendRateLimits> => {
  const setFields: Record<string, unknown> = { scope: "global", userId: null };
  const unsetFields: Record<string, string> = {};

  if (limits.perMinute !== undefined) setFields.perMinute = limits.perMinute;
  else unsetFields.perMinute = "";

  if (limits.perHour !== undefined) setFields.perHour = limits.perHour;
  else unsetFields.perHour = "";

  if (limits.perDay !== undefined) setFields.perDay = limits.perDay;
  else unsetFields.perDay = "";

  const update: Record<string, unknown> = { $set: setFields };
  if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;

  const updated = await RateLimitPolicy.findOneAndUpdate(
    { scope: "global" },
    update,
    { returnDocument: "after", upsert: true }
  ).lean();

  return {
    perMinute: updated?.perMinute,
    perHour: updated?.perHour,
    perDay: updated?.perDay,
  };
};

export const upsertUserRateLimits = async (
  userId: string,
  limits: SendRateLimits
): Promise<SendRateLimits> => {
  const setFields: Record<string, unknown> = { scope: "user", userId };
  const unsetFields: Record<string, string> = {};

  if (limits.perMinute !== undefined) setFields.perMinute = limits.perMinute;
  else unsetFields.perMinute = "";

  if (limits.perHour !== undefined) setFields.perHour = limits.perHour;
  else unsetFields.perHour = "";

  if (limits.perDay !== undefined) setFields.perDay = limits.perDay;
  else unsetFields.perDay = "";

  const update: Record<string, unknown> = { $set: setFields };
  if (Object.keys(unsetFields).length > 0) update.$unset = unsetFields;

  const updated = await RateLimitPolicy.findOneAndUpdate(
    { scope: "user", userId },
    update,
    { returnDocument: "after", upsert: true }
  ).lean();

  return {
    perMinute: updated?.perMinute,
    perHour: updated?.perHour,
    perDay: updated?.perDay,
  };
};
