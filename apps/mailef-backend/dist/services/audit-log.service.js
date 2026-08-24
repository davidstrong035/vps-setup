"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.logAuditFromRequest = exports.logAuditEvent = void 0;
const mongoose_1 = require("mongoose");
const AuditLog_model_1 = __importDefault(require("../models/AuditLog.model"));
const logger_1 = require("../utils/logger");
const clip = (value, max = 500) => value.length > max ? `${value.slice(0, max)}…` : value;
const sanitizeMetadata = (metadata) => {
    if (!metadata)
        return undefined;
    const blockedKeys = new Set(["password", "token", "authorization", "secret"]);
    const cleaned = {};
    for (const [key, value] of Object.entries(metadata)) {
        if (blockedKeys.has(key.toLowerCase()))
            continue;
        if (typeof value === "string") {
            cleaned[key] = clip(value, 300);
        }
        else {
            cleaned[key] = value;
        }
    }
    return cleaned;
};
const logAuditEvent = async (input) => {
    try {
        await AuditLog_model_1.default.create({
            actorType: input.actorType || "system",
            actorId: input.actorId ? new mongoose_1.Types.ObjectId(input.actorId) : undefined,
            actorRole: input.actorRole,
            action: input.action,
            resourceType: input.resourceType,
            resourceId: input.resourceId,
            targetUserId: input.targetUserId ? new mongoose_1.Types.ObjectId(input.targetUserId) : undefined,
            status: input.status,
            requestId: input.requestId,
            ipAddress: input.ipAddress,
            userAgent: input.userAgent,
            metadata: sanitizeMetadata(input.metadata),
        });
    }
    catch (error) {
        logger_1.logger.error("Failed to persist audit log", {
            action: input.action,
            resourceType: input.resourceType,
            error: error instanceof Error ? error.message : String(error),
        });
    }
};
exports.logAuditEvent = logAuditEvent;
const logAuditFromRequest = async (req, params) => {
    await (0, exports.logAuditEvent)({
        ...params,
        actorType: req.userId ? "user" : "system",
        actorId: req.userId,
        actorRole: req.userRole,
        requestId: req.requestId,
        ipAddress: req.requestIp,
        userAgent: req.requestUserAgent,
    });
};
exports.logAuditFromRequest = logAuditFromRequest;
//# sourceMappingURL=audit-log.service.js.map