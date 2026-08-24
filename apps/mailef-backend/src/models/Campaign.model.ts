import mongoose, { Schema } from "mongoose";
import { ICampaign } from "../types";

const CampaignSchema = new Schema<ICampaign>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    subject: { type: String, required: true, trim: true },
    fromName: { type: String, required: true, trim: true },
    fromEmail: { type: String, required: true, trim: true, lowercase: true },
    sendingDomain: { type: String, trim: true, lowercase: true },
    listId: { type: Schema.Types.ObjectId, ref: "List", required: true },
    templateId: { type: Schema.Types.ObjectId, ref: "Template" },
    html: { type: String, required: true },
    status: {
      type: String,
      enum: ["draft", "scheduled", "sending", "sent", "paused", "cancelled"],
      default: "draft",
    },
    pauseReason: { type: String, trim: true },
    pausedBy: { type: String, enum: ["user", "admin", "system"], trim: true },
    scheduledAt: { type: Date },
    sentAt: { type: Date },
    dispatchCursorChunkIndex: { type: Number, default: 0, min: 0 },
    dispatchCursorRowOffset: { type: Number, default: 0, min: 0 },
    stats: {
      total: { type: Number, default: 0 },
      sent: { type: Number, default: 0 },
      failed: { type: Number, default: 0 },
      opened: { type: Number, default: 0 },
      clicked: { type: Number, default: 0 },
      bounced: { type: Number, default: 0 },
      complained: { type: Number, default: 0 },
      unsubscribed: { type: Number, default: 0 },
    },
  },
  { timestamps: true }
);

export default mongoose.model<ICampaign>("Campaign", CampaignSchema);
