import { Types } from "mongoose";
import CampaignRecipient from "../models/CampaignRecipient.model";
import { getEffectiveRateLimits } from "./rate-limit.service";

/**
 * Returns the soonest Date when the user will be allowed to send again, or null if not rate-limited.
 */
export async function getNextAllowedSendTime(userId: string): Promise<Date | null> {
  const { effectiveLimits } = await getEffectiveRateLimits(userId);
  const now = new Date();
  const windows: Array<{ limit?: number; ms: number }> = [
    { limit: effectiveLimits.perMinute, ms: 60 * 1000 },
    { limit: effectiveLimits.perHour, ms: 60 * 60 * 1000 },
    { limit: effectiveLimits.perDay, ms: 24 * 60 * 60 * 1000 },
  ];
  let soonest: Date | null = null;

  for (const { limit, ms } of windows) {
    if (!limit) continue;
    // Find the Nth most recent sent message in this window
    const since = new Date(now.getTime() - ms);
    const recents = await CampaignRecipient.find({
      userId: new Types.ObjectId(userId),
      status: "sent",
      sentAt: { $gte: since },
    })
      .sort({ sentAt: 1 })
      .select("sentAt")
      .lean();
    const sentAt = recents[0]?.sentAt ? new Date(recents[0].sentAt) : null;
    if (recents.length >= limit && sentAt) {
      // The earliest sentAt in the window + window size is when the user can send again
      const next = new Date(sentAt.getTime() + ms);
      if (!soonest || next < soonest) soonest = next;
    }
  }
  return soonest;
}
