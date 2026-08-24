import mongoose, { Schema } from "mongoose";
import { ICampaignRecipient } from "../types";

const CampaignRecipientSchema = new Schema<ICampaignRecipient>(
  {
    campaignId: { type: Schema.Types.ObjectId, ref: "Campaign", required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    listId: { type: Schema.Types.ObjectId, ref: "List", required: true, index: true },
    subscriberId: { type: Schema.Types.ObjectId, ref: "Subscriber", required: false, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    status: {
      type: String,
      enum: ["pending", "queued", "sent", "failed", "bounced", "complained"],
      default: "pending",
      index: true,
    },
    messageId: { type: String, index: true, sparse: true },
    retryCount: { type: Number, default: 0 },
    lastError: { type: String },
    sentAt: { type: Date },
    openedAt: { type: Date },
    clickedAt: { type: Date },
    bouncedAt: { type: Date },
    complainedAt: { type: Date },
    fromEmail: { type: String },
  },
  { timestamps: true }
);

CampaignRecipientSchema.index({ campaignId: 1, email: 1 }, { unique: true });

export default mongoose.model<ICampaignRecipient>("CampaignRecipient", CampaignRecipientSchema);