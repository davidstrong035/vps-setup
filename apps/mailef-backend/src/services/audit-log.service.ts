import { Types } from "mongoose";
import AuditLog from "../models/AuditLog.model";
import { AuthRequest } from "../types";
import { logger } from "../utils/logger";

type AuditStatus = "success" | "failure";
type AuditActorType = "system" | "user";

interface AuditEventInput {
  actorType?: AuditActorType;
  actorId?: string;
  actorRole?: "user" | "admin" | "super_admin";
  action: string;
  resourceType: string;
  resourceId?: string;
  targetUserId?: string;
  status: AuditStatus;
  requestId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Record<string, unknown>;
}

const clip = (value: string, max = 500): string =>
  value.length > max ? `${value.slice(0, max)}…` : value;

const sanitizeMetadata = (metadata?: Record<string, unknown>) => {
  if (!metadata) return undefined;

  const blockedKeys = new Set(["password", "token", "authorization", "secret"]);
  const cleaned: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(metadata)) {
    if (blockedKeys.has(key.toLowerCase())) continue;

    if (typeof value === "string") {
      cleaned[key] = clip(value, 300);
    } else {
      cleaned[key] = value;
    }
  }

  return cleaned;
};

export const logAuditEvent = async (input: AuditEventInput): Promise<void> => {
  try {
    await AuditLog.create({
      actorType: input.actorType || "system",
      actorId: input.actorId ? new Types.ObjectId(input.actorId) : undefined,
      actorRole: input.actorRole,
      action: input.action,
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      targetUserId: input.targetUserId ? new Types.ObjectId(input.targetUserId) : undefined,
      status: input.status,
      requestId: input.requestId,
      ipAddress: input.ipAddress,
      userAgent: input.userAgent,
      metadata: sanitizeMetadata(input.metadata),
    });
  } catch (error) {
    logger.error("Failed to persist audit log", {
      action: input.action,
      resourceType: input.resourceType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

export const logAuditFromRequest = async (
  req: AuthRequest,
  params: Omit<AuditEventInput, "actorId" | "actorRole" | "requestId" | "ipAddress" | "userAgent" | "actorType">
): Promise<void> => {
  await logAuditEvent({
    ...params,
    actorType: req.userId ? "user" : "system",
    actorId: req.userId,
    actorRole: req.userRole,
    requestId: req.requestId,
    ipAddress: req.requestIp,
    userAgent: req.requestUserAgent,
  });
};
