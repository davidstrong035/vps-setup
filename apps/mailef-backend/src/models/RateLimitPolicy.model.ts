import mongoose, { Schema } from "mongoose";
import { IRateLimitPolicy } from "../types";

const RateLimitPolicySchema = new Schema<IRateLimitPolicy>(
  {
    scope: {
      type: String,
      enum: ["global", "user"],
      required: true,
    },
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      default: null,
      index: true,
    },
    perMinute: { type: Number, min: 1 },
    perHour: { type: Number, min: 1 },
    perDay: { type: Number, min: 1 },
  },
  { timestamps: true }
);

RateLimitPolicySchema.index(
  { scope: 1, userId: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: "user" },
  }
);

RateLimitPolicySchema.index(
  { scope: 1 },
  {
    unique: true,
    partialFilterExpression: { scope: "global" },
  }
);

export default mongoose.model<IRateLimitPolicy>("RateLimitPolicy", RateLimitPolicySchema);
