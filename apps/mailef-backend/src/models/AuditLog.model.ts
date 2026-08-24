import mongoose, { Schema } from "mongoose";
import { IAuditLog } from "../types";

const AuditLogSchema = new Schema<IAuditLog>(
  {
    actorType: {
      type: String,
      enum: ["system", "user"],
      required: true,
      immutable: true,
      index: true,
    },
    actorId: { type: Schema.Types.ObjectId, ref: "User", immutable: true, index: true },
    actorRole: {
      type: String,
      enum: ["user", "admin", "super_admin"],
      immutable: true,
      index: true,
    },
    action: { type: String, required: true, immutable: true, index: true },
    resourceType: { type: String, required: true, immutable: true, index: true },
    resourceId: { type: String, immutable: true, index: true },
    targetUserId: { type: Schema.Types.ObjectId, ref: "User", immutable: true, index: true },
    status: {
      type: String,
      enum: ["success", "failure"],
      required: true,
      immutable: true,
      index: true,
    },
    requestId: { type: String, immutable: true, index: true },
    ipAddress: { type: String, immutable: true, index: true },
    userAgent: { type: String, immutable: true },
    metadata: { type: Schema.Types.Mixed, immutable: true },
  },
  {
    timestamps: true,
    versionKey: false,
  }
);

AuditLogSchema.index({ createdAt: -1 });
AuditLogSchema.index({ actorId: 1, createdAt: -1 });
AuditLogSchema.index({ targetUserId: 1, createdAt: -1 });
AuditLogSchema.index({ action: 1, createdAt: -1 });

export default mongoose.model<IAuditLog>("AuditLog", AuditLogSchema);
