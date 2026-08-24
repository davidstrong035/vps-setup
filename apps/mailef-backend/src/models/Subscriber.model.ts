import mongoose, { Schema } from "mongoose";
import { ISubscriber } from "../types";

const SubscriberSchema = new Schema<ISubscriber>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    listId: { type: Schema.Types.ObjectId, ref: "List", required: true, index: true },
    email: { type: String, required: true, lowercase: true, trim: true },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    status: {
      type: String,
      enum: ["active", "unsubscribed", "bounced", "complained"],
      default: "active",
    },
    customFields: { type: Map, of: String },
  },
  { timestamps: true }
);

// one email per list
SubscriberSchema.index({ listId: 1, email: 1 }, { unique: true });

export default mongoose.model<ISubscriber>("Subscriber", SubscriberSchema);
