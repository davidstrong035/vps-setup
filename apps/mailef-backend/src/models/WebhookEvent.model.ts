import mongoose, { Schema } from "mongoose";
import { IWebhookEvent } from "../types";

const WebhookEventSchema = new Schema<IWebhookEvent>(
  {
    source: { type: String, enum: ["ses", "postal"], required: true, index: true },
    eventId: { type: String, required: true, index: true },
    eventType: { type: String },
    rawPayload: { type: String },
    receivedAt: { type: Date, default: Date.now },
  },
  { timestamps: true }
);

WebhookEventSchema.index({ source: 1, eventId: 1 }, { unique: true });

export default mongoose.model<IWebhookEvent>("WebhookEvent", WebhookEventSchema);