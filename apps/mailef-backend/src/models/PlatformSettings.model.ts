import mongoose, { Schema } from "mongoose";

export interface IPlatformSettings extends mongoose.Document {
  singletonKey: string;
  mailProvider?: "ses" | "smtp";
  mailDefaultFromName?: string;
  mailVerifiedFromEmail?: string;
  mailConfigurationSetName?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUsername?: string;
  smtpPassword?: string;
  smtpSecure?: boolean;
  smtpTlsRejectUnauthorized?: boolean;
  dispatchEnabled?: boolean;
  dispatchIntervalMs?: number;
  dispatchUsersPerTick?: number;
  dispatchMaxPerRun?: number;
  workerConcurrency?: number;
  workerRateLimitMax?: number;
  workerRateLimitDurationMs?: number;
  customIntervalMinutes?: number; // Custom interval: send 1 email every X minutes (overrides per-minute limit)
  // Relay health check intervals (in seconds)
  relaySelfHostedHealthCheckSec?: number;
  relayThirdPartyHealthCheckSec?: number;
  createdAt: Date;
  updatedAt: Date;
}

const PlatformSettingsSchema = new Schema<IPlatformSettings>(
  {
    singletonKey: {
      type: String,
      required: true,
      unique: true,
      default: "platform",
    },
    mailProvider: {
      type: String,
      enum: ["ses", "smtp"],
      default: "ses",
    },
    mailDefaultFromName: { type: String, trim: true },
    mailVerifiedFromEmail: { type: String, trim: true, lowercase: true },
    mailConfigurationSetName: { type: String, trim: true },
    smtpHost: { type: String, trim: true },
    smtpPort: { type: Number, min: 1, max: 65535 },
    smtpUsername: { type: String, trim: true },
    smtpPassword: { type: String },
    smtpSecure: { type: Boolean },
    smtpTlsRejectUnauthorized: { type: Boolean },
    dispatchEnabled: { type: Boolean },
    dispatchIntervalMs: { type: Number, min: 2000 },
    dispatchUsersPerTick: { type: Number, min: 1 },
    dispatchMaxPerRun: { type: Number, min: 100 },
    workerConcurrency: { type: Number, min: 1 },
    workerRateLimitMax: { type: Number, min: 1 },
    workerRateLimitDurationMs: { type: Number, min: 100 },
    customIntervalMinutes: { type: Number, min: 1 }, // Send 1 email every X minutes
    // Relay health check intervals
    relaySelfHostedHealthCheckSec: { type: Number, min: 60, default: 300 },
    relayThirdPartyHealthCheckSec: { type: Number, min: 3600, default: 14400 },
  },
  { timestamps: true }
);

export default mongoose.model<IPlatformSettings>("PlatformSettings", PlatformSettingsSchema);
