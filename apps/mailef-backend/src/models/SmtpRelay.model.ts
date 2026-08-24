import mongoose, { Schema } from "mongoose";

export interface ISmtpRelay extends mongoose.Document {
  userId?: mongoose.Types.ObjectId;
  name: string;
  host: string;
  port: number;
  username?: string;
  password?: string;
  secure?: boolean;
  tlsRejectUnauthorized?: boolean;
  isActive: boolean;
  isArchived: boolean;
  weight: number;
  sentToday: number;
  usageDate?: string;
  lastUsedAt?: Date;
  notes?: string;
  healthStatus: "unknown" | "healthy" | "degraded" | "down";
  consecutiveFailures: number;
  lastHealthCheckAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const SmtpRelaySchema = new Schema<ISmtpRelay>(
  {
    name: { type: String, required: true, trim: true },
    host: { type: String, required: true, trim: true, lowercase: true },
    port: { type: Number, required: true, min: 1, max: 65535, default: 587 },
    username: { type: String, trim: true },
    password: { type: String },
    secure: { type: Boolean, default: false },
    tlsRejectUnauthorized: { type: Boolean, default: true },
    isActive: { type: Boolean, default: true },
    isArchived: { type: Boolean, default: false },
    weight: { type: Number, min: 1, default: 1 },
    sentToday: { type: Number, min: 0, default: 0 },
    usageDate: { type: String, trim: true },
    lastUsedAt: { type: Date },
    notes: { type: String, trim: true, maxlength: 1000 },
    healthStatus: { type: String, enum: ["unknown", "healthy", "degraded", "down"], default: "unknown" },
    consecutiveFailures: { type: Number, min: 0, default: 0 },
    lastHealthCheckAt: { type: Date },
    userId: { type: Schema.Types.ObjectId, ref: 'User', index: true, default: null },
  },
  { timestamps: true }
);

SmtpRelaySchema.index({ isArchived: 1, isActive: 1 });
SmtpRelaySchema.index({ usageDate: 1, sentToday: 1 });

export default mongoose.model<ISmtpRelay>("SmtpRelay", SmtpRelaySchema);
