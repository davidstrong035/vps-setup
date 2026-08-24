import mongoose, { Schema } from "mongoose";
import { IEmailCreditAllocation } from "../types";

const EmailCreditAllocationSchema = new Schema<IEmailCreditAllocation>(
  {
    userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    assignedByUserId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    amountPaid: { type: Number, required: true, min: 0 },
    currency: { type: String, required: true, trim: true, uppercase: true, default: "USD" },
    emailsPurchased: { type: Number, required: true, min: 1 },
    consumedEmails: { type: Number, default: 0, min: 0 },
    reservedEmails: { type: Number, default: 0, min: 0 },
    paidAt: { type: Date, required: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    receiptReference: { type: String, trim: true },
    note: { type: String, trim: true },
    status: {
      type: String,
      enum: ["active", "expired", "consumed", "superseded", "suspended"],
      default: "active",
      index: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

EmailCreditAllocationSchema.index({ userId: 1, status: 1, expiresAt: 1 });
EmailCreditAllocationSchema.index({ userId: 1, createdAt: -1 });

export default mongoose.model<IEmailCreditAllocation>(
  "EmailCreditAllocation",
  EmailCreditAllocationSchema
);
