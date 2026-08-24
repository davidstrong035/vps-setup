import { Types } from "mongoose";
import CampaignRecipient from "../models/CampaignRecipient.model";

export async function getLastSentTime(userId: string): Promise<Date | null> {
  const last = await CampaignRecipient.findOne({
    userId: new Types.ObjectId(userId),
    status: "sent",
  })
    .sort({ sentAt: -1 })
    .select("sentAt")
    .lean();
  return last?.sentAt ? new Date(last.sentAt) : null;
}
